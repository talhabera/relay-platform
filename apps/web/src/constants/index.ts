export { MODEL_LABELS, MODEL_KEYS } from "@/lib/ai/model-keys";

export const APP_NAME = "Relay";
export const APP_DESCRIPTION = "AI Agent Platform for Agencies";

export const PERSONA_LABELS: Record<string, string> = {
  friendly: "Friendly",
  professional: "Professional",
  casual: "Casual",
  expert: "Expert",
};

export const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  tr: "Turkish",
};

export const RESPONSE_LENGTH_LABELS: Record<string, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
};

export const CHANNEL_TYPE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  telegram: "Telegram",
  messenger: "Messenger",
  widget: "Widget",
};

export const INTEGRATION_TYPE_LABELS: Record<string, string> = {
  slack: "Slack",
  discord: "Discord",
  zendesk: "Zendesk",
  shopify: "Shopify",
  mcp_custom: "Custom MCP",
  hunter: "Hunter",
  snov: "Snov",
  google_places: "Google Places",
};

export const INTEGRATION_STATUS_LABELS: Record<string, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  pending: "Pending",
  error: "Error",
};

// Token usage limits (weekly). Fixed for now; make per-company/plan later.
export const WEEKLY_TOKEN_LIMIT_USER = 1_000_000;
export const WEEKLY_TOKEN_LIMIT_WIDGET = 50_000;

export const OPERATOR_EXCEL_MAX_ROWS = 10_000;
export const OPERATOR_EXCEL_MAX_BYTES = 5 * 1024 * 1024;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
