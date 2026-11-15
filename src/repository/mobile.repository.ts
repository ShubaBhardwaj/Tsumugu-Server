import prisma from "../lib/db.js";
import { lockWorkspace, type Transaction } from "./job.repository.js";
import { workspaceSelect } from "./workspace.repository.js";
import type { CreateWorkspaceInput } from "../validators/workspace.validator.js";
import { AppError } from "../types/app-error.js";

export function resolveMobileWorkspace(
  userId: string,
  input: CreateWorkspaceInput,
) {
  const { clientCollectionKey, ...fields } = input;
  return prisma.$transaction(async (tx) => {
    await lockWorkspace(
      tx,
      `mobile-workspace:${userId}:${clientCollectionKey}`,
    );
    const binding = await tx.mobileWorkspaceBinding.findUnique({
      where: {
        userId_clientCollectionKey: {
          userId,
          clientCollectionKey: clientCollectionKey!,
        },
      },
      include: {
        workspace: { select: { ...workspaceSelect, deletedAt: true } },
      },
    });
    if (binding) {
      if (
        binding.deletedAt ||
        !binding.workspace ||
        binding.workspace.deletedAt
      )
        throw new AppError(
          410,
          "Workspace binding was deleted. Confirm recreation with a new collection key.",
          undefined,
          "RESOURCE_DELETED",
        );
      const { deletedAt: _deleted, ...workspace } = binding.workspace;
      return { workspace, created: false };
    }
    const workspace = await tx.workspace.create({
      data: { userId, ...fields },
      select: workspaceSelect,
    });
    await tx.mobileWorkspaceBinding.create({
      data: {
        userId,
        clientCollectionKey: clientCollectionKey!,
        workspaceId: workspace.id,
      },
    });
    return { workspace, created: true };
  });
}

export function listMobileBindings(workspaceId: string) {
  return prisma.mobileSourceBinding.findMany({
    where: { workspaceId },
    select: {
      clientItemKey: true,
      sourceId: true,
      contentRevision: true,
      deletedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

// Caller already holds the workspace lock. Key lock also serializes reuse across workspaces.
export function lockSubmission(tx: Transaction, ownerId: string, key: string) {
  return lockWorkspace(tx, `submission:${ownerId}:${key}`);
}
