import type { IconName } from "@/components/v2/primitives";

import type { AgentsCanvasIntegration } from "./agents-canvas-model";

// Pure helpers for the customer inspector tabs (Figma 07 `agents-customer/instructions` 411:31861,
// `agents-customer/integrations` 411:37385).

export const INSTRUCTIONS_MAX = 5000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Saved 24 Sep, 16:40 · 434 characters" under the instructions field. */
export function instructionsMeta(savedAt: Date | undefined, length: number): string {
  const chars = `${length} ${length === 1 ? "character" : "characters"}`;
  if (!savedAt) return chars;
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${savedAt.getDate()} ${MONTHS[savedAt.getMonth()]}`;
  return `Saved ${day}, ${pad(savedAt.getHours())}:${pad(savedAt.getMinutes())} · ${chars}`;
}

/** Save changes is live on the Instructions tab only when an owner changed the text within limits. */
export function canSaveInstructions(saved: string, draft: string, canManage: boolean): boolean {
  return canManage && draft !== saved && draft.length <= INSTRUCTIONS_MAX;
}

const INTEGRATION_ICON: Record<string, IconName> = {
  slack: "hash",
  discord: "hash",
  zendesk: "inbox",
  shopify: "store",
  mcp_custom: "plug",
  hunter: "search",
  snov: "mail",
  google_places: "map-pin",
};

export type InspectorIntegrationRow = {
  /** Integration id; `builtin:*` rows are always on and cannot be toggled. */
  id: string;
  label: string;
  icon: IconName;
  on: boolean;
  builtin: boolean;
};

/**
 * Integrations tab rows: Knowledge base search is built in (the worker always registers it),
 * then the agent's own integrations and the company-wide ones, on when connected.
 */
export function integrationRows(integrations: readonly AgentsCanvasIntegration[]): InspectorIntegrationRow[] {
  return [
    { id: "builtin:knowledge", label: "Knowledge base search", icon: "book-open", on: true, builtin: true },
    ...integrations.map((i) => ({
      id: i.id,
      label: i.name,
      icon: INTEGRATION_ICON[i.type] ?? "plug",
      on: i.connected,
      builtin: false,
    })),
  ];
}

const TOOL_LABELS: Record<string, string> = {
  searchKnowledgeBase: "Knowledge base search",
  getShopifyProducts: "Shopify products",
  getShopifyCollections: "Shopify collections",
  ask_human: "Hand off to a person",
  record_lead: "Record lead",
};

/** Test chat tool chip label: a known name, else the camelCase / snake_case id in words. */
export function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
