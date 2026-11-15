import { z } from "zod";
import { safeValidateUIMessages } from "ai";
import { CHAT_MODELS } from "../lib/ai-config.js";
import { workspaceIdParamSchema } from "./workspace.validator.js";
import { ValidationError } from "../types/app-error.js";
export const conversationIdParamSchema = workspaceIdParamSchema.extend({
  conversationId: z.string().trim().min(1),
});
const text = z.string().max(8000);
const part = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text,
    state: z.enum(["streaming", "done"]).optional(),
  }),
  z.object({ type: z.literal("step-start") }),
  z.object({
    type: z.literal("tool-web_search"),
    toolCallId: z.string(),
    state: z.enum([
      "input-streaming",
      "input-available",
      "output-available",
      "output-error",
    ]),
    input: z.object({ query: z.string() }).optional(),
    output: z.string().optional(),
    errorText: z.string().optional(),
  }),
]);
export const chatBodySchema = z.object({
  conversationId: z.string().trim().min(1).optional(),
  messages: z
    .array(
      z.object({
        id: z.string().min(1),
        role: z.enum(["user", "assistant"]),
        parts: z.array(part).min(1),
      }),
    )
    .min(1)
    .max(100),
  model: z.enum(CHAT_MODELS).optional(),
  webSearch: z.boolean().optional(),
});
export async function parseChatBody(body: unknown) {
  const parsed = chatBodySchema.parse(body);
  const last = parsed.messages.at(-1)!;
  if (
    last.role !== "user" ||
    last.parts.some((p) => p.type !== "text") ||
    !last.parts.some((p) => p.type === "text" && p.text.trim())
  )
    throw new ValidationError(
      "A final user message with nonblank text is required",
    );
  if (
    parsed.messages.some(
      (m) =>
        m.parts
          .filter((p) => p.type === "text")
          .reduce((n, p) => n + (p.type === "text" ? p.text.length : 0), 0) >
        8000,
    )
  )
    throw new ValidationError("Message text exceeds 8000 characters");
  const result = await safeValidateUIMessages({
    messages: parsed.messages,
    tools: {
      web_search: {
        inputSchema: z.object({ query: z.string() }),
        outputSchema: z.string(),
      },
    },
  });
  if (!result.success)
    throw new ValidationError("Invalid UI message structure");
  return { ...parsed, messages: result.data };
}
export type ChatBody = Awaited<ReturnType<typeof parseChatBody>>;
export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
