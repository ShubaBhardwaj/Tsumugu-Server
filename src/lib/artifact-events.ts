import prisma from "./db.js";
import { kickJob } from "../services/job.services.js";
export async function enqueueArtifactGeneration(input: {
  artifactId: string;
  workspaceId: string;
}) {
  const artifact = await prisma.learningArtifact.findFirstOrThrow({
    where: { id: input.artifactId, workspaceId: input.workspaceId },
  });
  if (!artifact.jobId)
    throw new Error("Artifact must be created with a durable generation job");
  kickJob(artifact.jobId);
}
