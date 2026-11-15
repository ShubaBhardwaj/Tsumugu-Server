import prisma from "../lib/db.js";
import { sourceProviders } from "../lib/source-providers.js";
import { CancelledJob, RetryJob, type JobContext } from "./job.services.js";
import { processSourceJob } from "./source-processing.services.js";
import { processArtifactJob } from "./artifact.services.js";
import {
  summarizeConversationJob,
  learnConversationJob,
} from "./conversation-memory.services.js";
async function cleanFile(metadata: any) {
  if (typeof metadata?.publicId === "string")
    await sourceProviders.deletePdfFromCloudinary(
      metadata.publicId,
      metadata.resourceType === "image" ? "image" : "raw",
    );
}
async function cleanup(ctx: JobContext) {
  const job = ctx.job;
  const running = await prisma.backgroundJob.count({
    where: {
      workspaceId: job.workspaceId,
      ...(job.type === "SOURCE_CLEANUP" ? { resourceId: job.resourceId } : {}),
      type: {
        notIn: [
          "SOURCE_CLEANUP",
          "WORKSPACE_CLEANUP",
          "REPRESENTATION_CLEANUP",
        ],
      },
      leaseToken: { startsWith: "worker:" },
      leaseUntil: { gt: new Date() },
    },
  });
  if (running)
    throw new RetryJob("Waiting for processing to acknowledge cancellation");
  const payload = job.payload as any;
  if (job.type === "SOURCE_CLEANUP") {
    const source = await prisma.source.findUnique({
      where: { id: job.resourceId },
    });
    if (source && !source.deletedAt) throw new CancelledJob();
    await sourceProviders.deleteSourceVectors(job.workspaceId, job.resourceId);
    await cleanFile(payload.metadata);
    await ctx.commit((tx) =>
      tx.source.deleteMany({
        where: { id: job.resourceId, deletedAt: { not: null } },
      }),
    );
  } else {
    const workspace = await prisma.workspace.findUnique({
      where: { id: job.workspaceId },
    });
    if (workspace && !workspace.deletedAt) throw new CancelledJob();
    await sourceProviders.deleteWorkspaceVectors(job.workspaceId);
    for (const metadata of payload.files ?? []) await cleanFile(metadata);
    await ctx.commit((tx) =>
      tx.workspace.deleteMany({
        where: { id: job.workspaceId, deletedAt: { not: null } },
      }),
    );
  }
}
async function cleanupRepresentation(ctx: JobContext) {
  const payload = ctx.job.payload as any;
  if (payload.notBefore && new Date(payload.notBefore) > new Date())
    throw new RetryJob("Waiting for the upload transport to settle");
  const running = await prisma.backgroundJob.count({
    where: {
      workspaceId: ctx.job.workspaceId,
      resourceId: ctx.job.resourceId,
      type: "SOURCE",
      leaseToken: { startsWith: "worker:" },
      leaseUntil: { gt: new Date() },
    },
  });
  if (running) throw new RetryJob("Waiting for superseded processing to stop");
  const publicId = payload.metadata?.publicId;
  if (typeof publicId !== "string") throw new CancelledJob();
  const live = await prisma.source.count({
    where: {
      deletedAt: null,
      metadata: { path: ["publicId"], equals: publicId },
    },
  });
  if (live) throw new CancelledJob();
  await ctx.check();
  await cleanFile(payload.metadata);
}
export async function handleJob(ctx: JobContext) {
  switch (ctx.job.type) {
    case "SOURCE":
      return processSourceJob(ctx);
    case "ARTIFACT":
      return processArtifactJob(ctx);
    case "SUMMARY":
      return summarizeConversationJob(ctx);
    case "MEMORY":
      return learnConversationJob(ctx);
    case "SOURCE_CLEANUP":
    case "WORKSPACE_CLEANUP":
      return cleanup(ctx);
    case "REPRESENTATION_CLEANUP":
      return cleanupRepresentation(ctx);
  }
}
