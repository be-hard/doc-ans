import { getEnv } from "./env.js";
import type { ChunkRecord } from "@docs-ans/shared";
import { cosineSimilarity, embedText } from "./rag.js";

interface QdrantHit {
  id: string;
  score: number;
  payload?: {
    documentId?: string;
    documentTitle?: string;
    chunkId?: string;
    chunkIndex?: number;
    content?: string;
    headingPath?: string[];
    lineStart?: number;
    lineEnd?: number;
  };
}

export interface VectorSearchHit {
  id: string;
  score: number;
  documentId: string;
  documentTitle: string;
  chunkId: string;
  chunkIndex: number;
  quote: string;
  headingPath: string[];
  locationLabel: string;
}

async function ensureCollection() {
  const env = getEnv();
  const response = await fetch(`${env.qdrantUrl}/collections/${env.qdrantCollection}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      vectors: {
        size: 32,
        distance: "Cosine"
      }
    })
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Qdrant collection init failed: ${response.status}`);
  }
}

export async function upsertChunksToQdrant(chunks: ChunkRecord[], documentTitle: string) {
  const env = getEnv();
  try {
    await ensureCollection();
    const response = await fetch(
      `${env.qdrantUrl}/collections/${env.qdrantCollection}/points?wait=true`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          points: chunks.map((chunk) => ({
            id: chunk.id,
            vector: chunk.embedding,
            payload: {
              documentId: chunk.documentId,
              documentTitle,
              chunkId: chunk.id,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              headingPath: chunk.headingPath,
              lineStart: chunk.lineStart,
              lineEnd: chunk.lineEnd
            }
          }))
        })
      }
    );
    if (!response.ok) {
      throw new Error(`Qdrant upsert failed: ${response.status}`);
    }
    return { ok: true as const };
  } catch {
    // 第一版允许 Qdrant 不可用，这样本地依然能工作，不会因为依赖基础设施而阻塞体验。
    return { ok: false as const };
  }
}

function documentFilter(documentId?: string) {
  if (!documentId) return undefined;
  return {
    must: [
      {
        key: "documentId",
        match: { value: documentId }
      }
    ]
  };
}

export async function deleteDocumentFromQdrant(documentId: string) {
  const env = getEnv();
  try {
    const response = await fetch(
      `${env.qdrantUrl}/collections/${env.qdrantCollection}/points/delete?wait=true`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filter: documentFilter(documentId)
        })
      }
    );
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

export async function searchQdrant(query: string, limit = 5, documentId?: string): Promise<VectorSearchHit[]> {
  const env = getEnv();
  try {
    const vector = embedText(query);
    const response = await fetch(
      `${env.qdrantUrl}/collections/${env.qdrantCollection}/points/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vector,
          limit,
          with_payload: true,
          ...(documentId ? { filter: documentFilter(documentId) } : {})
        })
      }
    );
    if (!response.ok) {
      throw new Error(`Qdrant search failed: ${response.status}`);
    }
    const body = (await response.json()) as { result?: QdrantHit[] };
    return (body.result ?? []).map((hit) => ({
      id: hit.id,
      score: hit.score,
      documentId: hit.payload?.documentId ?? "",
      documentTitle: hit.payload?.documentTitle ?? "未命名文档",
      chunkId: hit.payload?.chunkId ?? hit.id,
      chunkIndex: hit.payload?.chunkIndex ?? 0,
      quote: hit.payload?.content ?? "",
      headingPath: hit.payload?.headingPath ?? [],
      locationLabel: `${(hit.payload?.headingPath ?? ["文档"]).join(" / ")} · 第 ${hit.payload?.lineStart ?? 1}-${hit.payload?.lineEnd ?? 1} 行 · 片段 ${(hit.payload?.chunkIndex ?? 0) + 1}`
    }));
  } catch {
    return [];
  }
}
