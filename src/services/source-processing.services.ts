import prisma from "../lib/db.js";
import { chunkPages, chunkText } from "../lib/chunking.js";
import { sourceProviders } from "../lib/source-providers.js";
import { activeEmbeddingProfile, indexedSourceProfile } from "../lib/embedding-profile.js";
import { ValidationError } from "../types/app-error.js";
import type { JobContext } from "./job.services.js";

export async function processSourceJob(ctx: JobContext) {
  const runId = `${ctx.job.id}:${ctx.job.deliveryGeneration}`;
  const embeddingProfile = activeEmbeddingProfile();
  const source = await ctx.commit(async (tx) => {
    return tx.source.update({
      where: { id: ctx.job.resourceId },
      data: { status: "PROCESSING" },
    });
  });
  const metadata =
    source.metadata && typeof source.metadata === "object"
      ? (source.metadata as Record<string, any>)
      : {};
  let text = source.content?.trim() ?? "";
  let pages: string[] | undefined;
  if (source.type === "PDF") {
    if (!metadata.fileUrl)
      throw new ValidationError(
        "Original PDF is unavailable. Re-upload the PDF.",
      );
    try {
      const result = await sourceProviders.extractPdfFromCloudinary({
        fileUrl: metadata.fileUrl,
        publicId: metadata.publicId,
        resourceType: metadata.resourceType ?? "raw",
      });
      text = result.text;
      pages = result.pages;
    } catch {
      throw new ValidationError(
        "Original PDF could not be read. Re-upload or retry the PDF.",
      );
    }
  }
  if (!text) throw new ValidationError("Source has no usable text");
  const parts = pages ? chunkPages(pages) : chunkText(text);
  if (!parts.length) throw new ValidationError("No chunks were generated");
  const oldChunks = await prisma.sourceChunk.findMany({
    where: { sourceId: source.id },
    select: { id: true },
  });
  await ctx.check();
  const chunks = await ctx.commit(async (tx) => {
    await tx.sourceChunk.deleteMany({ where: { sourceId: source.id } });
    await tx.sourceChunk.createMany({
      data: parts.map((part) => ({
        id: `${runId}:${part.index}`,
        sourceId: source.id,
        index: part.index,
        content: part.content,
        tokenCount: Math.ceil(part.content.length / 4),
        metadata: part.metadata as any,
      })),
    });
    const rows = await tx.sourceChunk.findMany({
      where: { sourceId: source.id },
      orderBy: { index: "asc" },
    });
    await tx.source.update({
      where: { id: source.id },
      data: { content: text },
    });
    return rows;
  });
  try {
    for (let i = 0; i < chunks.length; i += 50) {
      await ctx.check();
      const batch = chunks.slice(i, i + 50);
      const embeddings = await sourceProviders.embedTexts(
        batch.map((c) => c.content),
      );
      await ctx.check();
      await sourceProviders.upsertSourceVectors(
        source.workspaceId,
        batch.map((chunk, n) => ({
          id: chunk.id,
          values: embeddings[n]!,
          metadata: {
            workspaceId: source.workspaceId,
            sourceId: source.id,
            chunkId: chunk.id,
            chunkIndex: chunk.index,
            sourceTitle: source.title,
            sourceType: source.type,
            text: chunk.content,
            jobId: ctx.job.id,
            runId,
            embeddingProfile,
            ...((chunk.metadata as any)?.page
              ? { page: (chunk.metadata as any).page }
              : {}),
          },
        })),
      );
      await ctx.check();
    }
    await sourceProviders.deleteVectorIds(
      source.workspaceId,
      oldChunks.map((chunk) => chunk.id),
    );
    await ctx.check();
    if (indexedSourceProfile(metadata) && indexedSourceProfile(metadata) !== embeddingProfile)
      await sourceProviders.deleteSourceVectorsInOtherProfiles(source.workspaceId, source.id);
    await ctx.commit((tx) =>
      tx.source.update({
        where: { id: source.id },
        data: {
          status: "READY",
          metadata: {
            ...metadata,
            pageCount: pages?.length ?? metadata.pageCount ?? null,
            chunkCount: chunks.length,
            indexedAt: new Date().toISOString(),
            indexRun: runId,
            embeddingProfile,
            processingError: null,
          },
        },
      }),
    );
  } catch (error) {
    // Delete only this run, never a newer generation's vectors.
    await sourceProviders
      .deleteJobVectors(source.workspaceId, source.id, ctx.job.id, runId)
      .catch(() => {});
    throw error;
  }
}
export async function listChunksForSource(sourceId: string) {
  const chunks = await prisma.sourceChunk.findMany({
    where: { sourceId },
    orderBy: { index: "asc" },
  });
  return { chunks, count: chunks.length };
}
