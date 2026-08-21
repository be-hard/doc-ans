import { randomUUID } from "node:crypto";
import type { Citation, ChunkRecord, DocumentVersion } from "@docs-ans/shared";

export function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+|(?=[A-Z])/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

interface SplitChunk {
  content: string;
  headingPath: string[];
  lineStart: number;
  lineEnd: number;
}

export function splitTextIntoChunks(text: string, maxLen = 320): SplitChunk[] {
  // 这里不做过度聪明的分段，先保证“标题/段落/句子”都能稳定切开，便于引用回填。
  const lines = text.split(/\n/g);
  const chunks: SplitChunk[] = [];
  let buffer = "";
  let lineStart = 1;
  let currentHeading = "正文";

  const flush = (lineEnd: number) => {
    if (!buffer.trim()) return;
    chunks.push({
      content: buffer.trim(),
      headingPath: [currentHeading],
      lineStart,
      lineEnd: Math.max(lineStart, lineEnd)
    });
    buffer = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    const lineNo = index + 1;
    if (!line) {
      flush(lineNo);
      lineStart = lineNo + 1;
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      flush(lineNo - 1);
      currentHeading = line.replace(/^#{1,3}\s+/, "").trim();
      lineStart = lineNo;
    }
    if ((buffer + "\n" + line).trim().length > maxLen && buffer) {
      flush(lineNo - 1);
      lineStart = lineNo;
      buffer = line;
      continue;
    }
    buffer = `${buffer}\n${line}`.trim();
  }
  flush(lines.length);
  return chunks.length
    ? chunks
    : [{ content: text.trim(), headingPath: ["正文"], lineStart: 1, lineEnd: Math.max(1, lines.length) }];
}

export function embedText(text: string) {
  // 第一版默认使用可离线运行的轻量 embedding，保证没有 OpenAI key 时也能跑通。
  const tokens = tokenize(text);
  const vector = new Array(32).fill(0);
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    vector[hash % vector.length] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denom ? dot / denom : 0;
}

export function buildChunks(version: DocumentVersion, sourceType: "document" | "import" = "document") {
  const chunkTexts = splitTextIntoChunks(version.contentText);
  return chunkTexts.map<ChunkRecord>((content, index) => ({
    id: randomUUID(),
    documentId: version.documentId,
    versionId: version.id,
    chunkIndex: index,
    content: content.content,
    headingPath: [version.title, ...content.headingPath],
    lineStart: content.lineStart,
    lineEnd: content.lineEnd,
    tokenCount: tokenize(content.content).length,
    sourceType,
    embedding: embedText(content.content)
  }));
}

export function buildPreviewChunks(
  text: string,
  documentId = "draft",
  documentTitle = "当前草稿"
) {
  const chunkTexts = splitTextIntoChunks(text);
  return chunkTexts.map<ChunkRecord>((content, index) => ({
    id: randomUUID(),
    documentId,
    versionId: "draft",
    chunkIndex: index,
    content: content.content,
    headingPath: [documentTitle, ...content.headingPath],
    lineStart: content.lineStart,
    lineEnd: content.lineEnd,
    tokenCount: tokenize(content.content).length,
    sourceType: "document",
    embedding: embedText(content.content)
  }));
}

function keywordScore(query: string, content: string) {
  const normalizedQuery = query.toLowerCase().trim();
  const normalizedContent = content.toLowerCase();
  const terms = tokenize(query);
  const termHits = terms.filter((term) => normalizedContent.includes(term)).length;
  const phraseHit = normalizedQuery && normalizedContent.includes(normalizedQuery) ? 1 : 0;
  return terms.length ? termHits / terms.length + phraseHit : phraseHit;
}

export function searchChunks(
  query: string,
  chunks: ChunkRecord[],
  limit = 5
): Array<ChunkRecord & { score: number }> {
  const queryEmbedding = embedText(query);
  return chunks
    .map((chunk) => {
      const semantic = cosineSimilarity(queryEmbedding, chunk.embedding);
      const keyword = keywordScore(query, chunk.content);
      return {
        ...chunk,
        score: keyword * 0.78 + semantic * 0.22
      };
    })
    .filter((chunk) => chunk.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function chunksToCitations(chunks: Array<ChunkRecord & { score: number }>, documentTitle: string): Citation[] {
  return chunks.map((chunk) => ({
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle,
    chunkIndex: chunk.chunkIndex,
    headingPath: chunk.headingPath,
    locationLabel: `${chunk.headingPath.join(" / ")} · 第 ${chunk.lineStart}-${chunk.lineEnd} 行 · 片段 ${chunk.chunkIndex + 1}`,
    quote: chunk.content.slice(0, 180),
    score: chunk.score
  }));
}
