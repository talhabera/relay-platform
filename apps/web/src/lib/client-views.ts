import type { Channel, ChannelType, Integration } from "@/types";

/**
 * A channel as the browser is allowed to see it.
 *
 * `channels.config` holds the WhatsApp and Instagram access tokens, the
 * Telegram bot token and the webhook verify token. The channels tab is a
 * client component, so every prop it receives is serialised into the page's
 * flight payload — passing a row straight through publishes those credentials
 * in page source. The tab only renders the name, the type, the status and the
 * two switches, so that is all that crosses the boundary.
 */
export type ChannelView = {
  id: string;
  name: string;
  type: ChannelType;
  status: "active" | "inactive";
  config: { autoReply: boolean; autoCommentReply: boolean };
};

/** Project a channel row down to what the client may hold. */
export function toChannelView(channel: Channel): ChannelView {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    status: channel.status === "active" ? "active" : "inactive",
    config: {
      autoReply: channel.config?.autoReply === true,
      autoCommentReply: channel.config?.autoCommentReply === true,
    },
  };
}

/**
 * An integration as the browser is allowed to see it.
 *
 * `integrations.config` holds API keys, secrets, OAuth tokens and MCP headers.
 * The integrations tab renders only the name, type, status, last error and
 * last sync, so the credentials stay on the server.
 */
export type IntegrationView = {
  id: string;
  name: string;
  type: Integration["type"];
  status: NonNullable<Integration["status"]>;
  error: string | null;
  lastSyncAt: Date | null;
};

/** Project an integration row down to what the client may hold. */
export function toIntegrationView(integration: Integration): IntegrationView {
  return {
    id: integration.id,
    name: integration.name,
    type: integration.type,
    status: integration.status ?? "pending",
    error: integration.error,
    lastSyncAt: integration.lastSyncAt,
  };
}
