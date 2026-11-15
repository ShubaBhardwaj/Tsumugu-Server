import { randomUUID } from "node:crypto";
import prisma from "../lib/db.js";
import type { Prisma, JobType } from "../generated/prisma/client.js";

export type Transaction = Prisma.TransactionClient;
export type JobInput = {
  type: JobType;
  resourceId: string;
  ownerId: string;
  workspaceId: string;
  payload?: Prisma.InputJsonValue;
  dedupeKey?: string;
};
export function createJob(tx: Transaction, input: JobInput) {
  const key = input.dedupeKey ?? randomUUID();
  return tx.backgroundJob.upsert({
    where: {
      dedupeKey: key,
    },
    update: {},
    create: {
      ...input,
      payload: input.payload ?? {},
      dedupeKey: key,
    },
  });
}
// All operations on one workspace share a transaction-level lock. No network work occurs in these transactions.
export async function lockWorkspace(tx: Transaction, workspaceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`;
}
export function workspaceTransaction<T>(
  workspaceId: string,
  work: (tx: Transaction) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    return work(tx);
  });
}
export const jobSelect = {
  id: true,
  type: true,
  resourceId: true,
  status: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;
