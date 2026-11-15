import type { Prisma } from "../generated/prisma/client.js";
import {
  findArtifactByIdAndWorkspaceId,
  findArtifactsByWorkspaceId,
} from "../repository/artifact.repository.js";
import {
  createJob,
  workspaceTransaction,
} from "../repository/job.repository.js";
import { NotFoundError } from "../types/app-error.js";
import {
  gatherSourceContext,
  artifactGenerator,
  validateArtifactContent,
} from "./artifact-generation.services.js";
import { getWorkspaceByIdForUser } from "./workspace.services.js";
import type { CreateArtifactInput } from "../validators/artifact.validator.js";
import { kickJob, retryJobForUser, type JobContext } from "./job.services.js";
export async function listArtifactsForWorkspace(
  workspaceId: string,
  userId: string,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  return findArtifactsByWorkspaceId(workspaceId);
}
export async function getArtifactForWorkspace(
  workspaceId: string,
  artifactId: string,
  userId: string,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  const artifact = await findArtifactByIdAndWorkspaceId(
    artifactId,
    workspaceId,
  );
  if (!artifact) throw new NotFoundError("Artifact not found");
  return artifact;
}
export async function createArtifactForWorkspace(
  workspaceId: string,
  userId: string,
  input: CreateArtifactInput,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  const context = await gatherSourceContext(workspaceId, input.sourceIds);
  const artifact = await workspaceTransaction(workspaceId, async (tx) => {
    if (
      !(await tx.workspace.findFirst({
        where: { id: workspaceId, userId, deletedAt: null },
      }))
    )
      throw new NotFoundError("Workspace not found");
    // Freeze the validated selection; the worker rechecks readiness and availability.
    const row = await tx.learningArtifact.create({
      data: {
        workspaceId,
        type: input.type,
        title: input.title || input.type,
        sourceIds: input.sourceIds ?? context.selectedSourceIds,
      },
    });
    const job = await createJob(tx, {
      type: "ARTIFACT",
      ownerId: userId,
      workspaceId,
      resourceId: row.id,
    });
    return tx.learningArtifact.update({
      where: { id: row.id },
      data: { jobId: job.id },
    });
  });
  kickJob(artifact.jobId!);
  return artifact;
}
export async function deleteArtifactForWorkspace(
  workspaceId: string,
  artifactId: string,
  userId: string,
) {
  await getArtifactForWorkspace(workspaceId, artifactId, userId);
  await workspaceTransaction(workspaceId, async (tx) => {
    await tx.backgroundJob.updateMany({
      where: {
        resourceId: artifactId,
        status: { in: ["PENDING", "DISPATCHED", "RUNNING"] },
      },
      data: { status: "CANCELLED" },
    });
    await tx.learningArtifact.deleteMany({
      where: { id: artifactId, workspaceId },
    });
  });
}
export async function retryArtifact(
  workspaceId: string,
  artifactId: string,
  userId: string,
) {
  const artifact = await getArtifactForWorkspace(
    workspaceId,
    artifactId,
    userId,
  );
  if (!artifact.jobId) throw new NotFoundError("Artifact job not found");
  return retryJobForUser(artifact.jobId, userId);
}
export async function processArtifactJob(ctx: JobContext) {
  const artifact = await ctx.commit((tx) =>
    tx.learningArtifact.update({
      where: { id: ctx.job.resourceId },
      data: { status: "PROCESSING" },
    }),
  );
  const context = await gatherSourceContext(
    artifact.workspaceId,
    artifact.sourceIds,
  );
  await ctx.check();
  const content = validateArtifactContent(
    artifact.type,
    await artifactGenerator.generate(artifact.type, context.text),
  );
  await ctx.commit(async (tx) => {
    const valid = await tx.source.count({
      where: {
        id: { in: context.sourceIds },
        workspaceId: artifact.workspaceId,
        deletedAt: null,
        status: "READY",
      },
    });
    if (valid !== context.sourceIds.length)
      throw new NotFoundError(
        "Selected source became unavailable during generation",
      );
    return tx.learningArtifact.update({
      where: { id: artifact.id },
      data: {
        status: "READY",
        content: content as Prisma.InputJsonValue,
        sourceIds: context.sourceIds,
        metadata: {
          generatedAt: new Date().toISOString(),
          truncated: context.truncated,
          truncatedSources: context.truncatedSources,
        },
      },
    });
  });
}
