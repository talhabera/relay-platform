import { and, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { companyRecords, leadEvents } from "@/db/schema";
import { LEAD_KOD_KEY, type LeadReferral } from "@relay/db";

import type { WeekRange } from "./compute";

// Leads per ad campaign (lead scoring spec, decision 14). A lead's campaign is
// its Click-to-WhatsApp `referral` (keyed by ad id), else the manual campaign
// code `kod` from its intake. The cohort is leads captured in the range; a
// lead counts as qualified once it has ever reached `qualified` (fit >= 70,
// or a borderline lead a person accepted) before the range ends.

/** The columns of `company_records` campaign metrics read. */
export type CampaignLeadFact = {
  id: string;
  source: string | null;
  referral: LeadReferral | null;
  payload: Record<string, unknown>;
};

export type CampaignAttribution = {
  /** Stable key: `ad:<sourceId>`, `url:<sourceUrl>` or `kod:<code, lower-cased>`. */
  id: string;
  kind: "ad" | "kod";
  name: string;
};

export type CampaignMetric = CampaignAttribution & {
  /** The most common lead source in the campaign (e.g. `whatsapp`). */
  source: string | null;
  leads: number;
  qualified: number;
};

const clean = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

function kodOf(payload: Record<string, unknown>): string | null {
  const intake = payload.intake;
  if (!intake || typeof intake !== "object" || Array.isArray(intake)) return null;
  return clean((intake as Record<string, unknown>)[LEAD_KOD_KEY]);
}

/** The campaign a lead is credited to, or null when it carries no attribution. */
export function campaignOf(lead: Pick<CampaignLeadFact, "referral" | "payload">): CampaignAttribution | null {
  const ref = lead.referral;
  const headline = clean(ref?.headline);
  const adId = clean(ref?.sourceId);
  if (adId) return { id: `ad:${adId}`, kind: "ad", name: headline ?? `Ad ${adId}` };
  const url = clean(ref?.sourceUrl);
  if (url) return { id: `url:${url}`, kind: "ad", name: headline ?? url };
  const kod = kodOf(lead.payload);
  if (kod) return { id: `kod:${kod.toLowerCase()}`, kind: "kod", name: `Code ${kod}` };
  return null;
}

/** Leads and qualified leads per campaign, most leads first (ties by name). */
export function campaignMetrics(
  leads: readonly CampaignLeadFact[],
  qualifiedIds: ReadonlySet<string>,
): CampaignMetric[] {
  const byId = new Map<string, CampaignMetric & { sources: Map<string, number> }>();
  for (const lead of leads) {
    const campaign = campaignOf(lead);
    if (!campaign) continue;
    let entry = byId.get(campaign.id);
    if (!entry) {
      entry = { ...campaign, source: null, leads: 0, qualified: 0, sources: new Map() };
      byId.set(campaign.id, entry);
    }
    entry.leads += 1;
    if (qualifiedIds.has(lead.id)) entry.qualified += 1;
    if (lead.source) entry.sources.set(lead.source, (entry.sources.get(lead.source) ?? 0) + 1);
  }
  return [...byId.values()]
    .map(({ sources, ...metric }) => {
      let best: string | null = null;
      let bestCount = 0;
      for (const [source, n] of sources) {
        if (n > bestCount) {
          best = source;
          bestCount = n;
        }
      }
      return { ...metric, source: best };
    })
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

const kodPath = sql`${companyRecords.payload} -> 'intake' ->> ${LEAD_KOD_KEY}`;

/** Leads captured in `range` that carry a campaign attribution. */
export async function loadCampaignLeads(
  companyId: string,
  range: WeekRange,
): Promise<CampaignLeadFact[]> {
  const rows = await db.query.companyRecords.findMany({
    columns: { id: true, source: true, referral: true, payload: true },
    where: and(
      eq(companyRecords.companyId, companyId),
      gte(companyRecords.createdAt, range.from),
      lt(companyRecords.createdAt, range.to),
      or(isNotNull(companyRecords.referral), isNotNull(kodPath)),
    ),
  });
  return rows.map((r) => ({ ...r, referral: r.referral ?? null }));
}

/** Of `recordIds`, those that reached `qualified` before `before`. */
export async function loadQualifiedIds(
  companyId: string,
  recordIds: readonly string[],
  before: Date,
): Promise<Set<string>> {
  if (recordIds.length === 0) return new Set();
  const rows = await db.query.leadEvents.findMany({
    columns: { recordId: true },
    where: and(
      eq(leadEvents.companyId, companyId),
      inArray(leadEvents.recordId, [...recordIds]),
      eq(leadEvents.toStatus, "qualified"),
      lt(leadEvents.at, before),
    ),
  });
  return new Set(rows.map((r) => r.recordId));
}

/** Campaign metrics for the leads a company captured in `range`. */
export async function getCampaignMetrics(
  companyId: string,
  range: WeekRange,
): Promise<CampaignMetric[]> {
  const leads = await loadCampaignLeads(companyId, range);
  const campaigned = leads.filter((l) => campaignOf(l) !== null);
  const qualified = await loadQualifiedIds(
    companyId,
    campaigned.map((l) => l.id),
    range.to,
  );
  return campaignMetrics(campaigned, qualified);
}
