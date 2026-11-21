import type { LeadReferral } from "@relay/db";

/** WhatsApp's delivery lifecycle for an outbound message, in order. */
export type WhatsAppMessageStatus = "sent" | "delivered" | "read" | "failed";

/** One delivery-status update for a message we sent. */
export interface WhatsAppStatusEvent {
  phoneNumberId: string;
  waMessageId: string;
  status: WhatsAppMessageStatus;
  statusAt: Date;
  /** Present only when `status` is `"failed"`. */
  error: { code?: number; title?: string } | null;
}

/** One inbound WhatsApp message, flattened into the fields we store. */
export interface WhatsAppMessageEvent {
  phoneNumberId: string;
  waMessageId: string;
  /** The sender's phone number in Meta's `wa_id` form: digits, no plus. */
  fromWaId: string;
  profileName: string | null;
  /** The text body, or a placeholder for a message kind we do not read. */
  content: string;
  /** Meta's own `type` value, kept so a test can assert on it. Not stored. */
  messageType: string;
  sentAt: Date;
  /**
   * Click-to-WhatsApp ad attribution, present on the first message of a
   * conversation opened from an ad (lead scoring spec, decision 14).
   */
  referral: LeadReferral | null;
}

/**
 * Placeholders for message kinds we do not download. The agent must see that
 * something arrived rather than answer a blank turn.
 *
 * This table is also the allow-list: `text` plus these keys are the only
 * message types we answer. The Cloud API also delivers `reaction`, `system`,
 * `order`, `button`, `interactive` and `unsupported` inside `value.messages`,
 * and a customer tapping a thumbs-up must not cost an agent run and a reply.
 */
const MEDIA_PLACEHOLDERS: Record<string, string> = {
  image: "[image]",
  video: "[video]",
  audio: "[audio]",
  document: "[document]",
  sticker: "[sticker]",
  location: "[location]",
  contacts: "[contact]",
};

interface RawContact {
  wa_id?: unknown;
  profile?: { name?: unknown };
}

interface RawMessage {
  from?: unknown;
  id?: unknown;
  timestamp?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  referral?: unknown;
  /** Present on a message posted in a WhatsApp group (handoff Team chat). */
  group_id?: unknown;
  /** Template quick-reply tap (`type: "button"`). */
  button?: { payload?: unknown; text?: unknown };
  /** Interactive reply tap (`type: "interactive"`). */
  interactive?: {
    type?: unknown;
    button_reply?: { id?: unknown; title?: unknown };
  };
}

interface RawValue {
  metadata?: { phone_number_id?: unknown };
  contacts?: unknown;
  messages?: unknown;
  statuses?: unknown;
}

interface RawStatusError {
  code?: unknown;
  title?: unknown;
}

interface RawStatus {
  id?: unknown;
  status?: unknown;
  timestamp?: unknown;
  errors?: unknown;
}

/**
 * The only status values the Cloud API documents. An unrecognised value (a
 * future addition on Meta's side) is dropped rather than stored as-is, so we
 * never persist a status our own rank ordering does not know how to compare.
 */
const STATUS_VALUES = new Set<WhatsAppMessageStatus>([
  "sent",
  "delivered",
  "read",
  "failed",
]);

function statusValue(value: unknown): WhatsAppMessageStatus | null {
  return typeof value === "string" && STATUS_VALUES.has(value as WhatsAppMessageStatus)
    ? (value as WhatsAppMessageStatus)
    : null;
}

/** The first error's code/title, when the Cloud API sent one. */
function errorFor(raw: RawStatus): { code?: number; title?: string } | null {
  const errors = raw.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;

  const first = errors[0];
  if (!isRecord(first)) return null;

  const candidate = first as RawStatusError;
  const code = typeof candidate.code === "number" ? candidate.code : undefined;
  const title = asString(candidate.title) ?? undefined;

  return code !== undefined || title !== undefined ? { code, title } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** WhatsApp sends epoch seconds, as a string in practice and a number in docs. */
function toDate(timestamp: unknown): Date | null {
  const seconds =
    typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? Number(timestamp)
        : Number.NaN;

  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

/** Meta's snake_case `referral` object, kept to the fields Insights reports on. */
function referralFor(raw: unknown): LeadReferral | null {
  if (!isRecord(raw)) return null;
  const referral: LeadReferral = {};
  const fields: [keyof LeadReferral, string][] = [
    ["sourceId", "source_id"],
    ["sourceType", "source_type"],
    ["sourceUrl", "source_url"],
    ["headline", "headline"],
    ["body", "body"],
    ["ctwaClid", "ctwa_clid"],
  ];
  for (const [key, rawKey] of fields) {
    const value = asString(raw[rawKey]);
    if (value) referral[key] = value.slice(0, 1000);
  }
  return Object.keys(referral).length > 0 ? referral : null;
}

/** Null for a type we do not answer — the caller skips the event entirely. */
function contentFor(message: RawMessage, messageType: string): string | null {
  if (messageType === "text") return asString(message.text?.body);
  return MEDIA_PLACEHOLDERS[messageType] ?? null;
}

/** One tap on a button we sent: a template quick reply or an interactive reply. */
export interface WhatsAppButtonReplyEvent {
  phoneNumberId: string;
  waMessageId: string;
  fromWaId: string;
  /** The payload we attached to the button (or the interactive reply id). */
  payload: string;
}

/** The payload of a button tap, or null for any other message kind. */
function buttonPayloadFor(message: RawMessage, messageType: string): string | null {
  if (messageType === "button") return asString(message.button?.payload);
  if (messageType === "interactive") {
    const interactive = message.interactive;
    if (!isRecord(interactive) || interactive.type !== "button_reply") return null;
    return isRecord(interactive.button_reply)
      ? asString(interactive.button_reply.id)
      : null;
  }
  return null;
}

/** Every `value` of a `messages` change that names its phone number id. */
function messageChangeValues(
  rawBody: string,
): { phoneNumberId: string; value: RawValue }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];

  const entries = (parsed as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const values: { phoneNumberId: string; value: RawValue }[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!isRecord(change)) continue;
      if ((change as { field?: unknown }).field !== "messages") continue;
      const rawValue = (change as { value?: unknown }).value;
      if (!isRecord(rawValue)) continue;
      const value = rawValue as RawValue;
      const phoneNumberId = asString(value.metadata?.phone_number_id);
      if (phoneNumberId) values.push({ phoneNumberId, value });
    }
  }
  return values;
}

/**
 * Whether the body carries WhatsApp Groups traffic (handoff Team chat): a
 * `group_lifecycle_update` change, or a `messages[]` entry with a `group_id`.
 * The route forwards such a body to the worker instead of opening customer
 * chats. Never throws.
 */
export function hasWhatsAppGroupEvents(rawBody: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const entries = (parsed as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return false;

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!isRecord(change)) continue;
      const field = (change as { field?: unknown }).field;
      if (field === "group_lifecycle_update") return true;
      if (field !== "messages") continue;
      const value = (change as { value?: unknown }).value;
      if (!isRecord(value) || !Array.isArray(value.messages)) continue;
      for (const message of value.messages) {
        if (isRecord(message) && asString(message.group_id)) return true;
      }
    }
  }
  return false;
}

/**
 * Flatten a webhook body into button taps (`type: "button"` quick replies and
 * `type: "interactive"` button replies). {@link parseWhatsAppMessageEvents}
 * never yields these, so a tap is never answered as a customer message; the
 * route decides what a tap means from its payload. Never throws.
 */
export function parseWhatsAppButtonReplies(
  rawBody: string,
): WhatsAppButtonReplyEvent[] {
  const events: WhatsAppButtonReplyEvent[] = [];
  for (const { phoneNumberId, value } of messageChangeValues(rawBody)) {
    if (!Array.isArray(value.messages)) continue;
    for (const raw of value.messages as RawMessage[]) {
      if (!isRecord(raw)) continue;
      if (asString(raw.group_id)) continue;
      const fromWaId = asString(raw.from);
      const waMessageId = asString(raw.id);
      if (!fromWaId || !waMessageId) continue;
      const payload = buttonPayloadFor(raw, asString(raw.type) ?? "unknown");
      if (!payload) continue;
      events.push({ phoneNumberId, waMessageId, fromWaId, payload });
    }
  }
  return events;
}

/**
 * Flatten a webhook body into inbound message events.
 * Never throws: an unparseable or unexpected payload yields an empty list, so
 * the route can still answer 200 and keep Meta from retrying a body we will
 * never accept.
 */
export function parseWhatsAppMessageEvents(
  rawBody: string
): WhatsAppMessageEvent[] {
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

  const events: WhatsAppMessageEvent[] = [];

  for (const entry of entries) {
    // Guard against null elements in the entries array.
    if (!isRecord(entry)) continue;

    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      // Guard against null elements in the changes array.
      if (!isRecord(change)) continue;

      if ((change as { field?: unknown }).field !== "messages") continue;

      const value = (change as { value?: RawValue }).value ?? {};

      // The routing key is the phone number id inside `value.metadata`. The
      // `entry.id` above is the WhatsApp Business Account id, which we do not
      // store on the channel — reading it here would match no channel and fail
      // silently.
      const phoneNumberId = asString(value.metadata?.phone_number_id);
      if (!phoneNumberId) continue;

      // A delivery carrying only `statuses` has no `messages` array; those are
      // read by parseWhatsAppStatusEvents.
      const rawMessages = value.messages;
      if (!Array.isArray(rawMessages)) continue;

      const contacts: RawContact[] = Array.isArray(value.contacts)
        ? (value.contacts as RawContact[])
        : [];

      for (const raw of rawMessages as RawMessage[]) {
        // Guard against null elements in the messages array.
        if (!isRecord(raw)) continue;

        // Group messages belong to handoff Team chat (the worker's
        // /internal/whatsapp/groups), never to a customer conversation.
        if (asString(raw.group_id)) continue;

        const fromWaId = asString(raw.from);
        const waMessageId = asString(raw.id);
        const sentAt = toDate(raw.timestamp);
        if (!fromWaId || !waMessageId || !sentAt) continue;

        const messageType = asString(raw.type) ?? "unknown";
        const content = contentFor(raw, messageType);
        if (!content) continue;

        const contact = contacts.find(
          (c) => isRecord(c) && asString(c.wa_id) === fromWaId,
        );

        events.push({
          phoneNumberId,
          waMessageId,
          fromWaId,
          profileName: asString(contact?.profile?.name),
          content,
          messageType,
          sentAt,
          referral: referralFor(raw.referral),
        });
      }
    }
  }

  return events;
}

/**
 * Flatten a webhook body into delivery-status events for messages we sent.
 * A delivery carrying `messages` rather than `statuses` yields nothing here,
 * same as the other direction. Never throws, for the same reason as
 * {@link parseWhatsAppMessageEvents}.
 */
export function parseWhatsAppStatusEvents(
  rawBody: string
): WhatsAppStatusEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) return [];

  const entries = (parsed as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];

  const events: WhatsAppStatusEvent[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;

    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!isRecord(change)) continue;

      if ((change as { field?: unknown }).field !== "messages") continue;

      const value = (change as { value?: RawValue }).value ?? {};

      const phoneNumberId = asString(value.metadata?.phone_number_id);
      if (!phoneNumberId) continue;

      const rawStatuses = value.statuses;
      if (!Array.isArray(rawStatuses)) continue;

      for (const raw of rawStatuses as RawStatus[]) {
        if (!isRecord(raw)) continue;

        const waMessageId = asString(raw.id);
        const statusAt = toDate(raw.timestamp);
        const status = statusValue(raw.status);
        if (!waMessageId || !statusAt || !status) continue;

        events.push({
          phoneNumberId,
          waMessageId,
          status,
          statusAt,
          error: status === "failed" ? errorFor(raw) : null,
        });
      }
    }
  }

  return events;
}
