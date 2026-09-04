import type { Citation } from "@docs-ans/shared";
import { Logger } from "@nestjs/common";
import { performance } from "node:perf_hooks";
import { getEnv } from "./env.js";

export interface AnswerContext {
  question: string;
  citations: Citation[];
  documentTitle?: string;
}

export type SensenovaMessageRole = "system" | "user" | "assistant";

export type SensenovaContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: string }
  | { type: "image_file_id"; image_file_id: string }
  | { type: "image_base64"; image_base64: string }
  | { type: "video_url"; video_url: string }
  | { type: "video_file_id"; video_file_id: string };

export type SensenovaMessageContent = string | SensenovaContentPart[];

export interface SensenovaMessage {
  role: SensenovaMessageRole;
  content: SensenovaMessageContent;
}

export interface StreamChatOptions {
  model?: string;
  reasoningEffort?: "low" | "high" | "max";
  maxNewTokens?: number;
  temperature?: number;
  topP?: number;
  user?: string;
  traceLabel?: string;
}

export type AiErrorKind = "quota" | "rate_limit" | "timeout" | "auth" | "validation" | "server" | "unknown";

export interface AiErrorClassification {
  kind: AiErrorKind;
  retryable: boolean;
  statusCode?: number;
  userMessage: string;
  internalMessage?: string;
}

export function classifyAiError(error: unknown): AiErrorClassification {
  const raw = error as {
    code?: string;
    type?: string;
    status?: number;
    statusCode?: number;
    message?: string;
  };

  const code = String(raw?.code ?? "").toLowerCase();
  const type = String(raw?.type ?? "").toLowerCase();
  const status = raw?.status ?? raw?.statusCode ?? 0;
  const message = String(raw?.message ?? "").toLowerCase();

  if (
    code === "insufficient_quota" ||
    message.includes("quota exceeded") ||
    message.includes("insufficient quota") ||
    message.includes("allocated quota exceeded") ||
    message.includes("quota") && message.includes("exceeded")
  ) {
    return {
      kind: "quota",
      retryable: false,
      statusCode: status || 402,
      userMessage: "AI 服务额度已用尽，请联系管理员或稍后再试。",
      internalMessage: raw?.message ?? "AI quota exceeded"
    };
  }

  if (
    code === "rate_limit_exceeded" ||
    type.includes("rate_limit") ||
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return {
      kind: "rate_limit",
      retryable: true,
      statusCode: 429,
      userMessage: "请求过于频繁，稍后再试。",
      internalMessage: raw?.message ?? "Rate limit exceeded"
    };
  }

  if (
    status === 408 ||
    code === "timeout" ||
    type.includes("timeout") ||
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return {
      kind: "timeout",
      retryable: true,
      statusCode: 408,
      userMessage: "AI 请求超时，请稍后再试。",
      internalMessage: raw?.message ?? "Request timeout"
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    code === "invalid_api_key" ||
    type.includes("authentication") ||
    message.includes("api key") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  ) {
    return {
      kind: "auth",
      retryable: false,
      statusCode: status || 401,
      userMessage: "AI 服务认证失败，请联系管理员。",
      internalMessage: raw?.message ?? "Authentication failed"
    };
  }

  if (
    status === 400 ||
    message.includes("context length") ||
    message.includes("maximum context") ||
    message.includes("too many tokens") ||
    message.includes("prompt is too long")
  ) {
    return {
      kind: "validation",
      retryable: false,
      statusCode: 400,
      userMessage: "请求内容过长或参数不合法，请精简后重试。",
      internalMessage: raw?.message ?? "Validation error"
    };
  }

  if (status >= 500 || message.includes("server error") || message.includes("internal server error")) {
    return {
      kind: "server",
      retryable: true,
      statusCode: status || 500,
      userMessage: "AI 服务暂时异常，请稍后再试。",
      internalMessage: raw?.message ?? "AI server error"
    };
  }

  return {
    kind: "unknown",
    retryable: false,
    statusCode: status || 500,
    userMessage: "AI 请求失败，请稍后再试。",
    internalMessage: raw?.message ?? "Unknown AI error"
  };
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

async function* readSseDataLines(response: Response, onFirstData?: () => void) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is empty");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();

      if (data) {
        onFirstData?.();
        onFirstData = undefined;
        yield data;
      }
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) {
    const data = tail
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();

    if (data) {
      onFirstData?.();
      yield data;
    }
  }
}

function summarizeSsePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { kind: "non_object", detail: String(payload) };
  }

  const json = payload as Record<string, unknown>;
  const choice = Array.isArray(json.choices) ? (json.choices[0] as Record<string, unknown> | undefined) : undefined;
  const data = json.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : undefined;
  const nestedChoice = Array.isArray(data?.choices) ? (data?.choices?.[0] as Record<string, unknown> | undefined) : undefined;
  const activeChoice = nestedChoice ?? choice;
  const delta = activeChoice?.delta && typeof activeChoice.delta === "object"
    ? (activeChoice.delta as Record<string, unknown>)
    : undefined;
  const message = activeChoice?.message && typeof activeChoice.message === "object"
    ? (activeChoice.message as Record<string, unknown>)
    : undefined;

  const eventName = typeof json.event === "string"
    ? json.event
    : typeof data?.event === "string"
      ? String(data.event)
      : typeof json.type === "string"
        ? json.type
        : typeof data?.type === "string"
          ? String(data.type)
          : undefined;

  const finishReason = typeof activeChoice?.finish_reason === "string"
    ? activeChoice.finish_reason
    : typeof activeChoice?.finishReason === "string"
      ? String(activeChoice.finishReason)
      : typeof json.finish_reason === "string"
        ? json.finish_reason
        : undefined;

  const reasoningText = typeof delta?.reasoning_content === "string"
    ? delta.reasoning_content
    : typeof delta?.reasoning === "string"
      ? String(delta.reasoning)
      : typeof message?.reasoning_content === "string"
        ? String(message.reasoning_content)
        : "";
  const contentText = typeof delta?.content === "string"
    ? delta.content
    : typeof message?.content === "string"
      ? message.content
      : "";

  let kind = "unknown";
  if (reasoningText) {
    kind = "reasoning";
  } else if (contentText) {
    kind = "content";
  } else if (delta?.role || message?.role) {
    kind = "role";
  } else if (delta?.tool_calls || delta?.function_call || message?.tool_calls || message?.function_call) {
    kind = "tool_call";
  } else if (finishReason) {
    kind = "finish";
  } else if (eventName) {
    kind = eventName;
  }

  const keys = Object.keys(json).slice(0, 8);
  const deltaKeys = delta ? Object.keys(delta).slice(0, 8) : [];
  const messageKeys = message ? Object.keys(message).slice(0, 8) : [];

  return {
    kind,
    detail: [
      eventName ? `event=${eventName}` : null,
      finishReason ? `finish_reason=${finishReason}` : null,
      reasoningText ? "reasoning" : null,
      contentText ? "content" : null,
      deltaKeys.length ? `delta_keys=${deltaKeys.join(",")}` : null,
      messageKeys.length ? `message_keys=${messageKeys.join(",")}` : null,
      `keys=${keys.join(",")}`
    ].filter(Boolean).join(" ")
  };
}

function getChatCompletionUrl(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "") || "https://api.sensenova.cn/v1";
  if (base.includes("/compatible-mode/")) {
    if (base.endsWith("/chat/completions")) {
      return base;
    }
    if (base.endsWith("/v1")) {
      return `${base}/chat/completions`;
    }
    return `${base}/v1/chat/completions`;
  }
  if (base.endsWith("/llm/chat-completions") || base.endsWith("/chat/completions")) {
    return base;
  }
  if (base.endsWith("/llm")) {
    return `${base}/chat-completions`;
  }
  if (base.endsWith("/v1")) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/llm/chat-completions`;
}

export async function* streamChatCompletion(messages: SensenovaMessage[], options?: StreamChatOptions) {
  const env = getEnv();
  const hasModel = Boolean(env.openaiApiKey);

  if (!hasModel) {
    return;
  }

  const chatUrl = getChatCompletionUrl(env.openaiBaseUrl);
  const startedAt = performance.now();
  const traceLabel = options?.traceLabel ? `[${options.traceLabel}]` : "[streamChatCompletion]";

  Logger.log(
    `${traceLabel} request start model="${options?.model || env.chatModel}" reasoning_effort="${options?.reasoningEffort || "default"}"`
  );

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({
        model: options?.model || env.chatModel,
        max_tokens: options?.maxNewTokens ?? 1024,
        temperature: options?.temperature ?? 0.8,
        top_p: options?.topP ?? 0.7,
        ...(options?.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
        ...(options?.user ? { user: options.user } : {}),
        stream: true,
        messages
      })
    });
    Logger.log(`${traceLabel} upstream headers in ${(performance.now() - startedAt).toFixed(0)}ms status=${response.status}`);

    if (!response.ok) {
      let detail: unknown = null;
      const rawBody = await response.text().catch(() => "");
      if (rawBody) {
        try {
          detail = JSON.parse(rawBody);
        } catch {
          detail = rawBody;
        }
      }

      const error = detail && typeof detail === "object" && "error" in detail
        ? (detail as { error?: { code?: string; type?: string; message?: string } }).error
        : detail;

      const typedError = error && typeof error === "object"
        ? error as { code?: string; type?: string; message?: string }
        : { message: rawBody || `AI request failed: ${response.status}` };

      throw Object.assign(new Error(typedError.message || `AI request failed: ${response.status}`), {
        code: typedError.code,
        type: typedError.type,
        status: response.status,
        statusCode: response.status
      });
    }

    if (!response.body) {
      return;
    }

    let firstSsePayloadLogged = false;
    let firstTextDeltaLogged = false;
    let preTextEventCount = 0;
    for await (const payload of readSseDataLines(response, () => {
      if (!firstSsePayloadLogged) {
        firstSsePayloadLogged = true;
        Logger.log(`${traceLabel} first sse payload in ${(performance.now() - startedAt).toFixed(0)}ms`);
      }
    })) {
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const summary = summarizeSsePayload(json);
        if (preTextEventCount < 12) {
          Logger.log(`${traceLabel} event=${summary.kind} ${summary.detail}`);
          preTextEventCount += 1;
        }
        const choice = json?.data?.choices?.[0] ?? json?.choices?.[0];
        const delta = choice?.delta;
        const text =
          typeof delta === "string"
            ? delta
          : typeof delta?.content === "string"
            ? delta.content
            : "";
        if (text) {
          if (!firstTextDeltaLogged) {
            firstTextDeltaLogged = true;
            Logger.log(`${traceLabel} first text delta in ${(performance.now() - startedAt).toFixed(0)}ms`);
          }
          yield text;
        }
      } catch {
        // ignore malformed chunk
      }
    }
  } catch (error) {
    const classification = classifyAiError(error);
    Logger.error("streamChatCompletion failed", `${classification.kind}: ${classification.internalMessage ?? String(error)}`);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      kind: classification.kind,
      retryable: classification.retryable,
      status: classification.statusCode,
      statusCode: classification.statusCode,
      userMessage: classification.userMessage
    });
  }
}

export async function* streamAnswer(
  context: AnswerContext,
  options?: Pick<StreamChatOptions, "model" | "reasoningEffort" | "maxNewTokens" | "temperature" | "topP" | "user" | "traceLabel">
) {
  const startedAt = performance.now();
  const messages: SensenovaMessage[] = [
    {
      role: "system",
      content: "你是文档工作台里的知识库助手。必须优先使用检索证据回答，答案末尾保留简洁引用提示。"
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
  ];

  const env = getEnv();
  if (!env.openaiApiKey) {
    yield* localStreamAnswer(context);
    return;
  }

  try {
    let firstDeltaLogged = false;
    for await (const delta of streamChatCompletion(messages, options)) {
      if (!firstDeltaLogged) {
        firstDeltaLogged = true;
        Logger.log(`[streamAnswer] first delta in ${(performance.now() - startedAt).toFixed(0)}ms`);
      }
      yield delta;
    }
    Logger.log(`[streamAnswer] done in ${(performance.now() - startedAt).toFixed(0)}ms`);
  } catch (error) {
    const classification = classifyAiError(error);
    Logger.error("streamAnswer failed", `${classification.kind}: ${classification.internalMessage ?? String(error)}`);

    if (classification.kind === "quota" || classification.kind === "auth" || classification.kind === "validation") {
      yield `AI 服务不可用：${classification.userMessage}`;
      return;
    }

    if (classification.kind === "rate_limit" || classification.kind === "timeout" || classification.kind === "server") {
      yield* localStreamAnswer(context);
      return;
    }

    yield* localStreamAnswer(context);
  }
}
