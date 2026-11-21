import { z } from "zod";
import {
  HANDOFF_IF_NOBODY_ANSWERS,
  HANDOFF_MODES,
  HANDOFF_REPLY_MODES,
} from "@/db/schema";

const E164 = /^\+[1-9]\d{6,14}$/;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

/** The whole Handoff settings form for one customer agent. */
export const handoffSettingsSchema = z.object({
  mode: z.enum(HANDOFF_MODES),
  triggers: z.object({
    priceNotListed: z.boolean(),
    asksForPerson: z.boolean(),
    complaintOrRefund: z.boolean(),
    lowConfidence: z.boolean(),
  }),
  recipientName: optionalText(120),
  recipientWhatsapp: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value.replace(/[\s-]/g, "")))
    .refine((value) => value === null || E164.test(value), {
      message: "Use international format, e.g. +905551234567",
    }),
  expiryMinutes: z.union([
    z.literal(30),
    z.literal(60),
    z.literal(120),
    z.literal(240),
  ]),
  defaultReply: z.enum(HANDOFF_REPLY_MODES),
  recipientCanTakeOver: z.boolean(),
  waitingText: optionalText(500),
  ifNobodyAnswers: z.enum(HANDOFF_IF_NOBODY_ANSWERS),
});

export type HandoffSettingsInput = z.input<typeof handoffSettingsSchema>;
export type HandoffSettings = z.output<typeof handoffSettingsSchema>;

/** A quick-link answer. */
export const handoffAnswerSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  replyMode: z.enum(HANDOFF_REPLY_MODES),
});
export type HandoffAnswerInput = z.input<typeof handoffAnswerSchema>;

/** What the customer runtime passes to `ask_human`. */
export const askHumanSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  confidence: z.number().int().min(0).max(100).nullable(),
  question: z.string().trim().min(1).max(2000),
  suggestedReplies: z.array(z.string().trim().min(1).max(500)).max(5),
});
export type AskHumanInput = z.input<typeof askHumanSchema>;
