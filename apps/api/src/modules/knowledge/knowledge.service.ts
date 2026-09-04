import { BadRequestException, HttpException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Response } from "express";
import type { AnswerRequest, KnowledgeEvent, KnowledgeScope } from "@docs-ans/shared";
import { streamAnswer, streamChatCompletion, type SensenovaContentPart } from "../../infra/llm.js";
import { buildPreviewChunks, searchChunks } from "../../infra/rag.js";
import { searchQdrant, type VectorSearchHit } from "../../infra/vector-index.js";
import { WorkspaceStateService } from "../../state/workspace-state.service.js";
import { getEnv } from "../../infra/env.js";
const env = getEnv();

const supportedAiAskModels = new Set(["sensenova-6.8-flash-lite", "kimi-k3", "glm-5.2"]);

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(@Inject(WorkspaceStateService) private readonly workspace: WorkspaceStateService) { }

  async aiAsk(body: any, res?: Response) {
    const question = String(body?.question ?? "").trim();
    const model =
      typeof body?.model === "string" && supportedAiAskModels.has(body.model)
        ? body.model
        : env.chatModel;
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
    if (!question) {
      if (res) {
        res.status(400).json({ message: "Question is required" });
        return;
      }
      throw new BadRequestException("Question is required");
    }

    if (res) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.socket?.setNoDelay(true);
      res.write(":\n\n");
    }

    try {
      const startedAt = performance.now();
      this.logger.log(`[aiAsk] start model="${model}" question="${question}" attachments=${attachments.length}`);

      if (!env.openaiApiKey) {
        const message = "未配置 OPENAI_API_KEY，无法直接调用 AI。";
        if (res) {
          res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
          res.end();
          return;
        }
        return { answer: message };
      }

      if (model === "glm-5.2" && attachments.length > 0) {
        const message = "glm-5.2 不支持多模态输入，请移除图片或视频后再试。";
        if (res) {
          res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
          res.end();
          return;
        }
        throw new BadRequestException(message);
      }

      const streamRequestedAt = performance.now();
      const content: SensenovaContentPart[] = [
        { type: "text", text: question },
        ...attachments.filter((item: unknown): item is SensenovaContentPart => {
          return Boolean(item && typeof item === "object" && "type" in item);
        })
      ];
      const stream = streamChatCompletion(
        [{ role: "user", content }],
        {
          model,
          reasoningEffort: "low",
          temperature: 1,
          traceLabel: `aiAsk/${model}`
        }
      );
      this.logger.log(`[aiAsk] reasoning_effort=low stream ready in ${(performance.now() - streamRequestedAt).toFixed(0)}ms`);

      let answer = "";
      let firstDeltaLogged = false;
      for await (const chunk of stream) {
        answer += chunk;
        if (!firstDeltaLogged) {
          firstDeltaLogged = true;
          this.logger.log(`[aiAsk] first delta in ${(performance.now() - startedAt).toFixed(0)}ms`);
        }
        this.logger.log(`[aiAsk] delta chunk="${chunk}"`);
        if (res) {
          res.write(`data: ${JSON.stringify({ type: "delta", text: chunk })}\n\n`);
        }
      }

      this.logger.log(`[aiAsk] done in ${(performance.now() - startedAt).toFixed(0)}ms`);
      if (res) {
        res.write(`data: ${JSON.stringify({ type: "done", answer })}\n\n`);
        res.end();
        return;
      }

      return { answer };
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed";
      this.logger.error("AI 回答超时", error instanceof Error ? error.stack : undefined);
      if (res) {
        res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
        res.end();
        return;
      }
      throw new InternalServerErrorException(message);
    }
  }

  async searchKnowledge(body: any) {
    const query = String(body?.query ?? "").trim();
    if (!query) {
      throw new BadRequestException("Query is required");
    }
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

    const startedAt = performance.now();
    let hits;
    try {
      const searchStartedAt = performance.now();
      hits = await this.collectSearchHits(question, scope, documentId, documentText, documentTitle);
      this.logger.log(`[answerKnowledge] search done in ${(performance.now() - searchStartedAt).toFixed(0)}ms`);
    } catch (error) {
      this.respondWithError(res, error);
      return;
    }

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
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    res.write(":\n\n");

    this.writeEvent(res, { type: "searching", message: "正在检索相关知识片段" });
    this.writeEvent(res, { type: "citation", citations });
    this.logger.log(citations,"检索到的引用片段");
    let answer = "";
    try {
      const resolvedDocumentTitle = documentId ? this.getDocumentTitleOrThrow(documentId) : undefined;
      let firstDeltaLogged = false;
      for await (const delta of streamAnswer({
        question,
        citations,
        ...(resolvedDocumentTitle ? { documentTitle: resolvedDocumentTitle } : {})
      }, {
        reasoningEffort: "low",
        traceLabel: "answerKnowledge"
      })) {
        answer += delta;
        if (!firstDeltaLogged) {
          firstDeltaLogged = true;
          this.logger.log(`[answerKnowledge] first delta in ${(performance.now() - startedAt).toFixed(0)}ms`);
        }
        this.writeEvent(res, { type: "delta", text: delta });
      }

      this.logger.log(`[answerKnowledge] done in ${(performance.now() - startedAt).toFixed(0)}ms`);
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
    if (typeof (res as Response & { flush?: () => void }).flush === "function") {
      (res as Response & { flush?: () => void }).flush?.();
    }
  }

  private respondWithError(res: Response, error: unknown) {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const payload = error instanceof HttpException ? error.getResponse() : undefined;
    const message =
      typeof payload === "string"
        ? payload
        : payload && typeof payload === "object" && "message" in payload
          ? String(Array.isArray(payload.message) ? payload.message.join(", ") : payload.message)
          : error instanceof Error
            ? error.message
            : "请求失败";

    if (res.headersSent) {
      this.writeEvent(res, { type: "error", message });
      res.end();
      return;
    }

    res.status(status).json({ message });
  }

  private getDocumentTitleOrThrow(documentId: string) {
    try {
      return this.workspace.store.getDocument(documentId).title;
    } catch {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
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
    const qdrantTitle = filterDocumentId ? this.getDocumentTitleOrThrow(filterDocumentId) : "全部知识库";
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
