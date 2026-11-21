// Pure counting over the lead event log (lead attribution spec). The loaders
// in `./source.ts` fetch rows; everything that decides what counts lives here
// so it is testable without a database. All ranges are half-open `[from, to)`
// UTC instants cut by `isoWeekRange` in company time.

export type WeekRange = { from: Date; to: Date };

/** The columns of `lead_events` the metrics read. */
export type LeadEventFact = {
  recordId: string;
  fromStatus: string | null;
  toStatus: string;
  agentId: string | null;
  userId: string | null;
  at: Date;
};

/**
 * Lead statuses per stage bucket. Lists both today's vocabulary and the one
 * S26 introduces (`gathered`, `contacted`, `delivered`; post-reply
 * `qualified` -> `interested`), so the metrics keep counting across the rename.
 */
export const LEAD_STATUS_BUCKETS = {
  gathered: ["gathered"],
  qualified: ["qualified"],
  contactedReplied: ["contacted", "outreach_approved", "replied"],
  delivered: ["delivered"],
} as const satisfies Record<string, readonly string[]>;

const has = (list: readonly string[], status: string) => list.includes(status);

export function inRange(at: Date, range: WeekRange): boolean {
  const t = at.getTime();
  return t >= range.from.getTime() && t < range.to.getTime();
}

/** A lead created by a customer agent (`record_lead`): inbound (decision 2). */
export function isInboundEvent(
  e: LeadEventFact,
  customerAgentIds: ReadonlySet<string>,
): boolean {
  return e.fromStatus === null && e.agentId !== null && customerAgentIds.has(e.agentId);
}

/**
 * Gathered: an explicit move to `gathered`, or the creation of a lead by
 * anyone but a customer agent (today's gatherer creates rows as `pending`).
 */
export function isGatheredEvent(
  e: LeadEventFact,
  customerAgentIds: ReadonlySet<string>,
): boolean {
  if (has(LEAD_STATUS_BUCKETS.gathered, e.toStatus)) return true;
  return e.fromStatus === null && !isInboundEvent(e, customerAgentIds);
}

/**
 * Leads first delivered inside `range` (decisions 3 and 7: a lead counts once,
 * on its first delivery). `events` must hold every delivered event of the
 * company before `range.to`, so an earlier delivery rules a lead out.
 */
export function firstDeliveredInRange(
  events: readonly LeadEventFact[],
  range: WeekRange,
): Map<string, LeadEventFact> {
  const first = new Map<string, LeadEventFact>();
  for (const e of events) {
    if (!has(LEAD_STATUS_BUCKETS.delivered, e.toStatus)) continue;
    if (e.at.getTime() >= range.to.getTime()) continue;
    const seen = first.get(e.recordId);
    if (!seen || e.at.getTime() < seen.at.getTime()) first.set(e.recordId, e);
  }
  for (const [id, e] of first) if (!inRange(e.at, range)) first.delete(id);
  return first;
}

export type LeadCounts = {
  gathered: number;
  qualified: number;
  contactedReplied: number;
  /** Qualified leads first delivered this week: the weekly target. */
  delivered: number;
  inbound: number;
  deliveredRecordIds: string[];
};

/** Distinct leads per bucket in `range`. */
export function countLeadMetrics(
  events: readonly LeadEventFact[],
  range: WeekRange,
  customerAgentIds: ReadonlySet<string>,
): LeadCounts {
  const gathered = new Set<string>();
  const qualified = new Set<string>();
  const contacted = new Set<string>();
  const inbound = new Set<string>();
  for (const e of events) {
    if (!inRange(e.at, range)) continue;
    if (isInboundEvent(e, customerAgentIds)) inbound.add(e.recordId);
    if (isGatheredEvent(e, customerAgentIds)) gathered.add(e.recordId);
    if (has(LEAD_STATUS_BUCKETS.qualified, e.toStatus)) qualified.add(e.recordId);
    if (has(LEAD_STATUS_BUCKETS.contactedReplied, e.toStatus)) contacted.add(e.recordId);
  }
  const delivered = firstDeliveredInRange(events, range);
  return {
    gathered: gathered.size,
    qualified: qualified.size,
    contactedReplied: contacted.size,
    delivered: delivered.size,
    inbound: inbound.size,
    deliveredRecordIds: [...delivered.keys()],
  };
}

/**
 * Lead quality score: average fit score of the leads delivered in the period,
 * rounded (lead scoring spec, decision 5). Unscored leads are left out; null
 * when nothing scored was delivered.
 */
export function leadQualityScore(
  deliveredRecordIds: readonly string[],
  scores: ReadonlyMap<string, number | null>,
): number | null {
  const values = deliveredRecordIds
    .map((id) => scores.get(id))
    .filter((s): s is number => typeof s === "number");
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Leads per agent: distinct leads each agent moved in `range` (decision 2). */
export function leadsPerAgent(
  events: readonly LeadEventFact[],
  range: WeekRange,
): Map<string, number> {
  const byAgent = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.agentId || !inRange(e.at, range)) continue;
    let set = byAgent.get(e.agentId);
    if (!set) byAgent.set(e.agentId, (set = new Set()));
    set.add(e.recordId);
  }
  return new Map([...byAgent].map(([id, set]) => [id, set.size]));
}

/**
 * Blended Anthropic price used for the estimate, USD per million tokens.
 * `token_usage` stores totals without the input/output split, so the cost is
 * an estimate, shown as such.
 */
export const ESTIMATED_USD_PER_MILLION_TOKENS = 6;

export type CostPerQualifiedLead = {
  tokens: number;
  tokensPerLead: number;
  estimatedUsdPerLead: number;
};

/** Null when no qualified lead was delivered: there is nothing to divide by. */
export function costPerQualifiedLead(
  tokens: number,
  delivered: number,
): CostPerQualifiedLead | null {
  if (delivered <= 0) return null;
  const tokensPerLead = Math.round(tokens / delivered);
  const usd = (tokens / 1_000_000) * ESTIMATED_USD_PER_MILLION_TOKENS / delivered;
  return {
    tokens,
    tokensPerLead,
    estimatedUsdPerLead: Math.round(usd * 100) / 100,
  };
}
