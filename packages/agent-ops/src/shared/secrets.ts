import type { ChannelConfig } from "@relay/db/schema/channels";
import type { IntegrationConfig } from "@relay/db/schema/integrations";

export const MASKED_SECRET = "***";

export function resolveHeaderSecretsForUpdate(
  incoming: Record<string, string>,
  existing: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(incoming)) {
    if (value === MASKED_SECRET && key in existing) {
      resolved[key] = existing[key];
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

const SECRET_CHANNEL_KEYS = [
  "apiKey",
  "accessToken",
  "botToken",
  "accountId",
  // Nothing writes this yet — it is reserved for a per-channel Meta webhook
  // handshake. Listed now because the day something does write it is the day
  // it would otherwise be returned in cleartext.
  "webhookVerifyToken",
] as const;

const SECRET_INTEGRATION_KEYS = [
  "apiKey",
  "apiSecret",
  "accessToken",
  "refreshToken",
] as const;

export function maskSecret(value: string | undefined | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 4)}****`;
}

export function maskRecord(
  record: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!record) return null;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, maskSecret(value) ?? "****"]),
  );
}

export function maskChannelConfig(
  config: ChannelConfig | null | undefined,
): ChannelConfig {
  const base = config ?? {};
  const masked: ChannelConfig = { ...base };
  for (const key of SECRET_CHANNEL_KEYS) {
    if (key in base && base[key]) {
      masked[key] = maskSecret(base[key]) ?? "****";
    }
  }
  return masked;
}

export function maskIntegrationConfig(
  config: IntegrationConfig | null | undefined,
): IntegrationConfig {
  const base = config ?? {};
  const masked: IntegrationConfig = { ...base };
  for (const key of SECRET_INTEGRATION_KEYS) {
    if (key in base && base[key]) {
      masked[key] = maskSecret(base[key]) ?? "****";
    }
  }
  if (base.mcpHeaders) {
    masked.mcpHeaders = maskRecord(base.mcpHeaders) ?? {};
  }
  return masked;
}
