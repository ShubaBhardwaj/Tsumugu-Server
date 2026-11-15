import type { Prisma } from "../generated/prisma/client.js";
import prisma from "../lib/db.js";
import type { Transaction } from "./job.repository.js";
export const messageSelect = {
  id: true,
  conversationId: true,
  role: true,
  content: true,
  citations: true,
  position: true,
  createdAt: true,
} as const;
export type CreateMessageData = {
  conversationId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations?: Prisma.InputJsonValue;
};
export async function insertMessage(tx: Transaction, data: CreateMessageData) {
  const conversation = await tx.conversation.update({
    where: { id: data.conversationId },
    data: { messageCount: { increment: 1 }, updatedAt: new Date() },
  });
  return tx.message.create({
    data: { ...data, position: conversation.messageCount },
    select: messageSelect,
  });
}
export function createMessageRecord(data: CreateMessageData) {
  return prisma.$transaction((tx) => insertMessage(tx, data));
}
export function findMessagesByConversationId(conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId },
    select: messageSelect,
    orderBy: { position: "asc" },
  });
}
export function countMessagesByConversationId(conversationId: string) {
  return prisma.message.count({ where: { conversationId } });
}
