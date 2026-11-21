import type { InboundRequest } from "./handle-inbound-message";

const PLATFORMS = new Set(["whatsapp", "instagram"]);

/**
 * Validate an `/internal/inbound` body. The caller is our own web app behind a
 * shared secret, so this guards against a malformed request rather than a
 * hostile one — but a bad chatId would start a run against nothing.
 */
export function parseInboundRequest(body: unknown): InboundRequest | null {
  if (!body || typeof body !== "object") return null;

  const { platform, chatId, channelId } = body as Record<string, unknown>;

  if (typeof platform !== "string" || !PLATFORMS.has(platform)) return null;
  if (typeof chatId !== "string" || chatId.length === 0) return null;
  if (typeof channelId !== "string" || channelId.length === 0) return null;

  return {
    platform: platform as InboundRequest["platform"],
    chatId,
    channelId,
  };
}
