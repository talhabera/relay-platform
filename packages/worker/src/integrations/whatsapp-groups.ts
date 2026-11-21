/**
 * Parse the WhatsApp Cloud API webhook parts that concern groups (Team chat).
 *
 * The envelope is the normal `whatsapp_business_account` webhook. A group
 * message is an ordinary `messages[]` entry with a `group_id`; group creation
 * arrives on the `group_lifecycle_update` field. The payload shape is from
 * docs/research/whatsapp-groups-payload.md and is not yet checked against a
 * live Official Business Account, so every field is read defensively:
 * `context` in particular may be missing on a quote-reply.
 */

export type GroupMessageEvent = {
  /** The company sender the message arrived on (`metadata.phone_number_id`). */
  phoneNumberId: string;
  groupId: string;
  /** The participant who wrote it (`messages[].from`), never the group. */
  fromWaId: string;
  profileName: string | null;
  messageId: string;
  text: string;
  /** The quoted message's wamid (`context.id`), when the webhook carries one. */
  quotedMessageId: string | null;
};

export type GroupLifecycleEvent = {
  phoneNumberId: string;
  type: string;
  groupId: string | null;
  requestId: string | null;
  inviteLink: string | null;
  subject: string | null;
  /** First error message when Meta reports the operation failed. */
  error: string | null;
};

export type GroupWebhookEvents = {
  messages: GroupMessageEvent[];
  lifecycle: GroupLifecycleEvent[];
};

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function firstError(value: unknown): string | null {
  for (const error of arr(value)) {
    if (!isObj(error)) continue;
    const details = isObj(error.error_data) ? str(error.error_data.details) : null;
    const message = details ?? str(error.message) ?? str(error.title);
    if (message) return message;
  }
  return null;
}

/** Group messages and lifecycle updates in one webhook body. Never throws. */
export function parseWhatsAppGroupWebhook(body: unknown): GroupWebhookEvents {
  const events: GroupWebhookEvents = { messages: [], lifecycle: [] };
  let root: unknown = body;
  if (typeof body === "string") {
    try {
      root = JSON.parse(body);
    } catch {
      return events;
    }
  }
  if (!isObj(root) || root.object !== "whatsapp_business_account") return events;

  for (const entry of arr(root.entry)) {
    if (!isObj(entry)) continue;
    for (const change of arr(entry.changes)) {
      if (!isObj(change) || !isObj(change.value)) continue;
      const value = change.value;
      const phoneNumberId = isObj(value.metadata) ? str(value.metadata.phone_number_id) : null;
      if (!phoneNumberId) continue;

      if (change.field === "group_lifecycle_update") {
        for (const group of arr(value.groups)) {
          if (!isObj(group)) continue;
          const type = str(group.type);
          if (!type) continue;
          events.lifecycle.push({
            phoneNumberId,
            type,
            groupId: str(group.group_id),
            requestId: str(group.request_id),
            inviteLink: str(group.invite_link),
            subject: str(group.subject),
            error: firstError(group.errors),
          });
        }
        continue;
      }

      if (change.field !== "messages") continue;
      const names = new Map<string, string>();
      for (const contact of arr(value.contacts)) {
        if (!isObj(contact)) continue;
        const waId = str(contact.wa_id);
        const name = isObj(contact.profile) ? str(contact.profile.name) : null;
        if (waId && name) names.set(waId, name);
      }
      for (const message of arr(value.messages)) {
        if (!isObj(message)) continue;
        const groupId = str(message.group_id);
        const fromWaId = str(message.from);
        const messageId = str(message.id);
        if (!groupId || !fromWaId || !messageId) continue;
        // Interactive messages are unsupported in groups; only text answers.
        if (message.type !== "text" || !isObj(message.text)) continue;
        const text = str(message.text.body)?.trim();
        if (!text) continue;
        events.messages.push({
          phoneNumberId,
          groupId,
          fromWaId,
          profileName: names.get(fromWaId) ?? null,
          messageId,
          text,
          quotedMessageId: isObj(message.context) ? str(message.context.id) : null,
        });
      }
    }
  }
  return events;
}
