import { Router } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import {
  listConversations,
  createConversation,
  getMessages,
  deleteConversation,
  chat,
} from "../controllers/chat.controller.js";

export const conversationRoutes = Router({ mergeParams: true });

conversationRoutes.get("/", asyncHandler(listConversations));
conversationRoutes.post("/", asyncHandler(createConversation));
conversationRoutes.get("/:conversationId/messages", asyncHandler(getMessages));
conversationRoutes.delete("/:conversationId", asyncHandler(deleteConversation));
export const chatRoutes = Router({ mergeParams: true });
chatRoutes.post("/", asyncHandler(chat));
