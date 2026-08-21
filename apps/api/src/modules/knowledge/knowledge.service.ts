import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { AnswerRequest, KnowledgeEvent, KnowledgeScope } from "@docs-ans/shared";
import { streamAnswer } from "../../infra/llm";
import { buildPreviewChunks, searchChunks } from "../../infra/rag";
import { searchQdrant, type VectorSearchHit } from "../../infra/vector-index";
import { WorkspaceStateService } from "../../state/workspace-state.service";

@Injectable()
export class KnowledgeService {
  constructor(@Inject(WorkspaceStateService) private readonly workspace: WorkspaceStateService) {}

  async searchKnowledge(body: any) {
    const query = String(body?.query ?? "");
    const documentId = typeof body?.documentId === "string" ? body.documentId : undefined;
    const documentText = typeof body?.documentText === "string" ? body.documentText : undefined;
    const documentTitle = typeof body?.documentTitle === "string" ? body.documentTitle : undefined;
    const scope: KnowledgeScope = body?.scope === "all" ? "all" : "current";
    const hits = await this.collectSearchHits(query, scope, documentId, documentText, documentTitle);
    return {
      query,
      scope,
      citations: hits.map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        chunkIndex: chunk.chunkIndex,
        headingPath: chunk.headingPath,
        locationLabel: chunk.locationLabel,
        quote: chunk.quote,
        score: chunk.score
      })),
      chunks: hits
    };
  }

  async answerKnowledge(body: AnswerRequest, res: Response) {
    const question = String(body?.question ?? "").trim();
    const documentId = body?.documentId;
    const documentText = body?.documentText;
    const documentTitle = body?.documentTitle;
    const scope = body?.scope === "all" ? "all" : "current";
    const sessionId = body?.sessionId || randomUUID();

    if (!question) {
      res.status(400).json({ message: "Question is required" });
      return;
    }

    const hits = await this.collectSearchHits(question, scope, documentId, documentText, documentTitle);
    const citations = hits.map((hit) => ({
      chunkId: hit.chunkId,
      documentId: hit.documentId,
      documentTitle: hit.documentTitle,
      chunkIndex: hit.chunkIndex,
      headingPath: hit.headingPath,
      locationLabel: hit.locationLabel,
      quote: hit.quote,
      score: hit.score
    }));

    this.workspace.store.pushQaMessage({
      id: randomUUID(),
      sessionId,
      role: "user",
      content: question,
      citations: [],
      createdAt: new Date().toISOString()
    });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    this.writeEvent(res, { type: "searching", message: "正在检索相关知识片段" });
    this.writeEvent(res, { type: "citation", citations });

    let answer = "";
    try {
      for await (const delta of streamAnswer({
        question,
        citations,
        ...(documentId ? { documentTitle: this.workspace.store.getDocument(documentId).title } : {})
      })) {
        answer += delta;
        this.writeEvent(res, { type: "delta", text: delta });
      }

      this.writeEvent(res, { type: "done", answer });
      this.workspace.store.pushQaMessage({
        id: randomUUID(),
        sessionId,
        role: "assistant",
        content: answer,
        citations,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      this.writeEvent(res, {
        type: "error",
        message: error instanceof Error ? error.message : "回答失败"
      });
    } finally {
      res.end();
    }
  }

  listMessages(sessionId: string) {
    return this.workspace.store.listQaMessages(sessionId);
  }

  private writeEvent(res: Response, event: KnowledgeEvent) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private mapHitsToVectorHits(
    hits: Array<ReturnType<typeof searchChunks>[number]>,
    documentTitle: string
  ): VectorSearchHit[] {
    return hits.map((chunk) => ({
      id: chunk.id,
      score: chunk.score,
      documentId: chunk.documentId,
      documentTitle,
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      quote: chunk.content,
      headingPath: chunk.headingPath,
      locationLabel: `${chunk.headingPath.join(" / ")} · 第 ${chunk.lineStart}-${chunk.lineEnd} 行 · 片段 ${chunk.chunkIndex + 1}`
    }));
  }

  private hitKey(hit: VectorSearchHit) {
    // 这里用“位置 + 内容”做去重键，避免草稿和已保存版本在同一段落重复返回两次。
    return [hit.documentId, hit.chunkIndex, hit.quote, hit.headingPath.join("/"), hit.locationLabel.split(" · ")[1] ?? ""].join("|");
  }

  private mergeSearchHits(...groups: VectorSearchHit[][]) {
    const merged = new Map<string, VectorSearchHit>();
    for (const group of groups) {
      for (const hit of group) {
        const key = this.hitKey(hit);
        const current = merged.get(key);
        if (!current || hit.score > current.score) {
          merged.set(key, hit);
        }
      }
    }
    return [...merged.values()].sort((a, b) => b.score - a.score);
  }

  private async collectSearchHits(
    query: string,
    scope: KnowledgeScope = "current",
    documentId?: string,
    documentText?: string,
    documentTitle?: string
  ) {
    const filterDocumentId = scope === "current" ? documentId : undefined;
    const qdrantTitle = filterDocumentId ? this.workspace.store.getDocument(filterDocumentId).title : "全部知识库";
    const qdrantPromise = searchQdrant(query, 5, filterDocumentId);
    const localHits = searchChunks(query, this.workspace.store.listChunks(filterDocumentId), 5);
    const previewHits = documentText ? searchChunks(query, buildPreviewChunks(documentText, documentId ?? "draft", documentTitle ?? qdrantTitle), 5) : [];
    const qdrantHits = await qdrantPromise;
    // 检索结果按“线上向量库 + 本地已保存片段 + 当前草稿”合并。
    // 这样用户在编辑器里刚写下的新内容，也能马上被问答和搜索命中。
    return this.mergeSearchHits(
      qdrantHits,
      this.mapHitsToVectorHits(localHits, qdrantTitle),
      previewHits.length ? this.mapHitsToVectorHits(previewHits, documentTitle ?? qdrantTitle) : []
    ).slice(0, 5);
  }
}
