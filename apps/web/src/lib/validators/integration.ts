import { z } from "zod";

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
