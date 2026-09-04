import type { AnswerRequest, Citation, DocumentRecord, DocumentVersion, IngestJob, KnowledgeEvent, KnowledgeScope } from "@docs-ans/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

type AiAskModel = "sensenova-6.8-flash-lite" | "kimi-k3" | "glm-5.2";

type AiAskAttachment =
  | { type: "image_url"; image_url: string }
  | { type: "image_file_id"; image_file_id: string }
  | { type: "image_base64"; image_base64: string }
  | { type: "video_url"; video_url: string }
  | { type: "video_file_id"; video_file_id: string };

type AiAskEvent = { type: string; text?: string; answer?: string; message?: string };

function parseSseFrame(frame: string) {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  return data ? JSON.parse(data) : null;
}

async function* readSseStream<T>(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("SSE response body is empty");
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
      const event = parseSseFrame(frame);
      if (event) yield event as T;
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail) {
    const event = parseSseFrame(tail);
    if (event) yield event as T;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// 封装一个基于 fetch 的统一请求函数
const requestFn = async (path: string, option: RequestInit) => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...option,
    headers: {
      "content-type": "application/json",
      ...(option?.headers ?? {})
    }
  })
  if (!response.ok || !response.body) {
    const message = await response.json().catch(() => null);
    throw new Error(`接口返回异常 ${message?.message || `Request failed: ${response.status}`}`);
  }
  // 统一数据处理逻辑
  return response.json() as Promise<any>;
}

const testApi = {
  aiAsk: async (
    payload: { question: string; model?: AiAskModel; attachments?: AiAskAttachment[] },
    onChunk?: (text: string) => void
  ) => {
    const response = await fetch(`${API_BASE}/ai/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.body) {
      const message = await response.json().catch(() => null);
      throw new Error(message?.message || `SSE request failed: ${response.status}`);
    }

    let answer = "";

    for await (const event of readSseStream<AiAskEvent>(response)) {
      if (event.type === "delta" && typeof event.text === "string") {
        answer += event.text;
        onChunk?.(event.text);
      }
      if (event.type === "done" && typeof event.answer === "string") {
        return { answer: event.answer };
      }
      if (event.type === "error") {
        throw new Error(event.message || "AI request failed");
      }
    }

    if (!answer) {
      throw new Error("AI stream ended without a response");
    }

    return { answer };
  }
}

export const api = {
  ...testApi,
  health: () => request<{ ok: boolean }>("/health"),
  login: (email: string, name: string) => request<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, name }) }),
  listDocuments: () => request<DocumentRecord[]>("/documents"),
  createDocument: (title: string) =>
    request<DocumentRecord>("/documents", { method: "POST", body: JSON.stringify({ title, contentText: "从这里开始写下第一段内容。" }) }),
  deleteDocument: (id: string) => request<{ message: string; id: string }>(`/documents/${id}`, { method: "DELETE" }),
  updateDocument: (id: string, patch: Partial<Pick<DocumentRecord, "title" | "contentJson" | "contentText" | "tags">>) =>
    request<DocumentRecord>(`/documents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  saveDocument: (id: string, patch: Partial<Pick<DocumentRecord, "title" | "contentJson" | "contentText">>) =>
    request<{ document: DocumentRecord; version: DocumentVersion }>(`/documents/${id}/save`, {
      method: "POST",
      body: JSON.stringify(patch)
    }),
  ingestDocument: (id: string) => request<{ job: IngestJob; chunkCount: number }>(`/documents/${id}/ingest`, { method: "POST", body: JSON.stringify({}) }),
  outgestDocument: (id: string) => request<{ document: DocumentRecord; message: string }>(`/documents/${id}/outgest`, { method: "POST", body: JSON.stringify({}) }),
  documentVersions: (id: string) => request<DocumentVersion[]>(`/documents/${id}/versions`),
  documentJobs: (id: string) => request<IngestJob[]>(`/documents/${id}/ingest-status`),
  searchKnowledge: (query: string, scope: KnowledgeScope, documentId?: string, documentText?: string, documentTitle?: string) =>
    request<{ citations: Citation[]; query: string }>("/knowledge/search", {
      method: "POST",
      body: JSON.stringify({ query, scope, documentId, documentText, documentTitle })
    }),
  importFile: async (file: File, title: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    const response = await fetch(`${API_BASE}/files/import`, { method: "POST", body: formData });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || `Upload failed: ${response.status}`);
    }
    return response.json() as Promise<{ document: DocumentRecord }>;
  },
  askKnowledge: async function* (payload: AnswerRequest) {
    const response = await fetch(`${API_BASE}/knowledge/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok || !response.body) {
      const message = await response.json().catch(() => null);
      throw new Error(message?.message || `SSE request failed: ${response.status}`);
    }

    for await (const event of readSseStream<KnowledgeEvent>(response)) {
      yield event;
    }
  }
};
