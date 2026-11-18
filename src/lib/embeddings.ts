import { embedMany } from "ai";
import { createGoogle } from "@ai-sdk/google";
import { EMBEDDING_DIMENSIONS, GEMINI_EMBEDDING_MODEL } from "./ai-config.js";
import { selectedAiProvider } from "./ai-provider.js";
import { embedTexts as embedWithOpenAI } from "./openai.js";
import { safeAiError } from "./ai-errors.js";

export const embeddingRuntime = { embedMany };

export async function embedTexts(
  texts: string[],
  task: "document" | "query" = "document",
): Promise<number[][]> {
  if (!texts.length) return [];
  if (selectedAiProvider() === "openai")
    return embedWithOpenAI(texts).catch((error) => { throw safeAiError(error); });
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const google = createGoogle({ apiKey });
  const result = await embeddingRuntime.embedMany({
    model: google.embedding(GEMINI_EMBEDDING_MODEL),
    values: texts,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(30000),
    providerOptions: {
      google: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
      },
    },
  }).catch((error) => { throw safeAiError(error); });
  if (result.embeddings.length !== texts.length ||
      result.embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS))
    throw new Error("Gemini embedding response has an unexpected dimension");
  return result.embeddings;
}
