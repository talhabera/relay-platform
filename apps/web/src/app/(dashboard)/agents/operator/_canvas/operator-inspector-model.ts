// Pure view model for the operator inspector tabs (Figma 07 `agents-operator/*`): Access rows
// (`access`, `access-member`), Schedules rows (`schedules`), fork naming (`versions-fork`) and
// the promote diff and impact (`versions-promote`). Client-safe: no `@relay/db` imports.
import type { CronRunStatus } from "@/lib/operator/cron-badge";
import { formatCadence, formatRunTime, scheduleHref } from "@/lib/operator/cron-schedules";

/** Next `vN` after the highest numbered version name ("v1", "v2" -> "v3"). */
export function nextVersionName(names: readonly string[]): string {
  const highest = names.reduce((max, name) => {
    const match = /^v(\d+)$/i.exec(name.trim());
    return match ? Math.max(max, Number(match[1])) : max;
  }, 1);
  return `v${highest + 1}`;
}

// ---------------------------------------------------------------------------------------------
// Access tab
// ---------------------------------------------------------------------------------------------

export type AccessPerson = { id: string; name: string | null; email: string };

export type AccessInput = {
  viewerId: string;
  /** Company owner: always approves (approve-rights decision 2). */
  ownerId: string;
  /** Agent creator: holds edit and approve implicitly (decision 3). */
  creatorId: string | null;
  /** Viewer passes `requireOperatorAgentEdit` (grants and revokes Edit). */
  viewerCanEdit: boolean;
  /** `operator_agent_editors` rows of the agent. */
  agentUsers: readonly { user: AccessPerson; canEdit: boolean; canApprove: boolean }[];
  /** Company memberships (the owner has none unless also a member row). */
  members: readonly { user: AccessPerson; role: "member" | "client"; operator: boolean }[];
  /** Owner and creator user records (they may have no membership row). */
  people: readonly AccessPerson[];
};

export type AccessToggle = { on: boolean; disabled: boolean };

export type AccessRow = {
  userId: string;
  name: string;
  initials: string;
  subtitle: string;
  /** Agent creator: both rights fixed (lock icon). */
  locked: boolean;
  edit: AccessToggle;
  approve: AccessToggle;
};

export type AccessModel = {
  rows: AccessRow[];
  /** Operator members who have no row yet (Add person). */
  candidates: { id: string; label: string }[];
  canAdd: boolean;
  /** Only the company owner turns Approve on or off (decision 5). */
  canChangeApprove: boolean;
};

const displayName = (p: AccessPerson) => p.name?.trim() || p.email;

export function initialsOf(person: AccessPerson): string {
  const words = displayName(person).split(/[\s@._-]+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function buildAccessModel(input: AccessInput): AccessModel {
  const canChangeApprove = input.viewerId === input.ownerId;
  const byId = new Map<string, AccessPerson>();
  for (const p of input.people) byId.set(p.id, p);
  for (const m of input.members) byId.set(m.user.id, m.user);
  for (const u of input.agentUsers) byId.set(u.user.id, u.user);
  const operatorMember = new Set(input.members.filter((m) => m.role === "member" && m.operator).map((m) => m.user.id));

  const rows: AccessRow[] = [];
  const row = (person: AccessPerson, subtitle: string, rest: Omit<AccessRow, "userId" | "name" | "initials" | "subtitle">) =>
    rows.push({ userId: person.id, name: displayName(person), initials: initialsOf(person), subtitle, ...rest });

  const creator = input.creatorId ? byId.get(input.creatorId) : undefined;
  if (creator) {
    row(creator, creator.id === input.ownerId ? "Owner · agent creator" : "Agent creator", {
      locked: true,
      edit: { on: true, disabled: true },
      approve: { on: true, disabled: true },
    });
  }

  const agentUserById = new Map(input.agentUsers.map((u) => [u.user.id, u]));
  const owner = byId.get(input.ownerId);
  if (owner && owner.id !== creator?.id) {
    row(owner, "Owner", {
      locked: false,
      edit: { on: agentUserById.get(owner.id)?.canEdit === true, disabled: !input.viewerCanEdit },
      approve: { on: true, disabled: true },
    });
  }

  for (const u of input.agentUsers) {
    if (u.user.id === creator?.id || u.user.id === input.ownerId) continue;
    row(u.user, operatorMember.has(u.user.id) ? "Member · Operator access" : "Member", {
      locked: false,
      edit: { on: u.canEdit, disabled: !input.viewerCanEdit },
      approve: { on: u.canApprove, disabled: !canChangeApprove },
    });
  }

  const listed = new Set(rows.map((r) => r.userId));
  const candidates = input.members
    .filter((m) => m.role === "member" && m.operator && !listed.has(m.user.id))
    .map((m) => ({ id: m.user.id, label: displayName(m.user) }));

  return { rows, candidates, canAdd: input.viewerCanEdit && candidates.length > 0, canChangeApprove };
}

// ---------------------------------------------------------------------------------------------
// Schedules tab
// ---------------------------------------------------------------------------------------------

export type ScheduleJobInput = {
  id: string;
  name: string;
  scheduleKind: "interval" | "daily" | "weekly";
  intervalMinutes: number | null;
  weekday: number | null;
  timeOfDay: number | null;
  timezone: string;
  enabled: boolean;
  nextFireAt: Date;
  versionName: string;
  latestStatus: CronRunStatus | null;
};

export type ScheduleTone = "success" | "error" | "pending" | "needs-you" | "neutral";

export type ScheduleRow = {
  id: string;
  name: string;
  detail: string;
  tone: ScheduleTone;
  label: string;
  href: string;
};

function scheduleChip(job: ScheduleJobInput): { tone: ScheduleTone; label: string } {
  if (!job.enabled) return { tone: "neutral", label: "Paused" };
  switch (job.latestStatus) {
    case "succeeded":
      return { tone: "success", label: "Succeeded" };
    case "failed":
      return { tone: "error", label: "Failed" };
    case "running":
      return { tone: "pending", label: "Running" };
    case "awaiting_input":
      return { tone: "needs-you", label: "Needs you" };
    case null:
      return { tone: "neutral", label: "No runs" };
  }
}

export function buildScheduleTab(jobs: readonly ScheduleJobInput[]): { rows: ScheduleRow[]; nextRun: string | null } {
  const rows = jobs.map((job) => ({
    id: job.id,
    name: job.name,
    detail: `${formatCadence(job)} · ${job.versionName}`,
    ...scheduleChip(job),
    href: scheduleHref(job.id),
  }));
  const next = jobs
    .filter((job) => job.enabled)
    .reduce<ScheduleJobInput | null>((best, job) => (!best || job.nextFireAt < best.nextFireAt ? job : best), null);
  const nextRun = next
    ? `${formatRunTime(next.nextFireAt.toISOString(), next.timezone)} ${next.timezone} · ${next.name}`
    : null;
  return { rows, nextRun };
}

// ---------------------------------------------------------------------------------------------
// Promote dialog
// ---------------------------------------------------------------------------------------------

export type DiffLine = { kind: "removed" | "added"; text: string };

const lines = (text: string | null | undefined) =>
  (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Line diff of two instruction texts (LCS), changed lines only, in reading order. */
export function instructionDiff(before: string | null | undefined, after: string | null | undefined): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push({ kind: "removed", text: a[i++] });
    } else {
      out.push({ kind: "added", text: b[j++] });
    }
  }
  return out;
}

/**
 * Impact bullets of the promote dialog. Schedules pin a version (`cron_jobs.version_id`) and
 * operator sessions pin theirs, so promoting changes only what new sessions start on.
 */
export function promoteImpact(args: { from: string; to: string; pinnedSchedules: number }): string[] {
  const { from, to, pinnedSchedules } = args;
  const bullets = [`New sessions start on ${to}.`];
  if (pinnedSchedules === 1) bullets.push(`1 schedule stays on ${from} until you switch it in Schedules.`);
  else if (pinnedSchedules > 1)
    bullets.push(`${pinnedSchedules} schedules stay on ${from} until you switch them in Schedules.`);
  bullets.push(`Running sessions stay on ${from} until they finish.`);
  bullets.push(`${from} is kept. You can roll back from Versions at any time.`);
  return bullets;
}
