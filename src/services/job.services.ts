import { randomUUID } from "node:crypto";
import prisma from "../lib/db.js";
import { inngest } from "../inngest/client.js";
import {
  createJob,
  jobSelect,
  workspaceTransaction,
  type Transaction,
} from "../repository/job.repository.js";
import type { BackgroundJob, Prisma } from "../generated/prisma/client.js";
import { AppError, ConflictError, NotFoundError } from "../types/app-error.js";

export const LEASE_MS = 90_000;
export const jobRuntime = { timeoutMs: 600_000 };
export const jobTransport = {
  send: (id: string, generation: number) =>
    inngest.send({
      id: `${id}:${generation}`,
      name: "background/run",
      data: { jobId: id, generation },
    }),
};
export class CancelledJob extends Error {}
export class RetryJob extends Error {}
export type JobContext = {
  job: BackgroundJob;
  check: () => Promise<void>;
  commit: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;
};
const cleanup = (job: BackgroundJob) => job.type.endsWith("CLEANUP");

export async function assertJobActive(
  tx: Transaction,
  job: BackgroundJob,
  token: string,
) {
  if (
    !(await tx.backgroundJob.findFirst({
      where: {
        id: job.id,
        status: "RUNNING",
        leaseToken: token,
        leaseUntil: { gt: new Date() },
      },
    }))
  )
    throw new CancelledJob();
  if (cleanup(job)) return;
  const workspace = await tx.workspace.findFirst({
    where: { id: job.workspaceId, deletedAt: null, userId: job.ownerId },
  });
  if (!workspace) throw new CancelledJob();
  if (
    job.type === "SOURCE" &&
    !(await tx.source.findFirst({
      where: { id: job.resourceId, deletedAt: null, jobId: job.id },
    }))
  )
    throw new CancelledJob();
  if (
    job.type === "ARTIFACT" &&
    !(await tx.learningArtifact.findFirst({
      where: { id: job.resourceId, jobId: job.id },
    }))
  )
    throw new CancelledJob();
  if (
    ["SUMMARY", "MEMORY"].includes(job.type) &&
    !(await tx.conversation.findFirst({
      where: { id: job.resourceId, workspaceId: job.workspaceId },
    }))
  )
    throw new CancelledJob();
}
async function failResource(
  tx: Transaction,
  job: BackgroundJob,
  message: string,
) {
  if (job.type === "SOURCE") {
    const source = await tx.source.findFirst({
      where: { id: job.resourceId, jobId: job.id, deletedAt: null },
    });
    if (source)
      await tx.source.update({
        where: { id: source.id },
        data: {
          status: "FAILED",
          metadata: {
            ...((source.metadata as object) ?? {}),
            processingError: message,
          },
        },
      });
  }
  if (job.type === "ARTIFACT")
    await tx.learningArtifact.updateMany({
      where: { id: job.resourceId, jobId: job.id },
      data: { status: "FAILED", metadata: { processingError: message } },
    });
}

export async function deliverJob(id: string) {
  const token = `delivery:${randomUUID()}`;
  const now = new Date();
  const claim = await prisma.backgroundJob.updateMany({
    where: {
      id,
      status: "PENDING",
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: { leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (!claim.count) return;
  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id } });
  try {
    await jobTransport.send(id, job.deliveryGeneration);
    await prisma.backgroundJob.updateMany({
      where: { id, status: "PENDING", leaseToken: token },
      data: {
        status: "DISPATCHED",
        deliveryAttempts: { increment: 1 },
        leaseUntil: new Date(Date.now() + LEASE_MS),
        leaseToken: null,
      },
    });
  } catch {
    await workspaceTransaction(job.workspaceId, async (tx) => {
      const exhausted = job.deliveryAttempts + 1 >= 8;
      const changed = await tx.backgroundJob.updateMany({
        where: { id, status: "PENDING", leaseToken: token },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          deliveryAttempts: { increment: 1 },
          leaseUntil: null,
          leaseToken: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(900_000, 30_000 * 2 ** job.deliveryAttempts),
          ),
          lastError: "Worker notification failed. Retry this job.",
        },
      });
      if (exhausted && changed.count)
        await failResource(
          tx,
          job,
          "Worker notification failed. Retry this job.",
        );
    });
  }
}
const pendingDeliveries = new Set<Promise<void>>();
export function kickJob(id: string) {
  const promise = deliverJob(id)
    .catch(() => {
      console.error("Job delivery deferred", { jobId: id });
    })
    .finally(() => pendingDeliveries.delete(promise));
  pendingDeliveries.add(promise);
}
export async function waitForDeliveries() {
  await Promise.all([...pendingDeliveries]);
}
export async function recoverJobs() {
  const now = new Date();
  const expired = await prisma.backgroundJob.findMany({
    where: {
      status: { in: ["RUNNING", "DISPATCHED"] },
      leaseUntil: { lt: now },
    },
    take: 100,
  });
  for (const job of expired)
    await workspaceTransaction(job.workspaceId, async (tx) => {
      const exhausted =
        job.status === "DISPATCHED"
          ? job.deliveryAttempts >= 8
          : job.processingAttempts >= (job.type === "SOURCE" ? 4 : 3);
      const changed = await tx.backgroundJob.updateMany({
        where: { id: job.id, status: job.status, leaseUntil: { lt: now } },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          deliveryGeneration: { increment: 1 },
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: now,
          ...(exhausted
            ? {
                lastError:
                  "Worker execution was interrupted repeatedly. Retry this job.",
              }
            : {}),
        },
      });
      if (exhausted && changed.count)
        await failResource(
          tx,
          job,
          "Worker execution was interrupted repeatedly. Retry this job.",
        );
    });

  const jobs = await prisma.backgroundJob.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    select: { id: true },
    take: 100,
    orderBy: { nextAttemptAt: "asc" },
  });
  for (const job of jobs) await deliverJob(job.id);
  return jobs.length;
}
export async function runJob(id: string, generation: number) {
  const job = await prisma.backgroundJob.findUnique({ where: { id } });
  if (!job || job.deliveryGeneration !== generation) return;
  const token = `worker:${randomUUID()}`;
  const claimed = await workspaceTransaction(job.workspaceId, async (tx) => {
    if (
      job.type === "SUMMARY" &&
      (await tx.backgroundJob.findFirst({
        where: {
          resourceId: job.resourceId,
          type: "SUMMARY",
          status: "RUNNING",
          leaseUntil: { gt: new Date() },
          id: { not: id },
        },
      }))
    )
      return false;
    return (
      (
        await tx.backgroundJob.updateMany({
          where: {
            id,
            deliveryGeneration: generation,
            status: { in: ["PENDING", "DISPATCHED"] },
          },
          data: {
            status: "RUNNING",
            processingAttempts: { increment: 1 },
            leaseToken: token,
            leaseUntil: new Date(Date.now() + LEASE_MS),
          },
        })
      ).count > 0
    );
  });
  if (!claimed) return;
  const context: JobContext = {
    job,
    check: () =>
      workspaceTransaction(job.workspaceId, (tx) =>
        assertJobActive(tx, job, token),
      ),
    commit: (work) =>
      workspaceTransaction(job.workspaceId, async (tx) => {
        await assertJobActive(tx, job, token);
        return work(tx);
      }),
  };
  const timer = setInterval(() => {
    void prisma.backgroundJob
      .updateMany({
        where: { id, leaseToken: token, status: "RUNNING" },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      })
      .catch(() => {});
  }, 10_000);
  timer.unref();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await context.check();
    await Promise.race([
      (await import("./job-handlers.services.js")).handleJob(context),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Worker execution timed out")),
          jobRuntime.timeoutMs,
        );
      }),
    ]);
    await context.commit((tx) =>
      tx.backgroundJob.update({
        where: { id },
        data: {
          status: "SUCCEEDED",
          leaseUntil: null,
          leaseToken: null,
          lastError: null,
        },
      }),
    );
  } catch (error) {
    await workspaceTransaction(job.workspaceId, async (tx) => {
      const current = await tx.backgroundJob.findFirst({
        where: { id, leaseToken: token },
      });
      if (!current) return;
      if (current.status === "CANCELLED" || error instanceof CancelledJob) {
        await tx.backgroundJob.update({
          where: { id },
          data: { status: "CANCELLED", leaseUntil: null, leaseToken: null },
        });
        return;
      }
      const exhausted =
        !(error instanceof RetryJob) &&
        current.processingAttempts >= (job.type === "SOURCE" ? 4 : 3);
      const message =
        error instanceof AppError
          ? error.message.slice(0, 240)
          : "Background service failed. Check configuration and retry.";
      await tx.backgroundJob.update({
        where: { id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          deliveryGeneration: { increment: 1 },
          leaseUntil: null,
          leaseToken: null,
          nextAttemptAt: new Date(Date.now() + 30_000),
          lastError: message,
        },
      });
      if (exhausted) await failResource(tx, job, message);
    });
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
  }
}
export async function getJobForUser(id: string, userId: string) {
  const job = await prisma.backgroundJob.findFirst({
    where: { id, ownerId: userId },
    select: jobSelect,
  });
  if (!job) throw new NotFoundError("Job not found");
  return job;
}
export async function retryJobForUser(id: string, userId: string) {
  const old = await prisma.backgroundJob.findFirst({
    where: { id, ownerId: userId },
  });
  if (!old) throw new NotFoundError("Job not found");
  const job = await workspaceTransaction(old.workspaceId, async (tx) => {
    const active = await tx.backgroundJob.findFirst({
      where: {
        resourceId: old.resourceId,
        type: old.type,
        status: { in: ["PENDING", "DISPATCHED", "RUNNING"] },
      },
    });
    if (active) return active;
    if (old.status !== "FAILED")
      throw new ConflictError("Only failed jobs can be retried");
    if (
      !cleanup(old) &&
      !(await tx.workspace.findFirst({
        where: { id: old.workspaceId, userId, deletedAt: null },
      }))
    )
      throw new NotFoundError("Workspace not found");
    const next = await createJob(tx, {
      type: old.type,
      ownerId: userId,
      workspaceId: old.workspaceId,
      resourceId: old.resourceId,
      payload: old.payload as Prisma.InputJsonValue,
    });
    if (
      old.type === "SOURCE" &&
      !(
        await tx.source.updateMany({
          where: { id: old.resourceId, deletedAt: null },
          data: { jobId: next.id, status: "PENDING" },
        })
      ).count
    )
      throw new NotFoundError("Source not found");
    if (
      old.type === "ARTIFACT" &&
      !(
        await tx.learningArtifact.updateMany({
          where: { id: old.resourceId },
          data: { jobId: next.id, status: "PENDING" },
        })
      ).count
    )
      throw new NotFoundError("Artifact not found");
    return next;
  });
  kickJob(job.id);
  return { jobId: job.id, status: job.status };
}
