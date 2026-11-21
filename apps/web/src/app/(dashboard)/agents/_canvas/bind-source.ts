import type { CanvasSource } from "@/components/v2/canvas";
import { sourceLabel } from "@/components/v2/canvas/source-node";
import type { ChannelConfig } from "@/db/schema";
import { createChannelSchema, type CreateChannelInput } from "@/lib/validators/channel";

// Add source dialog (Figma 07 `agents-customer/add-binding`, 411:31835): the credentials each
// source needs before Relay can bind it to a customer agent, and the createChannel input it sends.

type CredentialKey = keyof Pick<ChannelConfig, "botToken" | "phoneNumberId" | "accessToken" | "accountId" | "apiKey">;

export type SourceCredentialField = {
  key: CredentialKey;
  label: string;
  placeholder: string;
  required: boolean;
};

export const SOURCE_CHANNEL_TYPE: Record<CanvasSource, CreateChannelInput["type"]> = {
  website: "widget",
  whatsapp: "whatsapp",
  instagram: "instagram",
  messenger: "messenger",
  telegram: "telegram",
};

export const sourceCredentialFields: Record<CanvasSource, readonly SourceCredentialField[]> = {
  website: [],
  whatsapp: [
    { key: "phoneNumberId", label: "Phone number ID", placeholder: "From WhatsApp Manager", required: true },
    { key: "accessToken", label: "Access token", placeholder: "Permanent access token", required: true },
  ],
  instagram: [
    { key: "accountId", label: "Instagram account ID", placeholder: "Instagram Business account ID", required: true },
    { key: "accessToken", label: "Access token", placeholder: "Instagram access token", required: true },
  ],
  messenger: [
    { key: "accessToken", label: "Page access token", placeholder: "Messenger page access token", required: true },
    { key: "apiKey", label: "App secret", placeholder: "Optional", required: false },
  ],
  telegram: [
    { key: "botToken", label: "Telegram bot token", placeholder: "Paste the token from BotFather", required: true },
  ],
};

/** Second line of a source option: who answers it today, or how to connect it. */
export function sourceOptionHint(source: CanvasSource, boundTo: readonly string[]): string {
  if (boundTo.length === 1) return `Bound to ${boundTo[0]}`;
  if (boundTo.length > 1) return `Bound to ${boundTo[0]} and ${boundTo.length - 1} more`;
  if (source === "website") return "Answers through the embed snippet";
  if (source === "telegram") return "Connect with a bot token";
  return "Connect with your Meta credentials";
}

export type BindSourceResult =
  | { ok: true; input: CreateChannelInput }
  | { ok: false; missing: CredentialKey[] };

/**
 * Build the createChannel input that binds `source` to `agentId`. Trims every credential and
 * reports the required ones that are empty instead of sending a channel that cannot connect.
 */
export function bindSourceInput(
  source: CanvasSource,
  agentId: string,
  values: Partial<Record<CredentialKey, string>>,
): BindSourceResult {
  const config: Partial<Record<CredentialKey, string>> = {};
  const missing: CredentialKey[] = [];
  for (const field of sourceCredentialFields[source]) {
    const value = values[field.key]?.trim() ?? "";
    if (value) config[field.key] = value;
    else if (field.required) missing.push(field.key);
  }
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    input: createChannelSchema.parse({
      name: sourceLabel[source],
      type: SOURCE_CHANNEL_TYPE[source],
      agentId,
      config,
    }),
  };
}
