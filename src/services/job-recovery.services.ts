import prisma from "../lib/db.js";
import {
  createJob,
  workspaceTransaction,
} from "../repository/job.repository.js";
import { recoverJobs } from "./job.services.js";
export async function reconcileLegacyJobs() {
  await prisma.backgroundJob.updateMany({
    where: {
      type: "MEMORY",
      status: { in: ["PENDING", "DISPATCHED", "RUNNING"] },
    },
    data: { status: "CANCELLED" },
  });
  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true, userId: true },
  });
  for (const workspace of workspaces)
    await workspaceTransaction(workspace.id, async (tx) => {
      for (const source of await tx.source.findMany({
        where: {
          workspaceId: workspace.id,
          deletedAt: null,
          jobId: null,
          status: { in: ["PENDING", "PROCESSING"] },
        },
      })) {
        const job = await createJob(tx, {
          type: "SOURCE",
          resourceId: source.id,
          workspaceId: workspace.id,
          ownerId: workspace.userId,
          dedupeKey: `legacy:source:${source.id}`,
        });
        await tx.source.update({
          where: { id: source.id },
          data: { jobId: job.id, status: "PENDING" },
        });
      }
      for (const artifact of await tx.learningArtifact.findMany({
        where: {
          workspaceId: workspace.id,
          jobId: null,
          status: { in: ["PENDING", "PROCESSING"] },
        },
      })) {
        const job = await createJob(tx, {
          type: "ARTIFACT",
          resourceId: artifact.id,
          workspaceId: workspace.id,
          ownerId: workspace.userId,
          dedupeKey: `legacy:artifact:${artifact.id}`,
        });
        await tx.learningArtifact.update({
          where: { id: artifact.id },
          data: { jobId: job.id, status: "PENDING" },
        });
      }
    });
  return recoverJobs();
}
