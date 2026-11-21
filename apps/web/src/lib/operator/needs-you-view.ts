import type { NeedsYouItem } from "@/lib/operator/needs-you";

// View helpers shared by the bell panel, the Needs you page (06/needs-you/list)
// and the Operator list surface (06/entry-points). Pure: no db, no React.

/** Figma `Needs you row` kind. */
export type NeedsYouRowKind = "checkpoint" | "question" | "failed-run" | "brief";

/** An item as it reaches the client: `createdAt` is a string after JSON. */
export type NeedsYouItemLike = Omit<NeedsYouItem, "createdAt"> & {
  createdAt: Date | string;
};

export function needsYouRowKind(type: NeedsYouItem["type"]): NeedsYouRowKind {
  if (type === "agent_question") return "question";
  if (type === "failed_run") return "failed-run";
  if (type === "brief") return "brief";
  return "checkpoint";
}

/** "just now", "12m ago", "6h ago", "3d ago". */
export function formatNeedsYouAge(createdAt: Date | string, now: Date): string {
  const t = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const minutes = Math.floor((now.getTime() - t.getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type NeedsYouRowView = {
  id: string;
  kind: NeedsYouRowKind;
  title: string;
  workflow?: string;
  impact?: string;
  agent: string;
  age: string;
  href: string;
};

/** NeedsYouItem -> Needs you row props. A failed run's error is its impact line. */
export function toNeedsYouRow(item: NeedsYouItemLike, now: Date): NeedsYouRowView {
  return {
    id: item.id,
    kind: needsYouRowKind(item.type),
    title: item.title,
    workflow: item.workflow ?? undefined,
    impact: item.type === "failed_run" && item.error ? item.error : undefined,
    agent: item.agentName,
    age: formatNeedsYouAge(item.createdAt, now),
    href: item.href,
  };
}

// ---------------------------------------------------------------------------
// Filter (06/needs-you/list: KIND and WORKFLOW chips)
// ---------------------------------------------------------------------------

export const NEEDS_YOU_KIND_FILTERS = ["all", "checkpoint", "question", "failed-run"] as const;
export type NeedsYouKindFilter = (typeof NEEDS_YOU_KIND_FILTERS)[number];

export type NeedsYouFilter = {
  kind: NeedsYouKindFilter;
  /** Workflow name; null = all workflows. */
  workflow: string | null;
};

export const NEEDS_YOU_KIND_LABEL: Record<NeedsYouKindFilter, string> = {
  all: "All",
  checkpoint: "Checkpoints",
  question: "Questions",
  "failed-run": "Failed runs",
};

export function parseNeedsYouFilter(params: {
  kind?: string | string[];
  workflow?: string | string[];
}): NeedsYouFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const kind = one(params.kind);
  const workflow = one(params.workflow)?.trim();
  return {
    kind: (NEEDS_YOU_KIND_FILTERS as readonly string[]).includes(kind ?? "")
      ? (kind as NeedsYouKindFilter)
      : "all",
    workflow: workflow ? workflow : null,
  };
}

/** Briefs have no KIND chip: they show under All only. */
export function matchesNeedsYouFilter(item: NeedsYouItemLike, filter: NeedsYouFilter): boolean {
  if (filter.kind !== "all" && needsYouRowKind(item.type) !== filter.kind) return false;
  if (filter.workflow !== null && item.workflow !== filter.workflow) return false;
  return true;
}

/** Keeps server order; never re-sorts. */
export function filterNeedsYou<T extends NeedsYouItemLike>(items: T[], filter: NeedsYouFilter): T[] {
  return items.filter((i) => matchesNeedsYouFilter(i, filter));
}

export type NeedsYouFacets = {
  kind: Record<NeedsYouKindFilter, number>;
  /** Workflows in first-appearance (impact) order. Items with no workflow are not listed. */
  workflows: { name: string; count: number }[];
};

/**
 * Chip counts. Kind counts respect the workflow filter and workflow counts
 * respect the kind filter, so every chip says what clicking it shows.
 */
export function needsYouFacets(items: NeedsYouItemLike[], filter: NeedsYouFilter): NeedsYouFacets {
  const kind: Record<NeedsYouKindFilter, number> = {
    all: 0,
    checkpoint: 0,
    question: 0,
    "failed-run": 0,
  };
  const byWorkflow = new Map<string, number>();
  for (const item of items) {
    if (matchesNeedsYouFilter(item, { kind: "all", workflow: filter.workflow })) {
      kind.all += 1;
      const rowKind = needsYouRowKind(item.type);
      if (rowKind !== "brief") kind[rowKind] += 1;
    }
    if (item.workflow && matchesNeedsYouFilter(item, { kind: filter.kind, workflow: null })) {
      byWorkflow.set(item.workflow, (byWorkflow.get(item.workflow) ?? 0) + 1);
    }
  }
  return {
    kind,
    workflows: [...byWorkflow].map(([name, count]) => ({ name, count })),
  };
}

export const NEEDS_YOU_PATH = "/needs-you";

/** URL for a filter (and optionally a selected item) on the Needs you page. */
export function needsYouPageHref(filter: NeedsYouFilter, itemId?: string | null): string {
  const q = new URLSearchParams();
  if (filter.kind !== "all") q.set("kind", filter.kind);
  if (filter.workflow) q.set("workflow", filter.workflow);
  if (itemId) q.set("item", itemId);
  const s = q.toString();
  return s ? `${NEEDS_YOU_PATH}?${s}` : NEEDS_YOU_PATH;
}

// ---------------------------------------------------------------------------
// Detail pane (06/needs-you/list)
// ---------------------------------------------------------------------------

export type NeedsYouStatusTone = "needs-you" | "pending" | "error";

/** Status chip for the selected item. State never changes order (ordering spec 4). */
export function needsYouStatus(item: NeedsYouItemLike): { tone: NeedsYouStatusTone; label: string } {
  if (item.type === "failed_run") return { tone: "error", label: "Run failed" };
  if (item.type === "checkpoint") {
    if (item.checkpointStatus === "failed") return { tone: "error", label: "Failed" };
    if (item.checkpointStatus === "stale") return { tone: "pending", label: "Stale" };
  }
  return { tone: "needs-you", label: "Needs you" };
}

/** What the impact tier means, in the words of the ordering spec. */
export function needsYouImpactCopy(tier: NeedsYouItem["tier"]): string {
  if (tier === 1) return "A lead workflow stopped: no new leads move until this run is fixed.";
  if (tier === 2) return "Holds up qualified leads in a lead workflow.";
  return "Does not hold up leads. Handle it after the lead items above.";
}

/** Customer-chat items open the Inbox conversation (S45); the rest open an Operator session. */
/**
 * The live card the /needs-you pane renders (W5GAP): a lead_delivery checkpoint
 * on a customer conversation, so an approver without Inbox (`messaging`)
 * access can still act on it. Null for everything else.
 */
export function needsYouLiveCheckpoint(
  item: NeedsYouItemLike,
): { chatId: string; checkpointId: string } | null {
  if (
    item.type !== "checkpoint" ||
    item.checkpointKind !== "lead_delivery" ||
    !item.onCustomerChat ||
    !item.chatId
  ) {
    return null;
  }
  return { chatId: item.chatId, checkpointId: item.id };
}

export function needsYouOpenLabel(href: string): string {
  if (href.startsWith("/home")) return "Open brief";
  return href.startsWith("/messaging") ? "Open conversation" : "Open session";
}
