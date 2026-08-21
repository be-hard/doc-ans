export function getEnv() {
  const env = process.env;
  return {
    port: Number(env.API_PORT ?? 4000),
    openaiBaseUrl: env.OPENAI_BASE_URL?.trim() || "",
    openaiApiKey: env.OPENAI_API_KEY?.trim() || "",
    chatModel: env.CHAT_MODEL?.trim() || "gpt-4.1-mini",
    embeddingModel: env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    qdrantUrl: env.QDRANT_URL?.trim() || "http://localhost:6333",
    qdrantCollection: env.QDRANT_COLLECTION?.trim() || "docs-ans-chunks"
  };
}
