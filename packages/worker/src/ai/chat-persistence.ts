import { db, chats, messages, type MessageMetadata } from "@relay/db";
import { eq, desc } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { ChatChannelType } from "../types";

type Chat = InferSelectModel<typeof chats>;
type Message = InferSelectModel<typeof messages>;

/**
 * Create a new chat session.
 * Returns the newly created chat ID.
 */
export async function createChatSession(
  userId: string | null,
  companyId: string,
  agentId?: string | null,
  title?: string,
  visitorId?: string,
  channelType?: ChatChannelType,
  versionId?: string | null,
  model?: string | null,
): Promise<string> {
  const [chat] = await db
    .insert(chats)
    .values({
      userId,
      companyId,
      agentId: agentId ?? null,
      title: title ?? "New Chat",
      visitorId: visitorId ?? null,
      channelType: channelType ?? "web",
      versionId: versionId ?? null,
      model: (model ?? null) as (typeof chats.$inferInsert)["model"],
    })
    .returning({ id: chats.id });

  return chat.id;
}

/**
 * Save a user message to a chat.
 * Returns the newly created message ID.
 */
export async function saveUserMessage(
  chatId: string,
  content: string
): Promise<string> {
  const [message] = await db
    .insert(messages)
    .values({
      chatId,
      content,
      role: "user",
    })
    .returning({ id: messages.id });

  return message.id;
}

/**
 * Save an assistant message to a chat.
 * Optionally includes metadata (tool calls, model info, token count).
 * Returns the newly created message ID.
 */
export async function saveAssistantMessage(
  chatId: string,
  content: string,
  metadata?: MessageMetadata
): Promise<string> {
  const [message] = await db
    .insert(messages)
    .values({
      chatId,
      content,
      role: "assistant",
      metadata: metadata ?? null,
    })
    .returning({ id: messages.id });

  return message.id;
}

/**
 * Get the full message history for a chat, ordered by creation time.
 */
export async function getChatHistory(chatId: string): Promise<Message[]> {
  return db.query.messages.findMany({
    where: eq(messages.chatId, chatId),
    orderBy: [messages.createdAt],
  });
}

/**
 * Get all chats for a user, ordered by most recent first.
 */
export async function getUserChats(userId: string): Promise<Chat[]> {
  return db.query.chats.findMany({
    where: eq(chats.userId, userId),
    orderBy: [desc(chats.createdAt)],
  });
}

/**
 * Get all chats for a visitor (widget user), ordered by most recent first.
 */
export async function getVisitorChats(visitorId: string): Promise<Chat[]> {
  return db.query.chats.findMany({
    where: eq(chats.visitorId, visitorId),
    orderBy: [desc(chats.createdAt)],
  });
}

/**
 * Delete a chat and all its messages (cascading via FK constraint).
 */
export async function deleteChat(chatId: string): Promise<void> {
  await db.delete(chats).where(eq(chats.id, chatId));
}

/**
 * Update the title of a chat session.
 */
export async function updateChatTitle(
  chatId: string,
  title: string
): Promise<void> {
  await db.update(chats).set({ title }).where(eq(chats.id, chatId));
}

/**
 * Get a single chat by ID, optionally with messages.
 */
export async function getChatById(
  chatId: string,
  includeMessages = false
): Promise<(Chat & { messages?: Message[] }) | null> {
  if (includeMessages) {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      with: {
        messages: {
          orderBy: [messages.createdAt],
        },
      },
    });
    return chat ?? null;
  }

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });
  return chat ?? null;
}
