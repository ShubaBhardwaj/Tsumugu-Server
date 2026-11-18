import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  GEMINI_EMBEDDING_MODEL,
} from "./ai-config.js";
import { selectedAiProvider } from "./ai-provider.js";

export const OPENAI_EMBEDDING_PROFILE = `openai:${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}`;
export const GEMINI_EMBEDDING_PROFILE = `gemini:${GEMINI_EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}`;

export function activeEmbeddingProfile() {
  return selectedAiProvider() === "gemini"
    ? GEMINI_EMBEDDING_PROFILE
    : OPENAI_EMBEDDING_PROFILE;
}

export function workspaceVectorNamespace(workspaceId: string, profile = activeEmbeddingProfile()) {
  return profile === OPENAI_EMBEDDING_PROFILE
    ? workspaceId
    : `${profile}:${workspaceId}`;
}

export function allWorkspaceVectorNamespaces(workspaceId: string) {
  return [
    workspaceVectorNamespace(workspaceId, OPENAI_EMBEDDING_PROFILE),
    workspaceVectorNamespace(workspaceId, GEMINI_EMBEDDING_PROFILE),
  ];
}

export function indexedSourceProfile(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const data = metadata as Record<string, unknown>;
  if (typeof data.embeddingProfile === "string") return data.embeddingProfile;
  // Existing indexed sources predate provider stamps and used OpenAI.
  if (typeof data.indexRun === "string" || typeof data.indexedAt === "string")
    return OPENAI_EMBEDDING_PROFILE;
  return null;
}

export function sourceNeedsReindex(source: { status: string; metadata: unknown }) {
  const profile = indexedSourceProfile(source.metadata);
  return source.status === "READY"
    ? profile !== activeEmbeddingProfile()
    : profile !== null;
}

export function sourceIsSearchable(source: { status: string; metadata: unknown }) {
  return source.status === "READY" &&
    indexedSourceProfile(source.metadata) === activeEmbeddingProfile();
}
