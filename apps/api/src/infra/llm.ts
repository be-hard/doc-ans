import type { Citation } from "@docs-ans/shared";
import { getEnv } from "./env";

export interface AnswerContext {
  question: string;
  citations: Citation[];
  documentTitle?: string;
}

async function* localStreamAnswer(context: AnswerContext) {
  // 本地兜底回答必须“用证据说话”，否则没有模型 key 时会变成无意义模板。
  const usefulCitations = context.citations.filter((citation) => citation.quote.trim());
  const body = usefulCitations.length
    ? [
      `基于当前知识库，和“${context.question}”最相关的内容如下：`,
      ...usefulCitations.slice(0, 3).map((citation, index) => {
        const quote = citation.quote.replace(/\s+/g, " ").trim();
        return `${index + 1}. ${quote} [${index + 1}]`;
      }),
      `结论：以上片段来自 ${[...new Set(usefulCitations.map((citation) => citation.documentTitle))].join("、")}，可优先查看引用位置核对原文。`
    ].join("\n")
    : `没有在当前范围内检索到和“${context.question}”相关的已入库片段。请先保存并入库当前文档，或换一个更具体的关键词。`;

  for (const char of body) {
    yield char;
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

export async function* streamAnswer(context: AnswerContext) {
  const env = getEnv();
  const hasModel = Boolean(env.openaiApiKey && env.openaiBaseUrl);

  if (!hasModel) {
    yield* localStreamAnswer(context);
    return;
  }

  const base = env.openaiBaseUrl.replace(/\/$/, "");
  const chatUrl = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.chatModel,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "你是文档工作台里的知识库助手。必须优先使用检索证据回答，答案末尾保留简洁引用提示。"
        },
        {
          role: "user",
          content: [
            `问题：${context.question}`,
            `来源文档：${context.documentTitle ?? "未知"}`,
            `引用片段：`,
            ...context.citations.map((citation, index) => `[${index + 1}] ${citation.quote}`)
          ].join("\n")
        }
      ]
    })
  });

  if (!response.body) {
    yield* localStreamAnswer(context);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const text = json.choices?.[0]?.delta?.content;
        if (text) {
          yield text;
        }
      } catch {
        // 模型服务返回非标准分片时，忽略这条 chunk，避免 SSE 直接断流。
      }
    }
  }
}
