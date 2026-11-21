import type { ChannelConfig } from "@relay/db";
import type { WhatsAppCredentials } from "../integrations/messaging";

/**
 * Extract a complete WhatsApp credential pair from a channel config.
 * Returns null when either field is missing, so a half-configured channel
 * never reaches the API. Lives outside tools.ts so the lead notifier can use
 * it without importing the tool registry (which imports the lead tool).
 */
export function whatsappCredentials(
  config: ChannelConfig | null | undefined,
): WhatsAppCredentials | null {
  const phoneNumberId = config?.phoneNumberId;
  const accessToken = config?.accessToken;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}
