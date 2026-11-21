import type { IconName } from "@/components/v2/primitives";
import type { WorkflowStageView, WorkflowView } from "@/lib/fixtures/interfaces";
import type { MetricKey } from "@/lib/workflows/metrics";

// Pure view model for the Operator Overview (Figma 05 `operator-home/{default, new-session}`).

export type OperatorAgentOption = {
  id: string;
  name: string;
  /** Live version, else the newest one; null when the agent has no version. */
  version: { id: string; name: string; status: "live" | "draft" } | null;
};

/** One pre-defined agent a session can start with (dialog option). */
export type SessionTarget = {
  /** Unique within its group (stage id, or the agent id outside workflows). */
  key: string;
  agentId: string;
  agentName: string;
  versionId: string;
  versionName: string;
  versionStatus: "live" | "draft";
  /** Stage name, e.g. "Qualify"; the agent name outside workflows. */
  label: string;
  /** e.g. "44 qualified · 1 waiting on you". */
  note: string | null;
};

/** A workflow chip in the new-session dialog. */
export type SessionTargetGroup = {
  id: string;
  label: string;
  icon: IconName;
  targets: SessionTarget[];
};

const STAGE_ICON: Partial<Record<MetricKey, IconName>> = {
  "posts.scheduled_review": "calendar",
  "reviews.new_negative": "star",
  "report.next_run": "chart-no-axes-column",
};

const STAGE_NOTE: Partial<Record<MetricKey, (v: number) => string>> = {
  "records.gathered": (v) => `${v} gathered this week`,
  "records.qualified": (v) => `${v} qualified`,
  "records.contacted_replied": (v) => `${v} contacted`,
  "records.delivered": (v) => `${v} delivered`,
  "posts.scheduled_review": (v) => `${v} posts`,
  "reviews.new_negative": (v) => `${v} new`,
};

export function stageNote(stage: Pick<WorkflowStageView, "metricKey" | "metricValue" | "pending">): string | null {
  const parts: string[] = [];
  const format = STAGE_NOTE[stage.metricKey];
  if (format && stage.metricValue != null) parts.push(format(stage.metricValue));
  if (stage.pending > 0) parts.push(`${stage.pending} waiting on you`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function toTarget(
  key: string,
  label: string,
  agent: OperatorAgentOption,
  note: string | null,
): SessionTarget | null {
  if (!agent.version) return null;
  return {
    key,
    agentId: agent.id,
    agentName: agent.name,
    versionId: agent.version.id,
    versionName: agent.version.name,
    versionStatus: agent.version.status,
    label,
    note,
  };
}

/**
 * Dialog chips: a multi-stage sequence workflow is one chip ("Lead engine") whose
 * stages are the options; a parallel workflow, or a workflow with one agent stage,
 * gives one chip per stage ("Content calendar", "Marketing analysis"). Operator
 * agents in no workflow land in "Other agents". Agents with no version are left out.
 */
export function buildSessionTargets(
  workflows: readonly WorkflowView[],
  agents: readonly OperatorAgentOption[],
): SessionTargetGroup[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const placed = new Set<string>();
  const groups: SessionTargetGroup[] = [];

  for (const w of [...workflows].sort((a, b) => a.position - b.position)) {
    const stages = w.stages
      .filter((s) => s.agent && byId.has(s.agent.id))
      .sort((a, b) => a.order - b.order);
    if (stages.length === 0) continue;
    for (const s of stages) placed.add(s.agent!.id);

    const stageTarget = (s: WorkflowStageView) =>
      toTarget(s.id, s.name, byId.get(s.agent!.id)!, stageNote(s));

    if (w.flow === "sequence" && stages.length > 1) {
      const targets = stages.map(stageTarget).filter((t): t is SessionTarget => t !== null);
      if (targets.length > 0) groups.push({ id: w.id, label: w.name, icon: "workflow", targets });
      continue;
    }
    for (const s of stages) {
      const target = stageTarget(s);
      if (!target) continue;
      groups.push({ id: s.id, label: s.name, icon: STAGE_ICON[s.metricKey] ?? "workflow", targets: [target] });
    }
  }

  const others = agents
    .filter((a) => !placed.has(a.id))
    .map((a) => toTarget(a.id, a.name, a, null))
    .filter((t): t is SessionTarget => t !== null);
  if (others.length > 0) groups.push({ id: "other", label: "Other agents", icon: "bot", targets: others });

  return groups;
}

function dayParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), year: get("year") };
}

/** ISO week (`to` exclusive) as "21–27 Sep 2026" or "28 Sep – 4 Oct 2026". */
export function weekRangeLabel(range: { from: Date; to: Date }, timeZone: string): string {
  const a = dayParts(range.from, timeZone);
  const b = dayParts(new Date(range.to.getTime() - 1), timeZone);
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  return `${a.day}–${b.day} ${b.month} ${b.year}`;
}

/** Estimated cost per qualified lead, e.g. "$41" or "$0.85". */
export function formatCostPerLead(usd: number | null | undefined): string | null {
  if (usd == null || !Number.isFinite(usd)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: usd >= 10 ? 0 : 2,
  }).format(usd);
}

/** "Latest 5 of 9 · open and finished sessions". */
export function recentSessionsSummary(shown: number, total: number): string {
  if (total === 0) return "No sessions yet";
  return `Latest ${shown} of ${total} · open and finished sessions`;
}

const BRIEF_TITLE_MAX = 80;

/** Session title from the brief's first line; "Untitled session" when empty. */
export function briefTitle(brief: string): string {
  const line = brief.trim().split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!line) return "Untitled session";
  return line.length > BRIEF_TITLE_MAX ? `${line.slice(0, BRIEF_TITLE_MAX - 1)}…` : line;
}
