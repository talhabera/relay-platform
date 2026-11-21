import { z } from "zod";

export const createCompanySchema = z.object({
  name: z.string().min(1, "Company name is required").max(100),
  industry: z.string().optional(),
  description: z.string().max(500).optional(),
});

export const updateCompanySchema = z.object({
  name: z.string().min(1, "Company name is required").max(100).optional(),
  industry: z.string().optional(),
  description: z.string().max(500).optional(),
});

export const updateWidgetConfigSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.enum(["bottom-right", "bottom-left"]).optional(),
  welcomeMessage: z.string().max(500).optional(),
  title: z.string().max(100).optional(),
  avatarUrl: z.string().url().optional().nullable(),
  agentId: z.string().uuid().optional().nullable(),
  theme: z.enum(["light", "dark", "auto"]).optional(),
  showBranding: z.boolean().optional(),
  customCss: z.string().max(5000).optional().nullable(),
  autoOpen: z.boolean().optional(),
  autoOpenDelay: z.number().int().min(0).max(30000).optional(),
  persistThread: z.boolean().optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type UpdateWidgetConfigInput = z.infer<typeof updateWidgetConfigSchema>;

// Policy name -> limit. Unknown names and out-of-range values are dropped or
// clamped server-side by sanitizeCompanyOverrides; this only checks shape.
export const updateCompanyRateLimitsSchema = z.record(
  z.string().max(64),
  z.number().int().min(0),
);

export type UpdateCompanyRateLimitsInput = z.infer<
  typeof updateCompanyRateLimitsSchema
>;

// Ad settings: money is whole kuruş (TRY minor units), capacities are whole
// won-deal counts per calendar month. Every field is nullable; null clears
// it (unset = no rule). A daily cap of 0 would block all spend, so a set cap
// is at least 1; a capacity of 0 is meaningful (no new deals for that product).
const adMoneyMinor = z.number().int().min(0).nullable();
const adCapacityMonthly = z.number().int().min(0).nullable();

export const updateCompanyAdSettingsSchema = z.object({
  adMonthlyTargetMinor: adMoneyMinor,
  adCplStopMinor: adMoneyMinor,
  adDailyCapMinor: z.number().int().min(1).nullable(),
  adCapacitySiteMonthly: adCapacityMonthly,
  adCapacitySocialMonthly: adCapacityMonthly,
});

export type UpdateCompanyAdSettingsInput = z.infer<
  typeof updateCompanyAdSettingsSchema
>;

// Meta ad mapping: `sourceId` is the numeric `referral.source_id` Meta sends,
// `code` a fixed Meta code such as MWEB1.
export const adMetaMappingSchema = z.object({
  sourceId: z
    .string()
    .trim()
    .min(1, "Source ID is required")
    .max(40, "Source ID is at most 40 characters")
    .regex(/^\d+$/, "Source ID is digits only"),
  code: z
    .string()
    .regex(/^M[A-Z]{3}[0-9]$/, "Code looks like MWEB1: M, three letters, one digit"),
  campaignName: z
    .string()
    .trim()
    .min(1, "Campaign name is required")
    .max(200, "Campaign name is at most 200 characters"),
});

export type AdMetaMappingInput = z.infer<typeof adMetaMappingSchema>;
