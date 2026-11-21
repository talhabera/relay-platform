import { z } from "zod";

import { CUSTOMER_START_IDS } from "@/components/agent/agent-templates";

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

/** Create customer agent dialog (Figma 07 `agents-customer/create-agent`). */
export const createCustomerAgentDialogSchema = z.object({
  companyId: z.string().uuid("Invalid company ID"),
  name: z.string().trim().min(1, "Enter a name for the agent.").max(100),
  model: z.enum(["haiku", "sonnet", "opus"]),
  start: z.enum(CUSTOMER_START_IDS),
});

export type CreateCustomerAgentDialogInput = z.infer<typeof createCustomerAgentDialogSchema>;
