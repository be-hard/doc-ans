export type DocumentStatus = "draft" | "saved" | "indexing" | "indexed" | "failed";

export type ChunkSourceType = "document" | "import";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface DocumentRecord {
  id: string;
  title: string;
  status: DocumentStatus;
  ownerId: string;
  contentJson: string;
  contentText: string;
  createdAt: string;
  updatedAt: string;
  versionNo: number;
  tags: string[];
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNo: number;
  title: string;
  contentJson: string;
  contentText: string;
  createdAt: string;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  versionId: string;
  chunkIndex: number;
  content: string;
  headingPath: string[];
  lineStart: number;
  lineEnd: number;
  tokenCount: number;
  sourceType: ChunkSourceType;
  embedding: number[];
}

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  headingPath: string[];
  locationLabel: string;
  quote: string;
  score: number;
}

export type KnowledgeScope = "current" | "all";

export interface AnswerRequest {
  question: string;
  documentId?: string;
  sessionId?: string;
  documentText?: string;
  documentTitle?: string;
  scope?: KnowledgeScope;
}

export type KnowledgeEvent =
  | { type: "searching"; message: string }
  | { type: "delta"; text: string }
  | { type: "citation"; citations: Citation[] }
  | { type: "done"; answer: string }
  | { type: "error"; message: string };

export interface QaMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  createdAt: string;
}

export interface IngestJob {
  id: string;
  documentId: string;
  versionId: string;
  status: "pending" | "running" | "success" | "failed";
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface SeedDocument {
  title: string;
  contentText: string;
  tags?: string[];
}

export const defaultWorkbenchTheme = {
  blue950: "#0d1b2a",
  blue900: "#12335c",
  blue800: "#154b8b",
  blue700: "#1d65c1",
  blue600: "#2e77e5",
  blue100: "#e8f1ff",
  blue50: "#f5f9ff",
  slate900: "#101828",
  slate700: "#344054",
  slate500: "#667085",
  line: "#dbe6f4",
  lineSoft: "#e8eef8",
  panel: "#ffffff",
  canvas: "#f3f7fd"
} as const;
