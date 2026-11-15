import {
  createJob,
  workspaceTransaction,
} from "../repository/job.repository.js";
import { kickJob } from "../services/job.services.js";
import { NotFoundError } from "../types/app-error.js";
export async function enqueueConversationSummarize(input: {
  conversationId: string;
  userId: string;
}) {
  // Use a stable conversation lookup then verify ownership in the locked transaction.
  const { default: prisma } = await import("./db.js");
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
  });
  if (!conversation) throw new NotFoundError("Conversation not found");
  const job = await workspaceTransaction(
    conversation.workspaceId,
    async (tx) => {
      if (
        !(await tx.workspace.findFirst({
          where: {
            id: conversation.workspaceId,
            deletedAt: null,
            userId: input.userId,
          },
        }))
      )
        throw new NotFoundError("Conversation not found");
      return createJob(tx, {
        type: "SUMMARY",
        resourceId: conversation.id,
        workspaceId: conversation.workspaceId,
        ownerId: input.userId,
        dedupeKey: `summary:${conversation.id}:${conversation.messageCount}`,
      });
    },
  );
  kickJob(job.id);
}
