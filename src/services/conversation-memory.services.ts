import prisma from "../lib/db.js";
import { aiProvider } from "../lib/ai-provider.js";
import { languageModel } from "../lib/ai-provider.js";
import { addMemoriesFromMessages } from "../lib/mem0.js";
import { ValidationError } from "../types/app-error.js";
import { CancelledJob, type JobContext } from "./job.services.js";
export const memoryLearning = { add: addMemoriesFromMessages };
export const SUMMARY_INPUT_LIMIT = 24_000;
export function summaryBatch<
  T extends { content: string; role: string; position: number },
>(messages: T[], previous: string) {
  const batch: T[] = [];
  let size = previous.length + 256;
  for (const message of messages) {
    const length = message.content.length + message.role.length + 4;
    if (size + length > SUMMARY_INPUT_LIMIT) break;
    batch.push(message);
    size += length;
  }
  if (!batch.length && messages.length)
    throw new ValidationError(
      "A saved message exceeds the summary input limit",
    );
  return batch;
}
export async function generateSummary(previous: string, transcript: string) {
  const result = await aiProvider.generateText({
    model: languageModel(),
    abortSignal: AbortSignal.timeout(30000),
    maxRetries: 0,
    system:
      "Summarize new messages into the previous summary. Keep under 250 words and 2000 characters. Preserve questions, preferences, facts, and unresolved topics.",
    prompt: `Previous summary:\n${previous}\nNew messages:\n${transcript}`,
  });
  const summary = result.text.trim();
  if (!summary || summary.length > 2000 || summary.split(/\s+/).length > 250)
    throw new ValidationError("Generated summary exceeded its output limit");
  return summary;
}
export async function summarizeConversationJob(ctx: JobContext) {
  while (true) {
    await ctx.check();
    const conversation = await prisma.conversation.findUnique({
      where: { id: ctx.job.resourceId },
    });
    if (!conversation) throw new CancelledJob();
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        position: { gt: conversation.summaryMessageCount },
      },
      orderBy: { position: "asc" },
      take: 100,
    });
    if (!messages.length) return;
    let summary = conversation.summary ?? "";
    let covered: number;
    if (
      messages[0]!.content.length + summary.length + 300 >
      SUMMARY_INPUT_LIMIT
    ) {
      // Old stored messages may predate today's request limits. Cover all fragments before advancing.
      const message = messages[0]!;
      let offset = 0;
      while (offset < message.content.length) {
        await ctx.check();
        const part = message.content.slice(
          offset,
          offset + SUMMARY_INPUT_LIMIT - summary.length - 300,
        );
        summary = await generateSummary(summary, `${message.role}: ${part}`);
        offset += part.length;
      }
      covered = message.position;
    } else {
      const batch = summaryBatch(messages, summary);
      summary = await generateSummary(
        summary,
        batch.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
      );
      covered = batch.at(-1)!.position;
    }
    await ctx.commit((tx) =>
      tx.conversation.updateMany({
        where: {
          id: conversation.id,
          summaryMessageCount: conversation.summaryMessageCount,
        },
        data: {
          summary,
          summaryMessageCount: covered,
          summarizedAt: new Date(),
        },
      }),
    );
  }
}
// Legacy collection-memory jobs must never export study content to account-wide storage.
export async function learnConversationJob(_ctx: JobContext) {
  throw new CancelledJob();
}
