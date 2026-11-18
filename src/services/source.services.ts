import { sourceProviders } from "../lib/source-providers.js";
import { sourceNeedsReindex } from "../lib/embedding-profile.js";
import {
  findSourceByIdAndWorkspaceId,
  findSourcesByWorkspaceId,
  type CreateSourceData,
} from "../repository/source.repository.js";
import {
  createJob,
  workspaceTransaction,
} from "../repository/job.repository.js";
import { kickJob } from "./job.services.js";
import { AppError, NotFoundError } from "../types/app-error.js";
import type {
  CreateSourceInput,
  ImportWebsiteInput,
  ImportYoutubeInput,
  ListSourcesQuery,
} from "../validators/source.validator.js";
import { getWorkspaceByIdForUser } from "./workspace.services.js";

async function createAndProcessSource(userId: string, data: CreateSourceData) {
  const result = await workspaceTransaction(data.workspaceId, async (tx) => {
    if (
      !(await tx.workspace.findFirst({
        where: { id: data.workspaceId, userId, deletedAt: null },
      }))
    )
      throw new NotFoundError("Workspace not found");
    const source = await tx.source.create({ data });
    const job = await createJob(tx, {
      type: "SOURCE",
      resourceId: source.id,
      ownerId: userId,
      workspaceId: source.workspaceId,
    });
    return tx.source.update({
      where: { id: source.id },
      data: { jobId: job.id },
    });
  });
  kickJob(result.jobId!);
  return withSourceReadiness(result);
}
function withSourceReadiness<T extends { status: string; metadata: unknown }>(source: T) {
  return { ...source, needsReindex: sourceNeedsReindex(source) };
}
export async function listSourcesForWorkspace(
  workspaceId: string,
  userId: string,
  filters: ListSourcesQuery = {},
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  return (await findSourcesByWorkspaceId(workspaceId, filters)).map(withSourceReadiness);
}
export async function getSourceForWorkspace(
  workspaceId: string,
  sourceId: string,
  userId: string,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  const source = await findSourceByIdAndWorkspaceId(sourceId, workspaceId);
  if (!source) throw new NotFoundError("Source not found");
  return withSourceReadiness(source);
}
export async function bulkDeleteSourcesForWorkspace(
  workspaceId: string,
  userId: string,
  sourceIds: string[],
  expectedRevisions?: Record<string, string>,
) {
  const ids = [...new Set(sourceIds)];
  const jobs = await workspaceTransaction(workspaceId, async (tx) => {
    if (
      !(await tx.workspace.findFirst({
        where: { id: workspaceId, userId, deletedAt: null },
      }))
    )
      throw new NotFoundError("Workspace not found");
    const sources = await tx.source.findMany({
      where: { id: { in: ids }, workspaceId, deletedAt: null },
    });
    if (sources.length !== ids.length)
      throw new NotFoundError("Source not found");
    if (expectedRevisions) {
      const bindings = await tx.mobileSourceBinding.findMany({
        where: { workspaceId, sourceId: { in: ids }, deletedAt: null },
      });
      if (
        Object.keys(expectedRevisions).length !== ids.length ||
        bindings.length !== ids.length ||
        bindings.some(
          (binding) =>
            binding.contentRevision !== expectedRevisions[binding.sourceId!],
        )
      )
        throw new AppError(
          409,
          "Source revision changed or source is not mobile-bound. Reload mobile bindings.",
          undefined,
          "REVISION_CONFLICT",
        );
    }
    await tx.mobileSourceBinding.updateMany({
      where: { workspaceId, sourceId: { in: ids } },
      data: { deletedAt: new Date() },
    });
    await tx.source.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
    await tx.backgroundJob.updateMany({
      where: {
        resourceId: { in: ids },
        type: "SOURCE",
        status: { in: ["PENDING", "DISPATCHED", "RUNNING"] },
      },
      data: { status: "CANCELLED" },
    });
    return Promise.all(
      sources.map((source) =>
        createJob(tx, {
          type: "SOURCE_CLEANUP",
          ownerId: userId,
          workspaceId,
          resourceId: source.id,
          dedupeKey: `delete:${source.id}`,
          payload: { metadata: source.metadata ?? {} },
        }),
      ),
    );
  });
  for (const job of jobs) kickJob(job.id);
}
export async function deleteSourceForWorkspace(
  workspaceId: string,
  sourceId: string,
  userId: string,
  expectedRevision?: string,
) {
  await bulkDeleteSourcesForWorkspace(
    workspaceId,
    userId,
    [sourceId],
    expectedRevision ? { [sourceId]: expectedRevision } : undefined,
  );
}
export async function createTextOrMarkdownSource(
  workspaceId: string,
  userId: string,
  input: CreateSourceInput,
) {
  return createAndProcessSource(userId, {
    workspaceId,
    ...input,
    status: "PENDING",
  });
}
export async function importWebsiteSource(
  workspaceId: string,
  userId: string,
  input: ImportWebsiteInput,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  const scraped = await sourceProviders.scrapeWebsite(input.url);
  return createAndProcessSource(userId, {
    workspaceId,
    type: "WEBSITE",
    title: input.title || scraped.title || input.url,
    content: scraped.markdown,
    url: scraped.sourceUrl,
    metadata: { importedFrom: scraped.sourceUrl },
  });
}
export async function uploadPdfSource(
  workspaceId: string,
  userId: string,
  file: Express.Multer.File,
  title?: string,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  const upload = await sourceProviders.uploadPdfToCloudinary(
    file.buffer,
    file.originalname,
  );
  return createAndProcessSource(userId, {
    workspaceId,
    type: "PDF",
    title: title?.trim() || file.originalname.replace(/\.pdf$/i, ""),
    metadata: {
      fileUrl: upload.secureUrl,
      fileName: upload.originalFilename,
      fileSize: upload.bytes,
      publicId: upload.publicId,
      resourceType: upload.resourceType,
    },
  });
}
export async function importYoutubeSource(
  workspaceId: string,
  userId: string,
  input: ImportYoutubeInput,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  const transcript = await sourceProviders.fetchYoutubeTranscript(input.url);
  return createAndProcessSource(userId, {
    workspaceId,
    type: "YOUTUBE",
    title: input.title || `YouTube: ${transcript.videoId}`,
    content: transcript.content,
    url: input.url,
    metadata: { videoId: transcript.videoId },
  });
}
export async function reprocessSource(
  workspaceId: string,
  sourceId: string,
  userId: string,
) {
  await getSourceForWorkspace(workspaceId, sourceId, userId);
  const job = await workspaceTransaction(workspaceId, async (tx) => {
    if (
      !(await tx.source.findFirst({
        where: {
          id: sourceId,
          deletedAt: null,
          workspace: { deletedAt: null },
        },
      }))
    )
      throw new NotFoundError("Source not found");
    const active = await tx.backgroundJob.findFirst({
      where: {
        resourceId: sourceId,
        type: "SOURCE",
        status: { in: ["PENDING", "DISPATCHED", "RUNNING"] },
      },
    });
    if (active) return active;
    const next = await createJob(tx, {
      type: "SOURCE",
      resourceId: sourceId,
      ownerId: userId,
      workspaceId,
    });
    await tx.source.update({
      where: { id: sourceId },
      data: { jobId: next.id, status: "PENDING" },
    });
    return next;
  });
  kickJob(job.id);
  return { jobId: job.id, sourceId, status: "PENDING" };
}
