// WhatsApp Business Cloud API: the one place that posts to `/{phone}/messages`.
// Customer replies (free-form text inside the service window) and staff
// notifications (approved templates, outside any window) both go through here.

const GRAPH_API_VERSION = "v21.0";
const SEND_TIMEOUT_MS = 10_000;

/** Per-sender WhatsApp Business credentials, from `channels.config`. */
export interface WhatsAppSenderCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export type WhatsAppSendResult =
  | { success: true; messageId: string; error: null }
  | { success: false; messageId: null; error: string };

/** The parts of a Cloud API send response we read. */
interface GraphSendResponse {
  messages?: { id?: string }[];
  error?: { message?: string };
}

function failure(error: string): WhatsAppSendResult {
  return { success: false, messageId: null, error };
}

/**
 * POST one message object to the Cloud API. Never throws: transport and API
 * errors come back as a failed result. Credentials are never logged.
 */
export async function postWhatsAppMessage(
  credentials: WhatsAppSenderCredentials,
  message: Record<string, unknown>,
): Promise<WhatsAppSendResult> {
  let response: Response;

  try {
    response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          ...message,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return failure(`WhatsApp API request failed: ${reason}`);
  }

  let payload: GraphSendResponse;
  try {
    payload = (await response.json()) as GraphSendResponse;
  } catch {
    return failure(
      `WhatsApp API returned an unreadable response (HTTP ${response.status})`,
    );
  }

  if (!response.ok) {
    return failure(
      payload.error?.message ??
        `WhatsApp API rejected the message (HTTP ${response.status})`,
    );
  }

  const messageId = payload.messages?.[0]?.id;
  if (!messageId) {
    return failure("WhatsApp API accepted the request but returned no message id");
  }

  return { success: true, messageId, error: null };
}

/**
 * A number as the Cloud API wants it in `to` and sends it back in `from`:
 * country code and digits, no "+", spaces or punctuation. Null when what is
 * left cannot be a phone number (E.164 allows at most 15 digits).
 */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "").replace(/^00/, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * Template text parameters may not contain newlines, tabs or more than four
 * consecutive spaces, and Meta rejects very long values. Flatten and cap them.
 */
export function templateText(value: string, max = 500): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export type WhatsAppTemplate = {
  /** Approved template name on the sender's WhatsApp Business account. */
  name: string;
  language: string;
  /** Body `{{1}}..{{n}}` values, in order. */
  bodyParams: string[];
  /** Dynamic suffix of a URL button (index 0), e.g. the quick-link token. */
  urlButtonSuffix?: string;
  /** Payload of a quick-reply button (index 0), echoed back on the tap. */
  quickReplyPayload?: string;
};

/**
 * Send an approved template. Staff are normally outside any customer service
 * window, so a notification must be a template, not free-form text.
 */
export async function sendWhatsAppTemplate(
  credentials: WhatsAppSenderCredentials,
  to: string,
  template: WhatsAppTemplate,
): Promise<WhatsAppSendResult> {
  const components: Record<string, unknown>[] = [];
  if (template.bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: template.bodyParams.map((text) => ({
        type: "text",
        text: templateText(text),
      })),
    });
  }
  if (template.urlButtonSuffix !== undefined) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: template.urlButtonSuffix }],
    });
  }
  if (template.quickReplyPayload !== undefined) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: template.quickReplyPayload }],
    });
  }

  return postWhatsAppMessage(credentials, {
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      components,
    },
  });
}

// --- Groups API (Team chat, human handoff spec decision 11) -----------------
// Only an Official Business Account sender may use groups. Interactive
// messages are unsupported in groups, so everything posted there is text.
// Source notes: docs/research/whatsapp-groups-payload.md.

type GraphResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** One Graph API call. Never throws; credentials are never logged. */
async function graphRequest<T>(
  credentials: WhatsAppSenderCredentials,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<GraphResult<T>> {
  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `WhatsApp API request failed: ${reason}` };
  }
  let payload: (T & { error?: { message?: string } }) | null = null;
  try {
    payload = (await response.json()) as T & { error?: { message?: string } };
  } catch {
    return {
      ok: false,
      error: `WhatsApp API returned an unreadable response (HTTP ${response.status})`,
    };
  }
  if (!response.ok || !payload) {
    return {
      ok: false,
      error: payload?.error?.message ?? `WhatsApp API rejected the request (HTTP ${response.status})`,
    };
  }
  return { ok: true, data: payload };
}

/**
 * Whether the sender is an Official Business Account, the precondition for
 * the Groups API. Any failure reads as "not OBA", so Team chat stays off.
 */
export async function isOfficialBusinessAccount(
  credentials: WhatsAppSenderCredentials,
): Promise<boolean> {
  const result = await graphRequest<{ is_official_business_account?: boolean }>(
    credentials,
    "GET",
    `${credentials.phoneNumberId}?fields=is_official_business_account`,
  );
  return result.ok && result.data.is_official_business_account === true;
}

export type CreateGroupResult =
  | {
      success: true;
      /** Matched by the `group_lifecycle_update` webhook. */
      requestId: string | null;
      /** Present only if the API answered synchronously. */
      groupId: string | null;
      inviteLink: string | null;
    }
  | { success: false; error: string };

/**
 * Create a group owned by the sender. Participants cannot be added directly;
 * they join through the invite link. Creation is normally asynchronous: the
 * group id and invite link arrive on the lifecycle webhook.
 */
export async function createWhatsAppGroup(
  credentials: WhatsAppSenderCredentials,
  group: { subject: string; description?: string },
): Promise<CreateGroupResult> {
  const result = await graphRequest<{
    request_id?: string;
    id?: string;
    group_id?: string;
    invite_link?: string;
  }>(credentials, "POST", `${credentials.phoneNumberId}/groups`, {
    messaging_product: "whatsapp",
    subject: templateText(group.subject, 100),
    ...(group.description ? { description: templateText(group.description, 500) } : {}),
  });
  if (!result.ok) return { success: false, error: result.error };
  const requestId = result.data.request_id ?? null;
  const groupId = result.data.group_id ?? result.data.id ?? null;
  if (!requestId && !groupId) {
    return { success: false, error: "WhatsApp API returned no group request id" };
  }
  return { success: true, requestId, groupId, inviteLink: result.data.invite_link ?? null };
}

/** The group's current invite link, or null when it cannot be read. */
export async function getWhatsAppGroupInviteLink(
  credentials: WhatsAppSenderCredentials,
  groupId: string,
): Promise<string | null> {
  const result = await graphRequest<{ invite_link?: string }>(
    credentials,
    "GET",
    `${encodeURIComponent(groupId)}/invite_link`,
  );
  return result.ok ? (result.data.invite_link ?? null) : null;
}

/**
 * Post free text to a group. `quoteMessageId` makes it a contextual reply
 * (a quote of that message); whether groups honour it is unverified, so the
 * text must stand on its own without the quote.
 */
export async function sendWhatsAppGroupText(
  credentials: WhatsAppSenderCredentials,
  groupId: string,
  text: string,
  quoteMessageId?: string | null,
): Promise<WhatsAppSendResult> {
  return postWhatsAppMessage(credentials, {
    recipient_type: "group",
    to: groupId,
    type: "text",
    text: { body: text, preview_url: false },
    ...(quoteMessageId ? { context: { message_id: quoteMessageId } } : {}),
  });
}
