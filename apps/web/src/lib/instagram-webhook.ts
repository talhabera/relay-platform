import type { InstagramCommentPayload } from "@relay/db";

/** One `comments` change, flattened into the fields the table stores. */
export interface InstagramCommentEvent {
  igAccountId: string;
  igCommentId: string;
  igMediaId: string;
  parentIgCommentId: string | null;
  fromIgUserId: string | null;
  fromUsername: string | null;
  content: string;
  commentedAt: Date;
  /** The `change.value` object exactly as Meta sent it, unmodified. */
  raw: InstagramCommentPayload;
}

interface RawChangeValue {
  id?: unknown;
  text?: unknown;
  parent_id?: unknown;
  from?: { id?: unknown; username?: unknown };
  media?: { id?: unknown };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Flatten a webhook body into comment events.
 * Never throws: an unparseable or unexpected payload yields an empty list, so
 * the route can still answer 200 and keep Meta from retrying a body we will
 * never accept.
 */
export function parseCommentEvents(rawBody: string): InstagramCommentEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }

  // Guard against payloads that are valid JSON but not objects (e.g., bare `null`).
  if (!isRecord(parsed)) return [];

  const entries = (parsed as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const events: InstagramCommentEvent[] = [];

  for (const entry of entries) {
    // Guard against null elements in the entries array. This parser runs on
    // the shared route before the DM branch, so a throw here would take
    // direct messages down with it.
    if (!isRecord(entry)) continue;

    const igAccountId = asString((entry as { id?: unknown }).id);
    const time = (entry as { time?: unknown }).time;
    const changes = (entry as { changes?: unknown }).changes;
    if (!igAccountId || typeof time !== "number" || !Array.isArray(changes)) {
      continue;
    }

    for (const change of changes) {
      // Guard against null elements in the changes array.
      if (!isRecord(change)) continue;

      if ((change as { field?: unknown }).field !== "comments") continue;

      const value = (change as { value?: RawChangeValue }).value ?? {};
      const igCommentId = asString(value.id);
      const igMediaId = asString(value.media?.id);
      if (!igCommentId || !igMediaId) continue;

      const fromIgUserId = asString(value.from?.id);
      // A public reply we posted arrives on this same webhook. Dropping it
      // keeps the agent from treating its own reply as a new comment.
      if (fromIgUserId === igAccountId) continue;

      events.push({
        igAccountId,
        igCommentId,
        igMediaId,
        parentIgCommentId: asString(value.parent_id),
        fromIgUserId,
        fromUsername: asString(value.from?.username),
        content: asString(value.text) ?? "",
        commentedAt: new Date(time * 1000),
        raw: value as unknown as InstagramCommentPayload,
      });
    }
  }

  return events;
}

/** One inbound direct message, flattened into the fields we store. */
export interface InstagramDirectMessageEvent {
  igAccountId: string;
  mid: string;
  fromIgUserId: string;
  content: string;
  sentAt: Date;
}

/** Placeholders for DM attachments we do not download. */
const ATTACHMENT_PLACEHOLDERS: Record<string, string> = {
  image: "[image]",
  video: "[video]",
  audio: "[audio]",
  file: "[document]",
  share: "[shared post]",
  story_mention: "[story mention]",
};

interface RawMessaging {
  sender?: { id?: unknown };
  timestamp?: unknown;
  message?: {
    mid?: unknown;
    text?: unknown;
    is_echo?: unknown;
    attachments?: unknown;
  };
}

/**
 * Flatten a webhook body into inbound direct message events.
 *
 * Direct messages sit at `entry[].messaging[]` — a sibling of the
 * `entry[].changes[]` that carries comments, not a child — so one route serves
 * both by calling both parsers. Never throws, for the same reason
 * `parseCommentEvents` does not.
 */
export function parseDirectMessageEvents(
  rawBody: string
): InstagramDirectMessageEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) return [];

  const entries = (parsed as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const events: InstagramDirectMessageEvent[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;

    const igAccountId = asString((entry as { id?: unknown }).id);
    const messaging = (entry as { messaging?: unknown }).messaging;
    if (!igAccountId || !Array.isArray(messaging)) continue;

    for (const raw of messaging) {
      if (!isRecord(raw)) continue;
      const item = raw as RawMessaging;

      const message = item.message;
      if (!message) continue;

      // A DM we sent is echoed back on this same webhook. Two independent
      // checks, because missing this makes the agent answer itself in a loop.
      if (message.is_echo === true) continue;

      const fromIgUserId = asString(item.sender?.id);
      if (!fromIgUserId || fromIgUserId === igAccountId) continue;

      const mid = asString(message.mid);
      if (!mid) continue;

      const attachments = Array.isArray(message.attachments)
        ? (message.attachments as unknown[])
        : [];
      const attachmentType = isRecord(attachments[0])
        ? asString(attachments[0].type)
        : null;
      const content =
        asString(message.text) ??
        (attachmentType
          ? (ATTACHMENT_PLACEHOLDERS[attachmentType] ?? `[${attachmentType}]`)
          : null);
      if (!content) continue;

      // Messaging timestamps are milliseconds. The comments webhook's
      // `entry.time` is seconds — do not copy its `* 1000` here.
      const timestamp = item.timestamp;
      const sentAt =
        typeof timestamp === "number" ? new Date(timestamp) : new Date();

      events.push({ igAccountId, mid, fromIgUserId, content, sentAt });
    }
  }

  return events;
}
