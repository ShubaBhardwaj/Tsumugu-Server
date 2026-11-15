import type { Request, Response } from "express";
import {
  conversationIdParamSchema,
  createConversationSchema,
  parseChatBody,
} from "../validators/chat.validator.js";
import { workspaceIdParamSchema } from "../validators/workspace.validator.js";
import {
  listConversationsForWorkspace,
  createConversationForWorkspace,
  getConversationMessagesForWorkspace,
  deleteConversationForWorkspace,
  streamWorkspaceChat,
} from "../services/chat.services.js";
export async function listConversations(req: Request, res: Response) {
  const { workspaceId } = workspaceIdParamSchema.parse(req.params);
  res.json(
    await listConversationsForWorkspace(workspaceId, req.session.user.id),
  );
}
export async function createConversation(req: Request, res: Response) {
  const { workspaceId } = workspaceIdParamSchema.parse(req.params);
  const input = createConversationSchema.parse(req.body);
  res
    .status(201)
    .json(
      await createConversationForWorkspace(
        workspaceId,
        req.session.user.id,
        input.title,
      ),
    );
}
export async function getMessages(req: Request, res: Response) {
  const { workspaceId, conversationId } = conversationIdParamSchema.parse(
    req.params,
  );
  res.json(
    await getConversationMessagesForWorkspace(
      workspaceId,
      conversationId,
      req.session.user.id,
    ),
  );
}
export async function deleteConversation(req: Request, res: Response) {
  const { workspaceId, conversationId } = conversationIdParamSchema.parse(
    req.params,
  );
  await deleteConversationForWorkspace(
    workspaceId,
    conversationId,
    req.session.user.id,
  );
  res.status(204).send();
}
export async function chat(req: Request, res: Response) {
  const { workspaceId } = workspaceIdParamSchema.parse(req.params);
  const input = await parseChatBody(req.body);
  await streamWorkspaceChat(res, workspaceId, req.session.user.id, input);
}
