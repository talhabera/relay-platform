// Outbound Instagram Graph API calls. This module is database-free: the
// caller supplies credentials, mirroring the WhatsApp client in messaging.ts.
// Nothing here throws — the callers are model-facing tools, so transport and
// API errors come back as failed results. Credentials are never logged.

const GRAPH_API_VERSION = "v21.0";
const REQUEST_TIMEOUT_MS = 10_000;

/** Per-channel Instagram credentials, from `channels.config`. */
export interface InstagramCredentials {
  accountId: string;
  accessToken: string;
}

export interface InstagramCallResult {
  success: boolean;
  id: string | null;
  error: string | null;
}

/** The parts of a Graph response we read. */
interface GraphResponse {
  id?: string;
  message_id?: string;
  error?: { message?: string };
}

function failure(error: string): InstagramCallResult {
  return { success: false, id: null, error };
}

/**
 * POST a JSON body to a Graph API path and pull one id field out of the
 * response. `idField` differs by edge: sends return `message_id`, the
 * comment replies edge returns `id`.
 */
async function graphPost(
  path: string,
  accessToken: string,
  body: unknown,
  idField: "id" | "message_id"
): Promise<InstagramCallResult> {
  let response: Response;

  try {
    response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return failure(`Instagram API request failed: ${reason}`);
  }

  let payload: GraphResponse;
  try {
    payload = (await response.json()) as GraphResponse;
  } catch {
    return failure(
      `Instagram API returned an unreadable response (HTTP ${response.status})`
    );
  }

  if (!response.ok) {
    return failure(
      payload.error?.message ??
        `Instagram API rejected the request (HTTP ${response.status})`
    );
  }

  const id = payload[idField];
  if (!id) {
    return failure(
      "Instagram API accepted the request but returned no id"
    );
  }

  return { success: true, id, error: null };
}

/** Send a direct message to an Instagram-scoped user id. */
export async function sendInstagramDirectMessage(
  credentials: InstagramCredentials,
  recipientId: string,
  content: string
): Promise<InstagramCallResult> {
  return graphPost(
    `${credentials.accountId}/messages`,
    credentials.accessToken,
    { recipient: { id: recipientId }, message: { text: content } },
    "message_id"
  );
}

/** Post a publicly visible reply under a comment. */
export async function postInstagramCommentReply(
  credentials: InstagramCredentials,
  igCommentId: string,
  content: string
): Promise<InstagramCallResult> {
  return graphPost(
    `${igCommentId}/replies`,
    credentials.accessToken,
    { message: content },
    "id"
  );
}

/**
 * Send a private reply addressed by comment id. Instagram allows exactly one
 * per comment, within seven days; the caller enforces the once-per-comment
 * rule from the database before reaching this function.
 */
export async function sendInstagramPrivateReply(
  credentials: InstagramCredentials,
  igCommentId: string,
  content: string
): Promise<InstagramCallResult> {
  return graphPost(
    `${credentials.accountId}/messages`,
    credentials.accessToken,
    { recipient: { comment_id: igCommentId }, message: { text: content } },
    "message_id"
  );
}
