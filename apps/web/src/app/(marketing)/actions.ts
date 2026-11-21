"use server";

import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accessRequests,
  ACCESS_REQUEST_CLIENT_COUNTS,
  ACCESS_REQUEST_PLANS,
} from "@/db/schema";
import {
  assertWithinLimits,
  clientIp,
  RATE_LIMIT_SURFACES,
  RateLimitError,
} from "@/lib/rate-limit";
import { mailConfigFromEnv, sendMail } from "@relay/agent-ops/shared/mailer";

/**
 * Request access capture (spec 2026-10-02-pricing-and-access-requests,
 * decisions 5-10). Public: no session. The dialog (S103) maps each result to a
 * state: success, field errors, rate-limited banner, or error banner.
 */

const HONEYPOT_FIELD = "website";

const requestAccessSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .pipe(z.email("Enter a valid work email")),
  agencyName: z.string().trim().min(1, "Enter your agency name").max(200),
  clientCount: z.enum(ACCESS_REQUEST_CLIENT_COUNTS, "Choose how many clients you manage"),
  plan: z.enum(ACCESS_REQUEST_PLANS).default("none"),
  message: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value ? value : null)),
});

type RequestAccessFields = z.input<typeof requestAccessSchema>;

export type RequestAccessInput = {
  [K in keyof RequestAccessFields]?: RequestAccessFields[K] | string;
} & { website?: string };

export type RequestAccessResult =
  | { ok: true; name: string; email: string }
  | { ok: false; error: "invalid"; fieldErrors: Record<string, string> }
  | { ok: false; error: "rate_limited"; retryAfterSec: number }
  | { ok: false; error: "failed" };

function toRecord(input: RequestAccessInput | FormData): Record<string, unknown> {
  if (input instanceof FormData) {
    const record: Record<string, unknown> = {};
    for (const [key, value] of input.entries()) {
      if (typeof value === "string") record[key] = value;
    }
    return record;
  }
  return { ...input };
}

export async function requestAccess(
  input: RequestAccessInput | FormData,
): Promise<RequestAccessResult> {
  const raw = toRecord(input);

  // A filled honeypot gets the success state and nothing is stored or sent.
  const honeypot = raw[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return {
      ok: true,
      name: String(raw.name ?? "").trim(),
      email: String(raw.email ?? "").trim().toLowerCase(),
    };
  }

  try {
    const ip = clientIp(await headers());
    await assertWithinLimits(RATE_LIMIT_SURFACES.accessRequest({ ip }));
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, error: "rate_limited", retryAfterSec: error.denial.retryAfterSec };
    }
    console.error("[access-request] rate limit check failed", error);
    return { ok: false, error: "failed" };
  }

  const parsed = requestAccessSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: "invalid", fieldErrors };
  }
  const data = parsed.data;

  let inserted: boolean;
  try {
    const [row] = await db
      .insert(accessRequests)
      .values({
        email: data.email,
        name: data.name,
        agencyName: data.agencyName,
        clientCount: data.clientCount,
        plan: data.plan,
        message: data.message,
      })
      .onConflictDoUpdate({
        target: accessRequests.email,
        // A repeat request refreshes the details; `status` is kept.
        set: {
          name: data.name,
          agencyName: data.agencyName,
          clientCount: data.clientCount,
          plan: data.plan,
          message: data.message,
          updatedAt: new Date(),
        },
      })
      .returning({ id: accessRequests.id, inserted: sql<boolean>`(xmax = 0)` });
    inserted = row?.inserted ?? true;
  } catch (error) {
    console.error("[access-request] store failed", error);
    return { ok: false, error: "failed" };
  }

  // The row is stored; a failed notification is logged, never surfaced.
  await notifyInbox(data, inserted);

  return { ok: true, name: data.name, email: data.email };
}

async function notifyInbox(
  data: z.output<typeof requestAccessSchema>,
  inserted: boolean,
): Promise<void> {
  const inbox = process.env.ACCESS_REQUEST_INBOX?.trim();
  const mail = mailConfigFromEnv();
  if (!inbox || !mail) {
    console.info(
      `[access-request] stored ${data.email}; notification skipped (ACCESS_REQUEST_INBOX or SMTP_USER/SMTP_PASS unset)`,
    );
    return;
  }

  const from = process.env.ACCESS_REQUEST_FROM?.trim() || mail.from;
  const subject = `${inserted ? "New" : "Updated"} access request: ${data.agencyName}`;
  const text = [
    `Name: ${data.name}`,
    `Email: ${data.email}`,
    `Agency: ${data.agencyName}`,
    `Clients you manage: ${data.clientCount}`,
    `Plan: ${data.plan}`,
    "",
    data.message ?? "(no message)",
  ].join("\n");

  try {
    await sendMail(mail, { from, to: inbox, replyTo: data.email, subject, text });
  } catch (error) {
    console.error("[access-request] SMTP send failed", error instanceof Error ? error.message : error);
  }
}
