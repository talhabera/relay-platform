import { z } from "zod";

import { OPERATOR_ROLE_IDS } from "@/components/agent/agent-templates";

export const createOperatorAgentSchema = z.object({
  companyId: z.string().uuid("Invalid company ID"),
  name: z.string().min(1, "Agent name is required").max(100),
  description: z.string().max(500).optional(),
});

export const installPackageSchema = z.object({
  companyId: z.string().uuid("Invalid company ID"),
  slug: z.string().min(1),
});

export const forkVersionSchema = z.object({
  name: z.string().min(1, "Version name is required").max(64),
});

export const toolTogglesSchema = z
  .object({
    webSearch: z.boolean(),
    excel: z.boolean(),
    companyMemory: z.boolean(),
    proposeAction: z.boolean(),
  })
  .strict();

export const updateOperatorVersionSchema = z.object({
  instructions: z.string().max(50000).optional().nullable(),
  toolToggles: toolTogglesSchema.optional(),
  model: z.enum(["haiku", "sonnet", "opus"]).optional(),
});

export const renameOperatorSessionSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
});

export type CreateOperatorAgentInput = z.infer<typeof createOperatorAgentSchema>;
export type ForkVersionInput = z.infer<typeof forkVersionSchema>;
export type UpdateOperatorVersionInput = z.infer<
  typeof updateOperatorVersionSchema
>;
export type RenameOperatorSessionInput = z.infer<
  typeof renameOperatorSessionSchema
>;
export type InstallPackageInput = z.infer<typeof installPackageSchema>;

/** Create operator agent dialog (Figma 07 `agents-operator/create-agent`): blank or a pre-defined role. */
export const createOperatorAgentDialogSchema = z.object({
  companyId: z.string().uuid("Invalid company ID"),
  name: z.string().trim().min(1, "Enter a name for the agent.").max(100),
  description: z.string().max(500).optional(),
  model: z.enum(["haiku", "sonnet", "opus"]),
  role: z.enum(OPERATOR_ROLE_IDS).nullable(),
});

export type CreateOperatorAgentDialogInput = z.infer<typeof createOperatorAgentDialogSchema>;
