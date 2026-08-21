import { Inject, Injectable } from "@nestjs/common";
import { deleteDocumentFromQdrant, upsertChunksToQdrant } from "../../infra/vector-index";
import { buildChunks } from "../../infra/rag";
import { WorkspaceStateService } from "../../state/workspace-state.service";

@Injectable()
export class DocumentsService {
  constructor(@Inject(WorkspaceStateService) private readonly workspace: WorkspaceStateService) {}

  listDocuments() {
    return this.workspace.store.listDocuments();
  }

  getDocument(id: string) {
    return this.workspace.store.getDocument(id);
  }

  createDocument(body: any) {
    const title = String(body?.title ?? "未命名文档");
    const contentText = String(body?.contentText ?? "在这里开始写作。");
    const tags = Array.isArray(body?.tags) ? body.tags.map(String) : [];
    return this.workspace.store.createDocument({
      title,
      contentText,
      tags,
      ownerId: "user-demo"
    });
  }

  async deleteDocument(id: string) {
    const current = this.workspace.store.getDocument(id);
    // 删除文档前先清索引，避免检索结果里还残留这篇文档的片段。
    this.workspace.store.clearChunks(id);
    await deleteDocumentFromQdrant(id);
    this.workspace.store.deleteDocument(id);
    return { message: `${current.title} 已删除`, id };
  }

  updateDocument(id: string, body: any) {
    const current = this.workspace.store.getDocument(id);
    return this.workspace.store.updateDocument(id, {
      title: typeof body?.title === "string" ? body.title : current.title,
      contentJson: typeof body?.contentJson === "string" ? body.contentJson : current.contentJson,
      contentText: typeof body?.contentText === "string" ? body.contentText : current.contentText,
      tags: Array.isArray(body?.tags) ? body.tags.map(String) : current.tags
    });
  }

  saveDocument(id: string, body: any) {
    const current = this.workspace.store.getDocument(id);
    const next = this.workspace.store.updateDocument(id, {
      title: typeof body?.title === "string" ? body.title : current.title,
      contentJson: typeof body?.contentJson === "string" ? body.contentJson : current.contentJson,
      contentText: typeof body?.contentText === "string" ? body.contentText : current.contentText,
      status: "saved"
    });
    const version = this.workspace.store.addVersion(id);
    return { document: next, version };
  }

  listVersions(id: string) {
    return this.workspace.store.listVersions(id);
  }

  async ingestDocument(id: string) {
    const current = this.workspace.store.getDocument(id);
    const version = this.workspace.store.addVersion(id);
    const job = this.workspace.store.createJob(id, version.id);
    this.workspace.store.updateDocument(id, { status: "indexing" });
    this.workspace.store.updateJob(job.id, { status: "running" });

    // 入库这里直接在同一进程执行，第一版先把可见链路打通，后面再切成真正的 worker/queue。
    const chunks = buildChunks(version);
    this.workspace.store.setChunks(id, chunks);
    void upsertChunksToQdrant(chunks, current.title);
    this.workspace.store.updateDocument(id, { status: "indexed" });
    this.workspace.store.updateJob(job.id, {
      status: "success",
      finishedAt: new Date().toISOString()
    });

    return {
      job,
      document: this.workspace.store.getDocument(current.id),
      chunkCount: chunks.length
    };
  }

  async outgestDocument(id: string) {
    const current = this.workspace.store.getDocument(id);
    this.workspace.store.clearChunks(id);
    await deleteDocumentFromQdrant(id);
    const document = this.workspace.store.updateDocument(id, { status: "saved" });
    return {
      document,
      message: `${current.title} 已出库，后续不会参与知识库检索。`
    };
  }

  ingestStatus(id: string) {
    return this.workspace.store.listJobs(id);
  }
}
