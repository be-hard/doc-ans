import type { AnswerRequest, Citation, DocumentRecord, DocumentVersion, IngestJob, KnowledgeEvent, KnowledgeScope } from "@docs-ans/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

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

export const api = {
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((entry) => entry.startsWith("data:"));
        if (!line) continue;
        const payloadText = line.slice(5).trim();
        if (!payloadText) continue;
        yield JSON.parse(payloadText) as KnowledgeEvent;
      }
    }
  }
};
