import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  adChangeLog,
  adChangeReasonSchema,
  budgetDelta,
  checkCap,
  companies,
  db,
  AD_CHANGE_DETAIL_MAX,
  RESERVATION_TTL_MS,
  type AdChangeCommand,
  type AdChangeLogRow,
  type AdChangeOutcomeCode,
  type AdChangeReason,
  type AdPlatform,
  type NewAdChangeLogRow,
} from "@relay/db";
import {
  requireTryCampaigns,
  type AdCampaignState,
  type AdChangeApplied,
  type AdPlatformAdapter,
  type Result,
} from "../integrations/ads/adapter";
import { createFakeAdAdapter } from "../integrations/ads/fake-adapter";
import { createManualAdAdapter, pgManualAdStore } from "../integrations/ads/manual-adapter";

/**
 * RL8a (RELAY-166): the one way an ad change reaches a platform. Under a
 * per-company advisory lock it checks the daily cap (live budgets + unapplied
 * increases + this change), writes the intent row, then outside the lock asks
 * the adapter to apply the change and writes the result row. The unresolved
 * intent row is the reservation a concurrent increase sees, so the platform
 * call stays outside the lock on purpose. Nothing is guessed: a failed read or
 * write ends in a `failed` result row and is never retried here.
 */

export type AdChangeActor = { type: "agent"; agentId: string } | { type: "human"; userId: string };

/** Consumed unchanged by parts b1 and b2. */
export type ApplyAdChangeInput = {
  companyId: string;
  command: AdChangeCommand;
  reason: AdChangeReason;
  actor: AdChangeActor;
  autonomous: boolean;
  checkpointId?: string;
  attempt?: number;
  mode: "apply" | "reject_only";
};

export type ApplyAdChangeResult = {
  outcome: "applied" | "rejected" | "failed" | "allowed";
  changeId?: string;
  totalAfterMinor: number | null;
  code?: AdChangeOutcomeCode;
  detail?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
};

export type AdAccountRef = { platform: AdPlatform; accountId: string };

export type ReservationScan = {
  companyId: string;
  /** Intents without a result count when created at or after this. */
  since: Date;
  /** Applied results at or after this may be missing from the campaign read. */
  appliedSince: Date;
  /** The card being applied right now is not its own reservation. */
  excludeCheckpointId: string | null;
};

export interface AdChangeStoreTx {
  loadCapMinor(companyId: string): Promise<number | null>;
  reservedMinor(scan: ReservationScan): Promise<number>;
  findByCheckpoint(checkpointId: string, attempt: number): Promise<AdChangeLogRow[]>;
  insert(row: NewAdChangeLogRow): Promise<void>;
}

export interface AdChangeStore {
  findByCheckpoint(checkpointId: string, attempt: number): Promise<AdChangeLogRow[]>;
  insert(row: NewAdChangeLogRow): Promise<void>;
  /** One transaction holding `pg_advisory_xact_lock(hashtext('ad-cap:' || companyId))`. */
  withCapLock<T>(companyId: string, fn: (tx: AdChangeStoreTx) => Promise<T>): Promise<T>;
}

export type ApplyAdChangeDeps = {
  store: AdChangeStore;
  adapterFor: (platform: AdPlatform) => AdPlatformAdapter;
  /** The company's other ad accounts (RL9); the command's account is always read. */
  accountsFor?: (companyId: string) => Promise<AdAccountRef[]>;
  now: () => Date;
};

export class AdChangeInProgressError extends Error {
  constructor(checkpointId: string, attempt: number) {
    super(`ad change for checkpoint ${checkpointId} attempt ${attempt} is already in progress`);
    this.name = "AdChangeInProgressError";
  }
}

export async function applyAdChange(
  input: ApplyAdChangeInput,
  deps: ApplyAdChangeDeps,
): Promise<ApplyAdChangeResult> {
  const { store, now } = deps;
  const { companyId, command } = input;
  const reason = adChangeReasonSchema(input.actor.type).parse(input.reason);
  const attempt = input.checkpointId ? (input.attempt ?? 1) : (input.attempt ?? null);
  const writes = input.mode === "apply";

  // 1. A repeated apply of the same card attempt returns what happened.
  if (input.checkpointId) {
    const stored = (await store.findByCheckpoint(input.checkpointId, attempt!)).find(
      (r) => r.phase === "result",
    );
    if (stored) return fromResultRow(stored);
  }

  const changeId = randomUUID();
  const row = (campaign: AdCampaignState | null, deltaMinor: number) => ({
    companyId,
    changeId,
    platform: command.platform,
    accountId: command.accountId,
    campaignId: command.campaignId,
    campaignName: campaign?.name ?? command.observed?.campaignName ?? null,
    action: command.action,
    deltaMinor,
    actorType: input.actor.type,
    actorAgentId: input.actor.type === "agent" ? input.actor.agentId : null,
    actorUserId: input.actor.type === "human" ? input.actor.userId : null,
    autonomous: input.autonomous,
    checkpointId: input.checkpointId ?? null,
    attempt,
    reasonText: reason.text,
    reasonMetric: reason.metric ?? null,
    reasonValue: reason.value ?? null,
    reasonThreshold: reason.threshold ?? null,
  });

  const failBeforeIntent = async (code: AdChangeOutcomeCode, message: string) => {
    const detail = sanitizeDetail(message);
    if (!writes) return { outcome: "failed" as const, totalAfterMinor: null, code, detail };
    await store.insert({
      ...row(null, 0),
      phase: "result",
      outcome: "failed",
      outcomeCode: code,
      outcomeDetail: detail,
      createdAt: now(),
    });
    return { outcome: "failed" as const, changeId, totalAfterMinor: null, code, detail };
  };

  // 2. Read the live campaigns of every account, outside any transaction.
  const readAt = now();
  const accounts = uniqueAccounts([
    { platform: command.platform, accountId: command.accountId },
    ...((await deps.accountsFor?.(companyId)) ?? []),
  ]);
  let currentTotalMinor = 0;
  let campaign: AdCampaignState | null = null;
  for (const account of accounts) {
    let listed: Result<AdCampaignState[]>;
    try {
      listed = requireTryCampaigns(
        await deps.adapterFor(account.platform).listCampaigns({ companyId, accountId: account.accountId }),
      );
    } catch (err) {
      listed = { ok: false, code: "platform_unreachable", message: errorText(err) };
    }
    if (!listed.ok) return failBeforeIntent(listed.code, listed.message);
    for (const c of listed.value) {
      if (c.status === "enabled") currentTotalMinor += c.dailyBudgetMinor;
      if (
        account.platform === command.platform &&
        account.accountId === command.accountId &&
        c.campaignId === command.campaignId
      ) {
        campaign = c;
      }
    }
  }
  if (!campaign) {
    return failBeforeIntent("no_such_campaign", `campaign ${command.campaignId} not found`);
  }

  const deltaMinor = budgetDelta(command, campaign);
  const expected = expectedValues(command, campaign);
  const base = { ...row(campaign, deltaMinor), beforeValue: expected.before, afterValue: expected.after };

  // 3. Cap check and intent row under the company's cap lock.
  type Locked = { done: ApplyAdChangeResult } | { done?: undefined; totalAfterMinor: number };
  const locked = await store.withCapLock<Locked>(companyId, async (tx) => {
    if (input.checkpointId) {
      const rows = await tx.findByCheckpoint(input.checkpointId, attempt!);
      const stored = rows.find((r) => r.phase === "result");
      if (stored) return { done: fromResultRow(stored) };
      if (rows.length > 0) throw new AdChangeInProgressError(input.checkpointId, attempt!);
    }
    const lockedAt = now();
    const cap = checkCap({
      currentTotalMinor,
      reservedMinor: await tx.reservedMinor({
        companyId,
        since: new Date(lockedAt.getTime() - RESERVATION_TTL_MS),
        appliedSince: readAt,
        excludeCheckpointId: input.checkpointId ?? null,
      }),
      deltaMinor,
      capMinor: await tx.loadCapMinor(companyId),
    });
    if (cap.ok && !writes) {
      return { done: { outcome: "allowed" as const, totalAfterMinor: cap.totalAfterMinor } };
    }
    await tx.insert({ ...base, phase: "intent", dailyTotalAfterMinor: cap.totalAfterMinor, createdAt: lockedAt });
    if (!cap.ok) {
      const detail = sanitizeDetail(
        cap.code === "cap_unset"
          ? "no daily ad cap is set; budget increases are refused"
          : `daily total would be ${cap.totalAfterMinor} minor units, over the cap`,
      );
      await tx.insert({
        ...base,
        phase: "result",
        dailyTotalAfterMinor: cap.totalAfterMinor,
        outcome: "rejected",
        outcomeCode: cap.code,
        outcomeDetail: detail,
        createdAt: lockedAt,
      });
      return {
        done: {
          outcome: "rejected" as const,
          changeId,
          totalAfterMinor: cap.totalAfterMinor,
          code: cap.code,
          detail,
        },
      };
    }
    return { totalAfterMinor: cap.totalAfterMinor };
  });
  if (locked.done) return locked.done;

  // 4. The platform call, outside the lock; the intent row is the reservation.
  let applied: Result<AdChangeApplied>;
  try {
    applied = await deps
      .adapterFor(command.platform)
      .applyChange({ companyId, accountId: command.accountId }, command);
  } catch (err) {
    applied = { ok: false, code: "platform_error", message: errorText(err) };
  }

  // 5. The result row.
  const resultBase = { ...base, phase: "result" as const, dailyTotalAfterMinor: locked.totalAfterMinor };
  if (!applied.ok) {
    const detail = sanitizeDetail(applied.message);
    await store.insert({
      ...resultBase,
      afterValue: null,
      outcome: "failed",
      outcomeCode: applied.code,
      outcomeDetail: detail,
      createdAt: now(),
    });
    return { outcome: "failed", changeId, totalAfterMinor: locked.totalAfterMinor, code: applied.code, detail };
  }
  await store.insert({
    ...resultBase,
    beforeValue: applied.value.before,
    afterValue: applied.value.after,
    outcome: "applied",
    createdAt: now(),
  });
  return {
    outcome: "applied",
    changeId,
    totalAfterMinor: locked.totalAfterMinor,
    beforeValue: applied.value.before,
    afterValue: applied.value.after,
  };
}

function uniqueAccounts(accounts: AdAccountRef[]): AdAccountRef[] {
  const seen = new Set<string>();
  return accounts.filter((a) => {
    const key = `${a.platform}:${a.accountId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What the change is expected to do; the result row carries what the platform reported. */
function expectedValues(command: AdChangeCommand, c: AdCampaignState): { before: unknown; after: unknown } {
  switch (command.action) {
    case "pause":
    case "resume":
      return {
        before: { status: c.status },
        after: { status: command.action === "pause" ? "paused" : "enabled" },
      };
    case "set_daily_budget":
      return { before: { dailyBudgetMinor: c.dailyBudgetMinor }, after: { dailyBudgetMinor: command.afterMinor } };
    case "add_keyword":
      return {
        before: null,
        after: { adGroupId: command.adGroupId, keyword: command.keyword, matchType: command.matchType },
      };
    case "add_negative_keyword":
      return { before: null, after: { keyword: command.keyword, matchType: command.matchType } };
    case "update_ad_copy":
      return {
        before: null,
        after: { adGroupId: command.adGroupId, headlines: command.headlines, descriptions: command.descriptions },
      };
  }
}

function fromResultRow(row: AdChangeLogRow): ApplyAdChangeResult {
  return {
    outcome: row.outcome ?? "failed",
    changeId: row.changeId,
    totalAfterMinor: row.dailyTotalAfterMinor,
    ...(row.outcomeCode ? { code: row.outcomeCode as AdChangeOutcomeCode } : {}),
    ...(row.outcomeDetail ? { detail: row.outcomeDetail } : {}),
    beforeValue: row.beforeValue,
    afterValue: row.afterValue,
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(bearer|basic)\s+\S+/gi, "$1 [redacted]"],
  [
    /\b(access[_-]?token|refresh[_-]?token|developer[_-]?token|client[_-]?secret|api[_-]?key|apikey|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    "$1$2[redacted]",
  ],
  [/\bya29\.[\w.-]+/g, "[redacted]"],
  [/[A-Za-z0-9_\-+/=]{40,}/g, "[redacted]"],
];

/** Platform error text for `outcome_detail`: secret-looking values removed, at most 300 chars. */
export function sanitizeDetail(message: string): string {
  let out = message.replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out.length > AD_CHANGE_DETAIL_MAX ? `${out.slice(0, AD_CHANGE_DETAIL_MAX - 1)}…` : out;
}

export type ReservationLogRow = Pick<
  AdChangeLogRow,
  "companyId" | "changeId" | "phase" | "outcome" | "deltaMinor" | "checkpointId" | "createdAt"
>;

export type ReservationCheckpoint = {
  id: string;
  companyId: string;
  status: string;
  payload: unknown;
  executeResult: unknown;
};

/**
 * The reservation rule `pgAdChangeStore.reservedMinor` runs in SQL, as a pure
 * function for store doubles: positive deltas of unresolved intents younger
 * than the TTL, of intents applied since the campaign read, and of approved
 * `ad_change` cards not yet applied (design 6.7), minus the card in hand.
 */
export function sumReservedMinor(
  scan: ReservationScan,
  log: ReservationLogRow[],
  checkpoints: ReservationCheckpoint[],
): number {
  const rows = log.filter((r) => r.companyId === scan.companyId);
  let reserved = 0;
  for (const intent of rows) {
    if (intent.phase !== "intent" || intent.deltaMinor <= 0) continue;
    const result = rows.find((r) => r.phase === "result" && r.changeId === intent.changeId);
    const unresolved = !result && intent.createdAt.getTime() >= scan.since.getTime();
    const appliedSinceRead =
      result?.outcome === "applied" && result.createdAt.getTime() >= scan.appliedSince.getTime();
    if (unresolved || appliedSinceRead) reserved += intent.deltaMinor;
  }
  for (const c of checkpoints) {
    const payload = c.payload as { kind?: unknown; deltaMinor?: unknown } | null;
    if (
      c.companyId !== scan.companyId ||
      c.id === scan.excludeCheckpointId ||
      c.status !== "approved" ||
      (c.executeResult !== null && c.executeResult !== undefined) ||
      payload?.kind !== "ad_change" ||
      typeof payload.deltaMinor !== "number" ||
      log.some((r) => r.checkpointId === c.id)
    ) {
      continue;
    }
    reserved += Math.max(Math.ceil(payload.deltaMinor), 0);
  }
  return reserved;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

function findByCheckpointIn(exec: Executor, checkpointId: string, attempt: number) {
  return exec
    .select()
    .from(adChangeLog)
    .where(and(eq(adChangeLog.checkpointId, checkpointId), eq(adChangeLog.attempt, attempt)));
}

function pgTx(tx: Tx): AdChangeStoreTx {
  return {
    async loadCapMinor(companyId) {
      const [row] = await tx
        .select({ cap: companies.adDailyCapMinor })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      return row?.cap ?? null;
    },
    async reservedMinor(scan) {
      // Reads checkpoints.payload by raw SQL: part b1 writes `kind` and
      // `deltaMinor`; no checkpoint payload type is imported here.
      const rows = await tx.execute<{ reserved: string | number }>(sql`
        select (
          coalesce((
            select sum(i.delta_minor)
            from ad_change_log i
            left join ad_change_log r on r.change_id = i.change_id and r.phase = 'result'
            where i.company_id = ${scan.companyId}
              and i.phase = 'intent'
              and i.delta_minor > 0
              and (
                (r.id is null and i.created_at >= ${scan.since.toISOString()}::timestamptz)
                or (r.outcome = 'applied' and r.created_at >= ${scan.appliedSince.toISOString()}::timestamptz)
              )
          ), 0)
          + coalesce((
            select sum(greatest(ceil((c.payload->>'deltaMinor')::numeric), 0))
            from checkpoints c
            where c.company_id = ${scan.companyId}
              and c.payload->>'kind' = 'ad_change'
              and jsonb_typeof(c.payload->'deltaMinor') = 'number'
              and c.status = 'approved'
              and (c.execute_result is null or c.execute_result = 'null'::jsonb)
              and not exists (select 1 from ad_change_log l where l.checkpoint_id = c.id)
              and (${scan.excludeCheckpointId}::uuid is null or c.id <> ${scan.excludeCheckpointId}::uuid)
          ), 0)
        )::bigint as reserved
      `);
      return Number(rows[0]?.reserved ?? 0);
    },
    findByCheckpoint: (checkpointId, attempt) => findByCheckpointIn(tx, checkpointId, attempt),
    async insert(row) {
      await tx.insert(adChangeLog).values(row);
    },
  };
}

export const pgAdChangeStore: AdChangeStore = {
  findByCheckpoint: (checkpointId, attempt) => findByCheckpointIn(db, checkpointId, attempt),
  async insert(row) {
    await db.insert(adChangeLog).values(row);
  },
  withCapLock(companyId, fn) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ad-cap:${companyId}`}))`);
      return fn(pgTx(tx));
    });
  },
};

const testAdapters = new Map<AdPlatform, AdPlatformAdapter>();

/**
 * The fake only under `NODE_ENV=test`. Anywhere else the manual adapter
 * (08b2): the company has no connected `google_ads`/`meta_ads` integration
 * row, because those integration types do not exist until RL9, which adds the
 * connected-row lookup and returns the API adapter for it. `command` is the
 * change in hand; the manual adapter knows its `observed` campaign.
 */
export function defaultAdapterFor(
  platform: AdPlatform,
  _companyId?: string,
  opts: { command?: AdChangeCommand } = {},
): AdPlatformAdapter {
  if (process.env.NODE_ENV === "test") {
    let adapter = testAdapters.get(platform);
    if (!adapter) {
      adapter = createFakeAdAdapter({ platform });
      testAdapters.set(platform, adapter);
    }
    return adapter;
  }
  return createManualAdAdapter({ platform, store: pgManualAdStore, command: opts.command });
}
