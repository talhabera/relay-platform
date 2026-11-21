import { and, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { adClicks, adMetaMappings, adSpendDaily, companies, companyRecords, leadEvents } from "@/db/schema";
import { localDateLabel } from "@relay/db/report-snapshots";
import { readLeadPayments } from "@/lib/leads/payments";
import { localDayRange } from "@/lib/time";

import {
  adReportWindow,
  buildAdReport,
  hasAdData,
  type AdLeadRow,
  type AdReportModel,
  type AdSettings,
  type AdStageEvent,
} from "./ad-report-model";

// Reads for the Koleva reklam Home tile (RL6). Read only, one round of
// parallel queries, every query scoped by `company_id` and bounded by
// company-local day bounds. The pure model does the rest.

const FUNNEL_STATUSES = ["qualified", "meeting", "proposal", "won"] as const;

/** UTC start of a company-local day label (DST safe via `localDayRange`). */
function localDayStart(label: string, timeZone: string): Date {
  return localDayRange(new Date(`${label}T12:00:00Z`), timeZone).from;
}

export async function loadAdReport(args: {
  companyId: string;
  now: Date;
  timeZone: string;
}): Promise<AdReportModel | null> {
  const { companyId, now, timeZone } = args;
  const today = localDateLabel(now, timeZone);
  const { monthStart, windowStart, leadSince } = adReportWindow(today);
  const todayEnd = localDayRange(now, timeZone).to;
  const eventsFrom = localDayStart(windowStart, timeZone);
  const leadsFrom = localDayStart(leadSince, timeZone);

  const eventScope = and(
    eq(leadEvents.companyId, companyId),
    gte(leadEvents.at, eventsFrom),
    lt(leadEvents.at, todayEnd),
    inArray(leadEvents.toStatus, [...FUNNEL_STATUSES]),
  );

  const [settingsRows, spendRows, eventRows, recordRows, mappingRows] = await Promise.all([
    db
      .select({
        monthlyTargetMinor: companies.adMonthlyTargetMinor,
        cplStopMinor: companies.adCplStopMinor,
        dailyCapMinor: companies.adDailyCapMinor,
        capacitySiteMonthly: companies.adCapacitySiteMonthly,
        capacitySocialMonthly: companies.adCapacitySocialMonthly,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1),
    db
      .select({
        spendDate: adSpendDaily.spendDate,
        channel: adSpendDaily.channel,
        campaignId: adSpendDaily.campaignId,
        campaignName: adSpendDaily.campaignName,
        amountMinor: adSpendDaily.amountMinor,
        complete: adSpendDaily.complete,
      })
      .from(adSpendDaily)
      .where(
        and(
          eq(adSpendDaily.companyId, companyId),
          gte(adSpendDaily.spendDate, windowStart),
          lte(adSpendDaily.spendDate, today),
        ),
      ),
    db
      .select({
        recordId: leadEvents.recordId,
        fromStatus: leadEvents.fromStatus,
        toStatus: leadEvents.toStatus,
        at: leadEvents.at,
      })
      .from(leadEvents)
      .where(eventScope),
    // Leads created in the window, every won record (payments can land months
    // after the sale) and every record with a funnel event in the window.
    db
      .select({
        id: companyRecords.id,
        createdAt: companyRecords.createdAt,
        status: companyRecords.status,
        salePackage: companyRecords.salePackage,
        saleAmountMinor: companyRecords.saleAmountMinor,
        referral: companyRecords.referral,
        kod: sql<string | null>`${companyRecords.payload} #>> '{intake,kod}'`,
        firstResponseMs: sql<number | null>`(${companyRecords.payload} #>> '{firstResponse,ms}')::double precision`,
        payments: sql<unknown>`${companyRecords.payload} -> 'payments'`,
        clickChannel: adClicks.channel,
      })
      .from(companyRecords)
      .leftJoin(
        adClicks,
        and(eq(adClicks.linkedRecordId, companyRecords.id), eq(adClicks.companyId, companyId)),
      )
      .where(
        and(
          eq(companyRecords.companyId, companyId),
          or(
            and(gte(companyRecords.createdAt, leadsFrom), lt(companyRecords.createdAt, todayEnd)),
            eq(companyRecords.status, "won"),
            inArray(
              companyRecords.id,
              db.select({ id: leadEvents.recordId }).from(leadEvents).where(eventScope),
            ),
          ),
        ),
      ),
    db
      .select({
        sourceId: adMetaMappings.sourceId,
        code: adMetaMappings.code,
        campaignName: adMetaMappings.campaignName,
      })
      .from(adMetaMappings)
      .where(eq(adMetaMappings.companyId, companyId)),
  ]);

  const settings: AdSettings = settingsRows[0] ?? {
    monthlyTargetMinor: null,
    cplStopMinor: null,
    dailyCapMinor: null,
    capacitySiteMonthly: null,
    capacitySocialMonthly: null,
  };

  const leads: AdLeadRow[] = recordRows.map((r) => {
    const ms = r.firstResponseMs === null ? null : Number(r.firstResponseMs);
    return {
      id: r.id,
      createdOn: localDateLabel(r.createdAt, timeZone),
      payloadKod: r.kod,
      hasReferral: r.referral !== null && typeof r.referral === "object",
      referralSourceId: typeof r.referral?.sourceId === "string" ? r.referral.sourceId : null,
      linkedClickChannel: r.clickChannel ?? null,
      status: r.status,
      salePackage: r.salePackage,
      saleAmountMinor: r.saleAmountMinor,
      firstResponseMs: ms !== null && Number.isFinite(ms) ? ms : null,
      payments: r.status === "won" ? readLeadPayments({ payments: r.payments }) : [],
    };
  });

  const events: AdStageEvent[] = eventRows.map((e) => ({
    recordId: e.recordId,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    on: localDateLabel(e.at, timeZone),
  }));

  const input = { spend: spendRows, leads, events, mappings: mappingRows, settings, today, timeZone, monthStart };
  return hasAdData(input) ? buildAdReport(input) : null;
}
