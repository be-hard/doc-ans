import { Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { deleteDocumentFromQdrant, upsertChunksToQdrant } from "../../infra/vector-index.js";
import { buildChunks } from "../../infra/rag.js";
import { WorkspaceStateService } from "../../state/workspace-state.service.js";

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(@Inject(WorkspaceStateService) private readonly workspace: WorkspaceStateService) {}

  listDocuments() {
    return this.workspace.store.listDocuments();
  }

  getDocument(id: string) {
    return this.getDocumentOrThrow(id);
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
    const current = this.getDocumentOrThrow(id);
    try {
      await deleteDocumentFromQdrant(id);
      // 删除文档时先删向量索引，再清本地状态，避免只删掉一半。
      this.workspace.store.clearChunks(id);
      this.workspace.store.deleteDocument(id);
      return { message: `${current.title} 已删除`, id };
    } catch (error) {
      this.logger.error(`Failed to delete document ${id}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException("Failed to delete document");
    }
  }

  updateDocument(id: string, body: any) {
    const current = this.getDocumentOrThrow(id);
    return this.workspace.store.updateDocument(id, {
      title: typeof body?.title === "string" ? body.title : current.title,
      contentJson: typeof body?.contentJson === "string" ? body.contentJson : current.contentJson,
      contentText: typeof body?.contentText === "string" ? body.contentText : current.contentText,
      tags: Array.isArray(body?.tags) ? body.tags.map(String) : current.tags
    });
  }

  saveDocument(id: string, body: any) {
    const current = this.getDocumentOrThrow(id);
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
    this.getDocumentOrThrow(id);
    return this.workspace.store.listVersions(id);
  }

  async ingestDocument(id: string) {
    const current = this.getDocumentOrThrow(id);
    const version = this.workspace.store.addVersion(id);
    const job = this.workspace.store.createJob(id, version.id);

    this.workspace.store.updateDocument(id, { status: "indexing" });
    this.workspace.store.updateJob(job.id, { status: "running" });

    try {
      // 入库这里直接在同一进程执行，第一版先把可见链路打通，后面再切成真正的 worker/queue。
      const chunks = buildChunks(version);
      this.workspace.store.setChunks(id, chunks);
      void this.syncChunksToQdrant(id, job.id, chunks, current.title);

      return {
        job,
        document: this.workspace.store.getDocument(current.id),
        chunkCount: chunks.length
      };
    } catch (error) {
      this.failJob(id, job.id, error);
      throw new InternalServerErrorException("Failed to ingest document");
    }
  }

  async outgestDocument(id: string) {
    const current = this.getDocumentOrThrow(id);
    try {
      await deleteDocumentFromQdrant(id);
      this.workspace.store.clearChunks(id);
      const document = this.workspace.store.updateDocument(id, { status: "saved" });
      return {
        document,
        message: `${current.title} 已出库，后续不会参与知识库检索。`
      };
    } catch (error) {
      this.logger.error(`Failed to outgest document ${id}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException("Failed to outgest document");
    }
  }

  ingestStatus(id: string) {
    this.getDocumentOrThrow(id);
    return this.workspace.store.listJobs(id);
  }

  private getDocumentOrThrow(id: string) {
    try {
      return this.workspace.store.getDocument(id);
    } catch {
      throw new NotFoundException(`Document ${id} not found`);
    }
  }

  private async syncChunksToQdrant(documentId: string, jobId: string, chunks: ReturnType<typeof buildChunks>, title: string) {
    try {
      await upsertChunksToQdrant(chunks, title);
      this.workspace.store.updateDocument(documentId, { status: "indexed" });
      this.workspace.store.updateJob(jobId, {
        status: "success",
        finishedAt: new Date().toISOString()
      });
    } catch (error) {
      this.failJob(documentId, jobId, error);
    }
  }

  private failJob(documentId: string, jobId: string, error: unknown) {
    this.logger.error(`Failed to process document ${documentId}`, error instanceof Error ? error.stack : undefined);
    try {
      this.workspace.store.updateDocument(documentId, { status: "saved" });
    } catch (updateError) {
      this.logger.error(`Failed to restore document state for ${documentId}`, updateError instanceof Error ? updateError.stack : undefined);
    }

    try {
      this.workspace.store.updateJob(jobId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        finishedAt: new Date().toISOString()
      });
    } catch (updateError) {
      this.logger.error(`Failed to update job state for ${jobId}`, updateError instanceof Error ? updateError.stack : undefined);
    }
  }
}
