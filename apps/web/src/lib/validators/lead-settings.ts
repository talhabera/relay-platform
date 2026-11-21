import { z } from "zod";

const E164 = /^\+[1-9]\d{6,14}$/;

export const leadNotifyNumberSchema = z.object({
  whatsapp: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || E164.test(value), {
      message: "Use international format, e.g. +905551234567",
    }),
});

/** The form holds the raw string; the action stores the parsed value. */
export type LeadNotifyNumberInput = z.input<typeof leadNotifyNumberSchema>;

const INTAKE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED_INTAKE_KEYS = new Set(["phone", "kod", "rejected"]);

/** A workflow's inbound intake as the intake editor saves it (order is ask order). */
export const leadIntakeSchema = z
  .array(
    z.object({
      key: z
        .string()
        .regex(INTAKE_KEY)
        .refine((key) => !RESERVED_INTAKE_KEYS.has(key), { message: "Reserved key" }),
      label: z.string().trim().min(1).max(60),
      required: z.boolean(),
    }),
  )
  .min(1)
  .max(20)
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
    message: "Duplicate key",
  });

export type LeadIntakeInput = z.infer<typeof leadIntakeSchema>;
