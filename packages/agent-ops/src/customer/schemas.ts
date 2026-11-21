import { z } from "zod";

export const createAgentSchema = z.object({
  name: z.string().min(1, "Agent name is required").max(100),
  description: z.string().max(500).optional(),
  companyId: z.string().uuid("Invalid company ID"),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1, "Agent name is required").max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  instructions: z.string().max(5000).optional().nullable(),
  isActive: z.boolean().optional(),
  responseLength: z.enum(["short", "medium", "long"]).optional(),
  language: z.enum(["en", "es", "fr", "de", "tr"]).optional(),
  memoryEnabled: z.boolean().optional(),
  persona: z.enum(["friendly", "professional", "casual", "expert"]).optional(),
  model: z.enum(["haiku", "sonnet", "opus"]).optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const createKnowledgeEntrySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(500).optional(),
  agentId: z.string().uuid("Invalid agent ID"),
  companyId: z.string().uuid("Invalid company ID"),
  type: z.enum(["file", "website", "api"]),
  content: z.string().optional(),
  fileType: z.string().optional(),
  fileSize: z.number().int().positive().optional(),
});

export const updateKnowledgeEntrySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional().nullable(),
  content: z.string().optional(),
});

export type CreateKnowledgeEntryInput = z.infer<
  typeof createKnowledgeEntrySchema
>;
export type UpdateKnowledgeEntryInput = z.infer<
  typeof updateKnowledgeEntrySchema
>;

export const createKnowledgeFromWebsiteSchema = z.object({
  url: z.string().url("Please enter a valid URL"),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  agentId: z.string().uuid("Invalid agent ID"),
  companyId: z.string().uuid("Invalid company ID"),
});

export type CreateKnowledgeFromWebsiteInput = z.infer<
  typeof createKnowledgeFromWebsiteSchema
>;

export const channelConfigSchema = z.object({
  apiKey: z.string().optional(),
  phoneNumberId: z.string().optional(),
  accessToken: z.string().optional(),
  accountId: z.string().optional(),
  botToken: z.string().optional(),
  widgetId: z.string().optional(),
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

export const integrationConfigSchema = z.object({
  webhookUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  workspaceId: z.string().optional(),
  channelId: z.string().optional(),
  customDomain: z.string().optional(),
  mcpEndpoint: z.string().url().optional(),
  mcpHeaders: z.record(z.string(), z.string()).optional(),
});

const integrationTypeEnum = z.enum([
  "slack",
  "discord",
  "zendesk",
  "shopify",
  "mcp_custom",
  "hunter",
  "snov",
  "google_places",
]);

export const createIntegrationSchema = z.object({
  name: z.string().min(1, "Integration name is required").max(100),
  type: integrationTypeEnum,
  companyId: z.string().uuid("Invalid company ID"),
  agentId: z.string().uuid().optional().nullable(),
  config: integrationConfigSchema.optional(),
});

export const updateIntegrationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: integrationTypeEnum.optional(),
  agentId: z.string().uuid().optional().nullable(),
  status: z.enum(["connected", "disconnected", "pending", "error"]).optional(),
  config: integrationConfigSchema.optional(),
  error: z.string().optional().nullable(),
});

export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;
