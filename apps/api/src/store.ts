import { randomUUID } from "node:crypto";
import type { ChunkRecord, DocumentRecord, DocumentVersion, IngestJob, QaMessage, SeedDocument, User } from "@docs-ans/shared";

export interface SeedState {
  documents: SeedDocument[];
}

export class InMemoryStore {
  private readonly users = new Map<string, User>();
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly versions = new Map<string, DocumentVersion[]>();
  private readonly chunks = new Map<string, ChunkRecord[]>();
  private readonly jobs = new Map<string, IngestJob>();
  private readonly qaMessages = new Map<string, QaMessage[]>();

  constructor(seed: SeedState) {
    const user: User = {
      id: "user-demo",
      email: "demo@docs-ans.dev",
      name: "Demo User"
    };
    this.users.set(user.id, user);

    for (const doc of seed.documents) {
      this.createDocument({
        title: doc.title,
        contentText: doc.contentText,
        tags: doc.tags ?? [],
        ownerId: user.id
      });
    }
  }

  listUsers() {
    return [...this.users.values()];
  }

  listDocuments() {
    return [...this.documents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getDocument(id: string) {
    const doc = this.documents.get(id);
    if (!doc) {
      throw new Error("Document not found");
    }
    return doc;
  }

  createDocument(input: { title: string; contentText: string; tags: string[]; ownerId: string }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const contentJson = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: input.contentText }]
        }
      ]
    });
    const record: DocumentRecord = {
      id,
      title: input.title,
      ownerId: input.ownerId,
      contentJson,
      contentText: input.contentText,
      tags: input.tags,
      status: "saved",
      createdAt: now,
      updatedAt: now,
      versionNo: 1
    };
    this.documents.set(id, record);
    this.versions.set(id, [
      {
        id: randomUUID(),
        documentId: id,
        versionNo: 1,
        title: record.title,
        contentJson: record.contentJson,
        contentText: record.contentText,
        createdAt: now
      }
    ]);
    this.qaMessages.set(id, []);
    return record;
  }

  updateDocument(id: string, patch: Partial<Pick<DocumentRecord, "title" | "contentJson" | "contentText" | "status" | "tags">>) {
    const current = this.getDocument(id);
    const next: DocumentRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.documents.set(id, next);
    return next;
  }

  addVersion(documentId: string) {
    const doc = this.getDocument(documentId);
    const list = this.versions.get(documentId) ?? [];
    const version: DocumentVersion = {
      id: randomUUID(),
      documentId,
      versionNo: list.length + 1,
      title: doc.title,
      contentJson: doc.contentJson,
      contentText: doc.contentText,
      createdAt: new Date().toISOString()
    };
    list.push(version);
    this.versions.set(documentId, list);
    this.updateDocument(documentId, { status: "saved" });
    return version;
  }

  listVersions(documentId: string) {
    return this.versions.get(documentId) ?? [];
  }

  setChunks(documentId: string, chunks: ChunkRecord[]) {
    this.chunks.set(documentId, chunks);
  }

  clearChunks(documentId: string) {
    this.chunks.delete(documentId);
  }

  deleteDocument(documentId: string) {
    // 删除文档时要把版本、chunk、作业和对话记录一起清掉，避免“文档没了但索引还在”的幽灵状态。
    this.documents.delete(documentId);
    this.versions.delete(documentId);
    this.chunks.delete(documentId);
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.documentId === documentId) {
        this.jobs.delete(jobId);
      }
    }
    this.qaMessages.delete(documentId);
  }

  listChunks(documentId?: string) {
    if (documentId) {
      return this.chunks.get(documentId) ?? [];
    }
    return [...this.chunks.values()].flat();
  }

  createJob(documentId: string, versionId: string) {
    const job: IngestJob = {
      id: randomUUID(),
      documentId,
      versionId,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    this.jobs.set(job.id, job);
    return job;
  }

  updateJob(id: string, patch: Partial<IngestJob>) {
    const current = this.jobs.get(id);
    if (!current) {
      throw new Error("Job not found");
    }
    const next = { ...current, ...patch };
    this.jobs.set(id, next);
    return next;
  }

  listJobs(documentId?: string) {
    const all = [...this.jobs.values()];
    return documentId ? all.filter((job) => job.documentId === documentId) : all;
  }

  pushQaMessage(message: QaMessage) {
    const list = this.qaMessages.get(message.sessionId) ?? [];
    list.push(message);
    this.qaMessages.set(message.sessionId, list);
  }

  listQaMessages(sessionId: string) {
    return this.qaMessages.get(sessionId) ?? [];
  }
}

export function seedDocuments(): SeedState {
  return {
    documents: [
      {
        title: "  Typescript 教程",
        tags: ["RAG", "TypeScript"],
        contentText:
          "TypeScript 是 JavaScript 的超集，强调静态类型和可维护性。LangChain 适合做复杂工具调用，但在文档工作台里，更重要的是稳定的 chunk、检索和引用回填。"
      },
      {
        title: "跟算法第三方",
        tags: ["RAG"],
        contentText:
          "当知识库需要答复用户时，先检索相关 chunk，再把证据片段拼进上下文，最后由模型输出带引用的答案。"
      },
      {
        title: "端到端验证文档",
        tags: ["QA", "Draft"],
        contentText:
          "编辑器、入库和 SSE 流式回答必须在一个闭环里打通，才能让工作台看起来像一个真正的产品。"
      }
    ]
  };
}
