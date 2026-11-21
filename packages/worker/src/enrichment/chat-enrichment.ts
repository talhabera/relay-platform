import { generateText, Output } from "ai";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { chats, db, messages, sentimentOfScore, type ChatSentiment } from "@relay/db";
import { getModel } from "../ai/provider";

// Post-chat enrichment (S83, Figma 08a): once a customer conversation has been
// quiet for a while, the cron sweep stores its duration, the customer's
// language and a sentiment score on the chat row for the Inbox Details and
// Sentiment cards. A new message makes the conversation due again.

/** A conversation counts as finished after this much quiet. */
export const ENRICH_QUIET_MS = 30 * 60 * 1000;
/** Only conversations active this recently are picked up; older ones never are. */
export const ENRICH_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Conversations enriched per cron tick. */
export const ENRICH_BATCH_SIZE = 20;
/** The transcript sent to the classifier: the most recent messages, each clipped. */
export const TRANSCRIPT_MESSAGE_LIMIT = 40;
export const TRANSCRIPT_CHAR_LIMIT = 500;

/** Customer channels shown in the Inbox (web `inbox-model.ts`). */
export const ENRICHED_CHANNELS = [
  "whatsapp",
  "instagram",
  "telegram",
  "messenger",
  "widget",
  "web",
] as const;

export type DueChat = {
  chatId: string;
  firstAt: Date;
  lastAt: Date;
};

export type TranscriptMessage = { role: string; content: string };

export type ChatClassification = {
  sentimentScore: number;
  /** ISO 639-1 code, or null when the model could not tell. */
  language: string | null;
};

export type ChatEnrichment = {
  durationSeconds: number;
  enrichedThrough: Date;
  /** Absent when classification failed or was skipped: keep what is stored. */
  sentiment?: ChatSentiment;
  sentimentScore?: number;
  language?: string | null;
};

export type EnrichmentDeps = {
  listDue: (now: Date, limit: number) => Promise<DueChat[]>;
  loadTranscript: (chatId: string, limit: number) => Promise<TranscriptMessage[]>;
  /** Null when no model is configured or the call failed. */
  classify: (transcript: string) => Promise<ChatClassification | null>;
  save: (chatId: string, enrichment: ChatEnrichment) => Promise<void>;
};

export function durationSeconds(firstAt: Date, lastAt: Date): number {
  return Math.max(0, Math.round((lastAt.getTime() - firstAt.getTime()) / 1000));
}

/**
 * Customer and business turns only, oldest first, as plain labelled lines.
 * Tool and system rows say nothing about how the customer felt.
 */
export function buildTranscript(rows: TranscriptMessage[]): string {
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({ ...row, content: row.content.replace(/\s+/g, " ").trim() }))
    .filter((row) => row.content !== "")
    .slice(-TRANSCRIPT_MESSAGE_LIMIT)
    .map((row) => {
      const label = row.role === "user" ? "Customer" : "Business";
      const text =
        row.content.length > TRANSCRIPT_CHAR_LIMIT
          ? `${row.content.slice(0, TRANSCRIPT_CHAR_LIMIT)}…`
          : row.content;
      return `${label}: ${text}`;
    })
    .join("\n");
}

const LANGUAGE_CODE = /^[a-z]{2}$/;

/** Clamps the score to 0-100 and keeps only a two-letter language code. */
export function normalizeClassification(raw: {
  sentimentScore: number;
  language: string | null | undefined;
}): ChatClassification | null {
  if (!Number.isFinite(raw.sentimentScore)) return null;
  const sentimentScore = Math.min(100, Math.max(0, Math.round(raw.sentimentScore)));
  const code = raw.language?.trim().toLowerCase().slice(0, 2) ?? "";
  return { sentimentScore, language: LANGUAGE_CODE.test(code) ? code : null };
}

const classificationSchema = z.object({
  sentimentScore: z
    .number()
    .describe("How the customer felt by the end: 0 very negative, 50 neutral, 100 very positive"),
  language: z
    .string()
    .nullable()
    .describe("ISO 639-1 code of the language the customer wrote in, e.g. en, de, tr; null if unclear"),
});

const CLASSIFIER_SYSTEM = [
  "You read a finished conversation between a customer and a business's assistant.",
  "Rate the customer's sentiment by the end of the conversation from 0 (angry, let down) through 50 (neutral, purely factual) to 100 (happy, grateful).",
  "Judge the customer's messages, not the business's.",
  "Also give the ISO 639-1 code of the language the customer wrote in.",
].join(" ");

/** One Haiku call; null without an API key or on any failure. */
export async function classifyConversation(
  transcript: string,
): Promise<ChatClassification | null> {
  if (!process.env.ANTHROPIC_API_KEY || transcript.trim() === "") return null;
  try {
    const { output } = await generateText({
      model: getModel("haiku"),
      system: CLASSIFIER_SYSTEM,
      prompt: transcript,
      output: Output.object({ schema: classificationSchema }),
      maxOutputTokens: 200,
    });
    return normalizeClassification(output);
  } catch (error) {
    console.error("[Chat enrichment] classification failed", error);
    return null;
  }
}

/**
 * Customer conversations whose last message is older than the quiet window
 * (but inside the lookback) and newer than what was last enriched.
 */
export async function listChatsDueForEnrichment(
  now: Date,
  limit: number,
): Promise<DueChat[]> {
  const quietSince = new Date(now.getTime() - ENRICH_QUIET_MS);
  const lookback = new Date(now.getTime() - ENRICH_LOOKBACK_MS);
  // Postgres keeps microseconds, a JS Date only milliseconds: compare at
  // millisecond precision or the stored mark would always look older.
  const lastAt = sql<Date>`date_trunc('milliseconds', max(${messages.createdAt}))`.mapWith(
    messages.createdAt,
  );
  const rows = await db
    .select({ chatId: chats.id, lastAt })
    .from(chats)
    .innerJoin(messages, eq(messages.chatId, chats.id))
    .where(
      and(
        inArray(chats.channelType, [...ENRICHED_CHANNELS]),
        gt(messages.createdAt, lookback),
      ),
    )
    .groupBy(chats.id)
    .having(
      sql`${lastAt} < ${sql.param(quietSince, messages.createdAt)} and (${chats.enrichedThrough} is null or ${chats.enrichedThrough} < ${lastAt})`,
    )
    .orderBy(asc(lastAt))
    .limit(limit);

  // The lookback trims the join, so read the true start for the duration.
  return Promise.all(
    rows.map(async (row) => {
      const first = await db
        .select({ at: messages.createdAt })
        .from(messages)
        .where(eq(messages.chatId, row.chatId))
        .orderBy(asc(messages.createdAt))
        .limit(1);
      return {
        chatId: row.chatId,
        firstAt: first[0]?.at ?? row.lastAt,
        lastAt: row.lastAt,
      };
    }),
  );
}

async function loadTranscript(chatId: string, limit: number): Promise<TranscriptMessage[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), inArray(messages.role, ["user", "assistant"])))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

async function saveEnrichment(chatId: string, enrichment: ChatEnrichment): Promise<void> {
  await db.update(chats).set(enrichment).where(eq(chats.id, chatId));
}

export const pgEnrichmentDeps: EnrichmentDeps = {
  listDue: listChatsDueForEnrichment,
  loadTranscript,
  classify: classifyConversation,
  save: saveEnrichment,
};

/**
 * Enriches one quiet conversation. Duration is always written; sentiment and
 * language only when the classifier answered, so a failed call keeps the last
 * good values. The chat is marked enriched either way and is retried only
 * when a new message arrives.
 */
export async function enrichChat(due: DueChat, deps: EnrichmentDeps): Promise<ChatEnrichment> {
  const rows = await deps.loadTranscript(due.chatId, TRANSCRIPT_MESSAGE_LIMIT * 2);
  const transcript = buildTranscript(rows);
  const classification = transcript ? await deps.classify(transcript) : null;
  const enrichment: ChatEnrichment = {
    durationSeconds: durationSeconds(due.firstAt, due.lastAt),
    enrichedThrough: due.lastAt,
    ...(classification
      ? {
          sentimentScore: classification.sentimentScore,
          sentiment: sentimentOfScore(classification.sentimentScore),
          language: classification.language,
        }
      : {}),
  };
  await deps.save(due.chatId, enrichment);
  return enrichment;
}

/** The cron step: enrich up to one batch of quiet conversations. Never throws per chat. */
export async function enrichQuietChats(
  now: Date,
  deps: EnrichmentDeps = pgEnrichmentDeps,
): Promise<{ enriched: number; failed: number }> {
  const due = await deps.listDue(now, ENRICH_BATCH_SIZE);
  let enriched = 0;
  let failed = 0;
  for (const chat of due) {
    try {
      await enrichChat(chat, deps);
      enriched += 1;
    } catch (error) {
      failed += 1;
      console.error("[Chat enrichment] failed", chat.chatId, error);
    }
  }
  return { enriched, failed };
}
