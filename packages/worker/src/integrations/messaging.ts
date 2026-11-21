// Outbound WhatsApp, Instagram and Messenger sends go to the real Graph APIs.
// Conversation reads stay mocked — none of these APIs has a read endpoint;
// inbound arrives by webhook.
// TODO: Replace the remaining mock conversation reads, and receive Messenger
// inbound (there is no Messenger webhook yet).

import { postWhatsAppMessage } from "./whatsapp";
import {
  sendInstagramDirectMessage,
  type InstagramCredentials,
} from "./instagram";

export type { InstagramCredentials };

export type MessagePlatform = "whatsapp" | "instagram" | "facebook";

/** Per-channel WhatsApp Business credentials, from `channels.config`. */
export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

/** Graph API version and send timeout for Messenger sends. */
const GRAPH_API_VERSION = "v21.0";
const SEND_TIMEOUT_MS = 10_000;

/** Per-channel Messenger credentials: the Page and its Page access token. */
export interface MessengerCredentials {
  pageId: string;
  accessToken: string;
}

export interface Conversation {
  id: string;
  platform: MessagePlatform;
  recipientId: string;
  recipientName: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  avatarUrl: string | null;
}

export interface PlatformMessage {
  id: string;
  conversationId: string;
  platform: MessagePlatform;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  direction: "inbound" | "outbound";
  status: "sent" | "delivered" | "read" | "failed";
}

export interface SendMessageResult {
  success: boolean;
  messageId: string | null;
  error: string | null;
  platform: MessagePlatform;
}

// --- Mock Data ---

const MOCK_CONVERSATIONS: Record<MessagePlatform, Conversation[]> = {
  whatsapp: [
    {
      id: "wa_conv_001",
      platform: "whatsapp",
      recipientId: "wa_user_001",
      recipientName: "Sarah Johnson",
      lastMessage: "When will my order arrive?",
      lastMessageAt: "2026-02-08T10:30:00Z",
      unreadCount: 2,
      avatarUrl: null,
    },
    {
      id: "wa_conv_002",
      platform: "whatsapp",
      recipientId: "wa_user_002",
      recipientName: "Michael Chen",
      lastMessage: "Thanks for the help!",
      lastMessageAt: "2026-02-08T09:15:00Z",
      unreadCount: 0,
      avatarUrl: null,
    },
    {
      id: "wa_conv_003",
      platform: "whatsapp",
      recipientId: "wa_user_003",
      recipientName: "Emily Davis",
      lastMessage: "Do you have this in blue?",
      lastMessageAt: "2026-02-07T16:45:00Z",
      unreadCount: 1,
      avatarUrl: null,
    },
  ],
  instagram: [
    {
      id: "ig_conv_001",
      platform: "instagram",
      recipientId: "ig_user_001",
      recipientName: "alex.creative",
      lastMessage: "Love the new collection!",
      lastMessageAt: "2026-02-08T11:00:00Z",
      unreadCount: 1,
      avatarUrl: null,
    },
    {
      id: "ig_conv_002",
      platform: "instagram",
      recipientId: "ig_user_002",
      recipientName: "style.guru",
      lastMessage: "Can I get a discount code?",
      lastMessageAt: "2026-02-08T08:20:00Z",
      unreadCount: 1,
      avatarUrl: null,
    },
  ],
  facebook: [
    {
      id: "fb_conv_001",
      platform: "facebook",
      recipientId: "fb_user_001",
      recipientName: "James Wilson",
      lastMessage: "I need to return an item",
      lastMessageAt: "2026-02-08T12:00:00Z",
      unreadCount: 3,
      avatarUrl: null,
    },
    {
      id: "fb_conv_002",
      platform: "facebook",
      recipientId: "fb_user_002",
      recipientName: "Maria Garcia",
      lastMessage: "What are your store hours?",
      lastMessageAt: "2026-02-07T14:30:00Z",
      unreadCount: 0,
      avatarUrl: null,
    },
  ],
};

const MOCK_MESSAGES: Record<string, PlatformMessage[]> = {
  wa_conv_001: [
    {
      id: "msg_wa_001",
      conversationId: "wa_conv_001",
      platform: "whatsapp",
      senderId: "wa_user_001",
      senderName: "Sarah Johnson",
      content: "Hi, I placed an order yesterday. Order #12345",
      timestamp: "2026-02-08T10:15:00Z",
      direction: "inbound",
      status: "read",
    },
    {
      id: "msg_wa_002",
      conversationId: "wa_conv_001",
      platform: "whatsapp",
      senderId: "agent",
      senderName: "Support",
      content:
        "Hello Sarah! Let me check that for you. Your order is currently being processed.",
      timestamp: "2026-02-08T10:20:00Z",
      direction: "outbound",
      status: "delivered",
    },
    {
      id: "msg_wa_003",
      conversationId: "wa_conv_001",
      platform: "whatsapp",
      senderId: "wa_user_001",
      senderName: "Sarah Johnson",
      content: "When will my order arrive?",
      timestamp: "2026-02-08T10:30:00Z",
      direction: "inbound",
      status: "delivered",
    },
  ],
  ig_conv_001: [
    {
      id: "msg_ig_001",
      conversationId: "ig_conv_001",
      platform: "instagram",
      senderId: "ig_user_001",
      senderName: "alex.creative",
      content: "Love the new collection!",
      timestamp: "2026-02-08T11:00:00Z",
      direction: "inbound",
      status: "delivered",
    },
  ],
  fb_conv_001: [
    {
      id: "msg_fb_001",
      conversationId: "fb_conv_001",
      platform: "facebook",
      senderId: "fb_user_001",
      senderName: "James Wilson",
      content: "I need to return an item",
      timestamp: "2026-02-08T12:00:00Z",
      direction: "inbound",
      status: "delivered",
    },
  ],
};

// --- Public Functions ---

/**
 * Get conversations for a messaging platform.
 * TODO: Replace with real API calls (WhatsApp Business, Instagram Graph, Messenger)
 */
export async function getConversations(
  platform: MessagePlatform,
  limit?: number
): Promise<{ conversations: Conversation[]; total: number }> {
  const conversations = MOCK_CONVERSATIONS[platform] ?? [];
  const sliced = limit ? conversations.slice(0, limit) : conversations;

  return {
    conversations: sliced,
    total: conversations.length,
  };
}

/**
 * Get message history for a specific conversation.
 * TODO: Replace with real API calls
 */
export async function getMessageHistory(
  platform: MessagePlatform,
  conversationId: string,
  limit?: number
): Promise<{ messages: PlatformMessage[]; total: number }> {
  // Platform is used for routing to the correct API in production
  void platform;

  const messages = MOCK_MESSAGES[conversationId] ?? [];
  const sliced = limit ? messages.slice(-limit) : messages;

  return {
    messages: sliced,
    total: messages.length,
  };
}

/**
 * Send a text message through the WhatsApp Business Cloud API.
 * Never throws: the caller is a model-facing tool, so transport and API
 * errors come back as a failed result. Credentials are never logged.
 */
async function sendWhatsAppMessage(
  credentials: WhatsAppCredentials,
  recipientId: string,
  content: string
): Promise<SendMessageResult> {
  const result = await postWhatsAppMessage(credentials, {
    to: recipientId,
    type: "text",
    text: { preview_url: false, body: content },
  });
  return { ...result, platform: "whatsapp" };
}

function whatsappFailure(error: string): SendMessageResult {
  return { success: false, messageId: null, error, platform: "whatsapp" };
}

/** The parts of a Messenger Send API response we read. */
interface MessengerSendResponse {
  message_id?: string;
  error?: { message?: string };
}

/**
 * Send a text reply through the Messenger Platform Send API. `RESPONSE` is a
 * reply inside the 24 h window the customer's last message opened. Never
 * throws; credentials are never logged.
 */
async function sendMessengerMessage(
  credentials: MessengerCredentials,
  recipientId: string,
  content: string
): Promise<SendMessageResult> {
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${credentials.pageId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          messaging_type: "RESPONSE",
          message: { text: content },
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      }
    );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return failureFor("facebook", `Messenger API request failed: ${reason}`);
  }

  let payload: MessengerSendResponse;
  try {
    payload = (await response.json()) as MessengerSendResponse;
  } catch {
    return failureFor(
      "facebook",
      `Messenger API returned an unreadable response (HTTP ${response.status})`
    );
  }

  if (!response.ok) {
    return failureFor(
      "facebook",
      payload.error?.message ??
        `Messenger API rejected the message (HTTP ${response.status})`
    );
  }
  if (!payload.message_id) {
    return failureFor(
      "facebook",
      "Messenger API accepted the request but returned no message id"
    );
  }
  return {
    success: true,
    messageId: payload.message_id,
    error: null,
    platform: "facebook",
  };
}

function failureFor(
  platform: MessagePlatform,
  error: string
): SendMessageResult {
  return { success: false, messageId: null, error, platform };
}

/**
 * Send a message to a recipient on a messaging platform.
 * WhatsApp, Instagram and Messenger are real Graph API calls and require the
 * channel's credentials. Missing credentials or an unknown platform return a
 * failure rather than a fabricated success, so the model is never told a
 * message was delivered when none was sent.
 */
export async function sendMessage(
  platform: MessagePlatform,
  recipientId: string,
  content: string,
  credentials?: WhatsAppCredentials | InstagramCredentials | MessengerCredentials
): Promise<SendMessageResult> {
  if (platform === "whatsapp") {
    const phoneNumberId =
      credentials && "phoneNumberId" in credentials
        ? credentials.phoneNumberId
        : undefined;
    if (!phoneNumberId || !credentials?.accessToken) {
      return whatsappFailure(
        "WhatsApp channel config is missing phoneNumberId or accessToken"
      );
    }
    return sendWhatsAppMessage(
      { phoneNumberId, accessToken: credentials.accessToken },
      recipientId,
      content
    );
  }

  if (platform === "instagram") {
    const accountId =
      credentials && "accountId" in credentials
        ? credentials.accountId
        : undefined;
    if (!accountId || !credentials?.accessToken) {
      return failureFor(
        platform,
        "Instagram channel config is missing accountId or accessToken"
      );
    }
    const result = await sendInstagramDirectMessage(
      { accountId, accessToken: credentials.accessToken },
      recipientId,
      content
    );
    return {
      success: result.success,
      messageId: result.id,
      error: result.error,
      platform,
    };
  }

  if (platform === "facebook") {
    const pageId =
      credentials && "pageId" in credentials ? credentials.pageId : undefined;
    if (!pageId || !credentials?.accessToken) {
      return failureFor(
        platform,
        "Messenger channel config is missing pageId or accessToken"
      );
    }
    return sendMessengerMessage(
      { pageId, accessToken: credentials.accessToken },
      recipientId,
      content
    );
  }

  return failureFor(platform, `Sending on ${platform} is not implemented`);
}
