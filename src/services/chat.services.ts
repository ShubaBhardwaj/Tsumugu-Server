import prisma from "../lib/db.js";
import { aiProvider } from "../lib/ai-provider.js";
import {
  createJob,
  workspaceTransaction,
} from "../repository/job.repository.js";
import { insertMessage } from "../repository/message.repository.js";
import { kickJob } from "./job.services.js";
import { openai } from "@ai-sdk/openai";
import type { Response } from "express";
import { z } from "zod";
import {
  convertToModelMessages,
  createUIMessageStream,
  isStepCount,
  pipeUIMessageStreamToResponse,
  toUIMessageStream,
  tool,
  type UIMessage,
} from "ai";
import {
  CHAT_MODEL,
  CHAT_MODELS,
  CONVERSATION_SUMMARY_INTERVAL,
  RECENT_MESSAGE_WINDOW,
} from "../lib/ai-config.js";
import {
  buildChatSystemPrompt,
  retrieveWorkspaceContext,
} from "../lib/rag/retrieve.js";
import {
  createConversationRecord,
  findConversationByIdAndWorkspaceId,
  findConversationsByWorkspaceId,
} from "../repository/conversation.repository.js";
import { findMessagesByConversationId } from "../repository/message.repository.js";

import {
  formatTavilyResultsForPrompt,
  searchWeb,
  type TavilySearchResponse,
} from "../lib/tavily.js";
import { NotFoundError, ValidationError } from "../types/app-error.js";
import {
  buildConversationTitle,
  getLastUserMessageText,
  getTextFromUIMessage,
} from "../utils/chat-message.js";
import { getWorkspaceByIdForUser } from "./workspace.services.js";
import { searchUserMemories } from "../lib/mem0.js";

/**
 * Lists all conversations in a workspace for the sidebar/history UI.
 *
 * @param workspaceId - Workspace to list conversations from
 * @param userId - Authenticated user's id
 * @returns Conversation records ordered by most recent activity
 *
 */
export async function listConversationsForWorkspace(
  workspaceId: string,
  userId: string,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  return findConversationsByWorkspaceId(workspaceId);
}

/**
 * Creates an empty conversation (optional title).
 *
 * Most chats are created implicitly on first message via {@link streamWorkspaceChat};
 * this endpoint supports explicit "new chat" actions from the UI.
 *
 * @param workspaceId - Workspace to attach the conversation to
 * @param userId - Authenticated user's id
 * @param title - Optional display title
 * @returns New conversation record
 *
 */
export async function createConversationForWorkspace(
  workspaceId: string,
  userId: string,
  title?: string,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);
  return workspaceTransaction(workspaceId, async (tx) => {
    if (
      !(await tx.workspace.findFirst({
        where: { id: workspaceId, userId, deletedAt: null },
      }))
    )
      throw new NotFoundError("Workspace not found");
    return tx.conversation.create({
      data: { workspaceId, title: title ?? null },
      select: {
        id: true,
        workspaceId: true,
        title: true,
        summary: true,
        summaryMessageCount: true,
        messageCount: true,
        summarizedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });
}

/**
 * Loads persisted message history for a conversation.
 *
 * @param workspaceId - Workspace the conversation belongs to
 * @param conversationId - Conversation to load messages for
 * @param userId - Authenticated user's id
 * @returns Message rows with role, content, citations, and timestamps
 * @throws {NotFoundError} When the conversation does not exist in this workspace
 *
 */
export async function getConversationMessagesForWorkspace(
  workspaceId: string,
  conversationId: string,
  userId: string,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);

  const conversation = await findConversationByIdAndWorkspaceId(
    conversationId,
    workspaceId,
  );

  if (!conversation) {
    throw new NotFoundError("Conversation not found");
  }

  return findMessagesByConversationId(conversationId);
}

/**
 * Deletes a conversation and all its messages (cascade).
 *
 * @param workspaceId - Workspace the conversation belongs to
 * @param conversationId - Conversation to delete
 * @param userId - Authenticated user's id
 * @returns Resolves when the conversation row is deleted
 * @throws {NotFoundError} When the conversation does not exist
 *
 */
export async function deleteConversationForWorkspace(
  workspaceId: string,
  conversationId: string,
  userId: string,
) {
  await getWorkspaceByIdForUser(workspaceId, userId);

  const conversation = await findConversationByIdAndWorkspaceId(
    conversationId,
    workspaceId,
  );

  if (!conversation) {
    throw new NotFoundError("Conversation not found");
  }

  await workspaceTransaction(workspaceId, async (tx) => {
    await tx.backgroundJob.updateMany({
      where: {
        resourceId: conversationId,
        status: { in: ["PENDING", "DISPATCHED", "RUNNING"] },
      },
      data: { status: "CANCELLED" },
    });
    await tx.conversation.deleteMany({
      where: { id: conversationId, workspaceId },
    });
  });
}

/**
 * Finds an existing conversation or creates one from the first user message.
 *
 * @param workspaceId - Workspace scope
 * @param conversationId - Existing id from client, or undefined for a new chat
 * @param firstMessage - User text used to auto-generate a title for new conversations
 * @returns Conversation record (existing or newly created)
 * @throws {NotFoundError} When `conversationId` is provided but not found
 *
 *
 */
async function resolveConversation(
  workspaceId: string,
  conversationId: string | undefined,
  firstMessage: string,
  userId: string,
) {
  if (conversationId) {
    const existing = await findConversationByIdAndWorkspaceId(
      conversationId,
      workspaceId,
    );

    if (!existing) {
      throw new NotFoundError("Conversation not found");
    }

    return existing;
  }

  return createConversationForWorkspace(
    workspaceId,
    userId,
    buildConversationTitle(firstMessage),
  );
}

/**
 * Main RAG chat endpoint: streams an AI reply with workspace context and optional web search.
 *
 * **Pipeline:**
 * 1. Validate user message and resolve/create conversation
 * 2. Save user message to Postgres
 * 3. Parallel: Pinecone RAG retrieval + Mem0 memory search
 * 4. Build system prompt and stream model response via AI SDK
 * 5. On finish: save assistant message, citations, title, summary job, Mem0 learning
 *
 * @param res - Express response (streamed via `pipeUIMessageStreamToResponse`)
 * @param workspaceId - Workspace whose sources to search
 * @param userId - Authenticated user's id
 * @param input - Client chat payload from `useChat`
 * @returns Writes UI message stream to `res`; sets `X-Conversation-Id` header
 * @throws {ValidationError} When no user message text is present
 * @throws {NotFoundError} When conversation or workspace is not found
 *
 *
 */
export const chatModelProvider = { get: (model: string) => openai(model) };

export async function streamWorkspaceChat(
  res: Response,
  workspaceId: string,
  userId: string,
  input: {
    conversationId?: string;
    messages: UIMessage[];
    model?: string;
    webSearch?: boolean;
  },
) {
  const workspace = await getWorkspaceByIdForUser(workspaceId, userId);
  const requestedModel = input.model ?? workspace.defaultModel;
  const chatModel =
    CHAT_MODELS.find((model) => model === requestedModel) ?? CHAT_MODEL;
  const webSearchEnabled =
    input.webSearch === true && !!process.env.TAVILY_API_KEY?.trim();

  const userText = getLastUserMessageText(input.messages);
  if (!userText) {
    throw new ValidationError("A user message is required");
  }

  const conversation = await resolveConversation(
    workspaceId,
    input.conversationId,
    userText,
    userId,
  );

  const savedUser = await workspaceTransaction(workspaceId, async (tx) => {
    if (
      !(await tx.workspace.findFirst({
        where: { id: workspaceId, userId, deletedAt: null },
      }))
    )
      throw new NotFoundError("Workspace not found");
    return insertMessage(tx, {
      conversationId: conversation.id,
      role: "USER",
      content: userText,
    });
  });

  const [retrievedChunks, userMemories] = await Promise.all([
    retrieveWorkspaceContext(workspaceId, userText),
    searchUserMemories(userId, userText).catch(() => {
      console.error("Personal memory search unavailable");
      return [];
    }),
  ]);

  const citations = retrievedChunks.map((chunk) => ({
    sourceId: chunk.sourceId,
    sourceTitle: chunk.sourceTitle,
    sourceType: chunk.sourceType,
    chunkId: chunk.chunkId,
    chunkIndex: chunk.chunkIndex,
    page: chunk.page,
    excerpt: chunk.text.slice(0, 280),
    score: chunk.score,
  }));
  const systemPrompt = buildChatSystemPrompt({
    chunks: retrievedChunks,
    conversationSummary: conversation.summary,
    userMemories: userMemories.map((memory) => memory.memory),
    webSearchEnabled,
  });

  const history = await findMessagesByConversationId(conversation.id);
  const contextMessages: UIMessage[] = history
    .filter((message) => message.position <= savedUser.position)
    .slice(-RECENT_MESSAGE_WINDOW)
    .map((message) => ({
      id: message.id,
      role: message.role === "USER" ? "user" : "assistant",
      parts: [{ type: "text", text: message.content }],
    }));
  if (res.destroyed) return;
  const abort = new AbortController();
  let generationFailed = false;
  const disconnect = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.once("close", disconnect);
  res.socket?.once("close", disconnect);

  let webSearchResults: TavilySearchResponse | null = null;

  const stream = createUIMessageStream({
    originalMessages: input.messages,
    onError: () => {
      generationFailed = true;
      return "The answer could not be completed. Please retry.";
    },
    execute: async ({ writer }) => {
      const tools = webSearchEnabled
        ? {
            web_search: tool({
              description:
                "Search the web for up-to-date information outside the workspace sources.",
              inputSchema: z.object({
                query: z
                  .string()
                  .describe("The search query for current web information"),
              }),
              execute: async ({ query }) => {
                const results = await searchWeb(query);
                webSearchResults = results;
                return formatTavilyResultsForPrompt(results);
              },
            }),
          }
        : undefined;

      const result = aiProvider.streamText({
        model: chatModelProvider.get(chatModel),
        abortSignal: abort.signal,
        maxOutputTokens: 1500,
        onError: () => {
          generationFailed = true;
        },
        system: systemPrompt,
        messages: await convertToModelMessages(contextMessages),
        tools,
        stopWhen: webSearchEnabled ? isStepCount(3) : undefined,
      });

      writer.merge(toUIMessageStream({ stream: result.stream }));
    },
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted || abort.signal.aborted || generationFailed) {
        return;
      }

      const assistantText = getTextFromUIMessage(responseMessage).trim();
      if (!assistantText) {
        return;
      }

      const webCitations = webSearchResults
        ? webSearchResults.results.map((result) => ({
            sourceType: "WEB" as const,
            sourceTitle: result.title,
            url: result.url,
            excerpt: result.content.slice(0, 280),
          }))
        : [];
      const allCitations = [...citations, ...webCitations];

      const jobs = await workspaceTransaction(workspaceId, async (tx) => {
        if (
          !(await tx.workspace.findFirst({
            where: { id: workspaceId, deletedAt: null, userId },
          })) ||
          !(await tx.conversation.findUnique({
            where: { id: conversation.id },
          }))
        )
          return [];
        const assistant = await insertMessage(tx, {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: assistantText,
          citations: allCitations,
        });
        const pending = [];
        if (assistant.position % CONVERSATION_SUMMARY_INTERVAL === 0)
          pending.push(
            await createJob(tx, {
              type: "SUMMARY",
              resourceId: conversation.id,
              ownerId: userId,
              workspaceId,
              dedupeKey: `summary:${conversation.id}:${assistant.position}`,
            }),
          );
        if (process.env.MEM0_API_KEY?.trim()) {
          pending.push(
            await createJob(tx, {
              type: "MEMORY",
              resourceId: conversation.id,
              ownerId: userId,
              workspaceId,
              dedupeKey: `memory:${assistant.id}`,
              payload: { messageIds: [savedUser.id, assistant.id] },
            }),
          );
        }
        return pending;
      });
      for (const job of jobs) kickJob(job.id);
    },
  });

  await pipeUIMessageStreamToResponse({
    response: res,
    stream,
    headers: {
      "X-Conversation-Id": conversation.id,
    },
  });
}
