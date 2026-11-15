import prisma from "./db.js";
import { kickJob } from "../services/job.services.js";
export async function enqueueSourceProcessing(input: {
  sourceId: string;
  workspaceId: string;
}) {
  const source = await prisma.source.findFirstOrThrow({
    where: {
      id: input.sourceId,
      workspaceId: input.workspaceId,
      deletedAt: null,
    },
  });
  if (!source.jobId)
    throw new Error("Source must be created with a durable processing job");
  kickJob(source.jobId);
}
