import {
  createJob,
  workspaceTransaction,
} from "../repository/job.repository.js";
import { kickJob } from "./job.services.js";
import {
  createWorkspaceRecord,
  findWorkspaceByIdAndUserId,
  findWorkspacesByUserId,
  updateWorkspaceRecord,
  type WorkspaceRecord,
} from "../repository/workspace.repository.js";
import { NotFoundError } from "../types/app-error.js";
import {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from "../validators/workspace.validator.js";

export function listWorkspacesByUser(userId: string) {
  return findWorkspacesByUserId(userId);
}

export async function getWorkspaceByIdForUser(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRecord> {
  const workspace = await findWorkspaceByIdAndUserId(workspaceId, userId);

  if (!workspace) {
    throw new NotFoundError("Workspace not found");
  }

  return workspace;
}

export function createWorkspaceForUser(
  userId: string,
  input: CreateWorkspaceInput,
) {
  return createWorkspaceRecord(userId, input);
}

export async function updateWorkspaceForUser(
  workspaceId: string,
  userId: string,
  input: UpdateWorkspaceInput,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  return updateWorkspaceRecord(workspaceId, input);
}

export async function deleteWorkspaceForUser(
  workspaceId: string,
  userId: string,
) {
  const job = await workspaceTransaction(workspaceId, async (tx) => {
    const workspace = await tx.workspace.findFirst({
      where: { id: workspaceId, userId, deletedAt: null },
    });
    if (!workspace) throw new NotFoundError("Workspace not found");
    const sources = await tx.source.findMany({
      where: { workspaceId },
      select: { metadata: true },
    });
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { deletedAt: new Date() },
    });
    await tx.backgroundJob.updateMany({
      where: {
        workspaceId,
        status: { in: ["PENDING", "DISPATCHED", "RUNNING"] },
        type: { notIn: ["SOURCE_CLEANUP", "WORKSPACE_CLEANUP"] },
      },
      data: { status: "CANCELLED" },
    });
    return createJob(tx, {
      type: "WORKSPACE_CLEANUP",
      resourceId: workspaceId,
      workspaceId,
      ownerId: userId,
      dedupeKey: `delete:${workspaceId}`,
      payload: { files: sources.map((s) => s.metadata ?? {}) },
    });
  });
  kickJob(job.id);
}
