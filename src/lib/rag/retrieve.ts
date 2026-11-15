import { RAG_MIN_SCORE, RAG_TOP_K } from "../ai-config.js";
import prisma from "../db.js";
import { sourceProviders } from "../source-providers.js";

export type RetrievedChunk = {
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  chunkId: string;
  chunkIndex: number;
  page?: number;
  text: string;
  score: number;
};

export async function retrieveWorkspaceContext(
  workspaceId: string,
  query: string,
): Promise<RetrievedChunk[]> {
  const [embedding] = await sourceProviders.embedTexts([query]);
  const matches = await sourceProviders.queryWorkspaceVectors(
    workspaceId,
    embedding,
    RAG_TOP_K,
  );

  const liveSources = await prisma.source.findMany({
    where: {
      workspaceId,
      status: "READY",
      deletedAt: null,
      workspace: { deletedAt: null },
    },
    select: { id: true, jobId: true, metadata: true },
  });
  const live = new Map(liveSources.map((s) => [s.id, s]));
  const chunks: RetrievedChunk[] = [];

  for (const match of matches) {
    const score = match.score ?? 0;
    if (score < RAG_MIN_SCORE) {
      continue;
    }

    const metadata = match.metadata as Record<string, unknown> | undefined;
    if (
      !metadata ||
      typeof metadata.sourceId !== "string" ||
      typeof metadata.sourceTitle !== "string" ||
      typeof metadata.sourceType !== "string" ||
      typeof metadata.chunkId !== "string" ||
      typeof metadata.text !== "string"
    ) {
      continue;
    }

    if (!live.has(metadata.sourceId)) continue;
    const source = live.get(metadata.sourceId)!;
    if (source.jobId && metadata.jobId !== source.jobId) continue;
    const indexRun = (source.metadata as Record<string, unknown> | null)
      ?.indexRun;
    if (indexRun && metadata.runId !== indexRun) continue;
    chunks.push({
      sourceId: metadata.sourceId,
      sourceTitle: metadata.sourceTitle,
      sourceType: metadata.sourceType,
      chunkId: metadata.chunkId,
      chunkIndex: Number(metadata.chunkIndex ?? 0),
      ...(typeof metadata.page === "number" ? { page: metadata.page } : {}),
      text: metadata.text,
      score,
    });
  }

  return chunks;
}

export type UserMemoryContext = string;

export function buildChatSystemPrompt(input: {
  chunks: RetrievedChunk[];
  conversationSummary?: string | null;
  userMemories?: UserMemoryContext[];
  webSearchEnabled?: boolean;
}) {
  const sections: string[] = [
    "You are Chaibook, an assistant that helps users learn from their workspace sources.",
  ];

  if (input.webSearchEnabled) {
    sections.push(
      "You have access to a web_search tool for up-to-date information outside the workspace.",
      "Use it when the user asks about recent events or topics not covered by their sources.",
      "Cite web results inline using [W1], [W2], etc. matching the web result blocks.",
    );
  }

  if (input.userMemories?.length) {
    const memoryBlock = input.userMemories
      .map((memory) => `- ${memory}`)
      .join("\n");

    sections.push(
      "Known facts about this user (use when relevant):",
      memoryBlock,
    );
  }

  const summary = input.conversationSummary?.trim();
  if (summary) {
    sections.push("Earlier conversation summary:", summary);
  }

  if (input.chunks.length === 0) {
    sections.push(
      "This workspace has no indexed source content yet, or nothing relevant was retrieved.",
      input.webSearchEnabled
        ? "Use web search when needed, or answer from general knowledge."
        : "Answer helpfully from general knowledge and suggest adding or processing sources when appropriate.",
      "Do not invent citations.",
    );
    return sections.join("\n");
  }

  const context = input.chunks
    .map((chunk, index) => {
      const label = `[${index + 1}] ${chunk.sourceTitle} (${chunk.sourceType})${
        chunk.page ? `, page ${chunk.page}` : ""
      }`;
      return `${label}\n${chunk.text}`;
    })
    .join("\n\n");

  sections.push(
    "Use ONLY the retrieved context below when making factual claims about their materials.",
    "If the context is insufficient, say so clearly.",
    "Cite sources inline using [1], [2], etc. matching the numbered context blocks.",
    "Keep answers concise, accurate, and educational.",
    "",
    "Retrieved context:",
    context,
  );

  return sections.join("\n");
}
