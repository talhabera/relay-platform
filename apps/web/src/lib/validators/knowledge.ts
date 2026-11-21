import { z } from "zod";

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
