import { z } from "zod";

export const sendMessageSchema = z.object({
  content: z.string().min(1, "Message cannot be empty").max(10000),
  chatId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
});

export const renameChatSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(60),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type RenameChatInput = z.infer<typeof renameChatSchema>;
