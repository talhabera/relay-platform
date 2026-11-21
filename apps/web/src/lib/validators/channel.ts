import { z } from "zod";

export const channelConfigSchema = z.object({
  apiKey: z.string().optional(),
  phoneNumberId: z.string().optional(),
  accessToken: z.string().optional(),
  accountId: z.string().optional(),
  botToken: z.string().optional(),
  widgetId: z.string().optional(),
  autoReply: z.boolean().optional(),
  autoCommentReply: z.boolean().optional(),
  igUserId: z.string().optional(),
  pageId: z.string().optional(),
  webhookVerifyToken: z.string().optional(),
});

export const createChannelSchema = z.object({
  name: z.string().min(1, "Channel name is required").max(100),
  type: z.enum(["whatsapp", "instagram", "telegram", "messenger", "widget"]),
  agentId: z.string().uuid("Invalid agent ID"),
  config: channelConfigSchema.optional(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z
    .enum(["whatsapp", "instagram", "telegram", "messenger", "widget"])
    .optional(),
  status: z.enum(["active", "inactive"]).optional(),
  config: channelConfigSchema.optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
