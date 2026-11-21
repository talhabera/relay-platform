// Leads work pane (05 session-leads/*): pure model, client-safe. The server
// loads `SessionLeadRecord`s (`lib/leads/session-leads.ts`); everything the
// pane shows is derived here so it can be tested without a DB or a DOM.

import type { KolevaFunnelStatus, SalePackage } from "@relay/db";
import type { LeadPayment, LeadPaymentKind } from "@/lib/leads/payments";

/** Pane tabs (Segmented): Qualified, Borderline, Excluded. */
export const SESSION_LEAD_TABS = ["qualified", "borderline", "excluded"] as const;
export type SessionLeadTab = (typeof SESSION_LEAD_TABS)[number];

/** Rows per page (05 session-leads/default: "Showing 1-5 of 44 leads"). */
export const LEADS_PAGE_SIZE = 5;

/**
 * The pane lists at most this many leads per tab; the CSV export is uncapped
 * (it is what gets billed, so it must not inherit the page's window).
 */
export const SESSION_LEAD_LIST_LIMIT = 500;

/** Statuses on the Excluded tab: a lead a person or the agent took out. */
export const EXCLUDED_LEAD_STATUSES = ["rejected", "unqualified"] as const;

/** One lead as the pane receives it (serializable: dates as ISO strings). */
export type SessionLeadRecord = {
  id: string;
  entityType: "account" | "person";
  name: string;
  domain: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  fitScore: number | null;
  reasons: string[];
  rejectReason: string | null;
  /** Contact found by research (`payload.contact`), outbound accounts only. */
  contact: { name: string; role: string | null } | null;
  /** City or area (`payload.city`, or the intake `lokasyon`). */
  location: string | null;
  /** What was sold; set once the lead is `won`, kept if it leaves `won`. */
  salePackage?: SalePackage | null;
  /** Signed amount, TRY minor units, KDV hariç. */
  saleAmountMinor?: number | null;
  /** Payments received on a won lead (`payload.payments`), oldest first. */
  payments?: LeadPayment[];
  /** Sum of `payments`, minor units. */
  paidMinor?: number;
  /** Payment kinds the lead's package allows. */
  paymentKinds?: LeadPaymentKind[];
};

/**
 * Which tab a lead sits on. Qualified means it reached `qualified` (fit >= 70,
 * or a borderline lead a person accepted; the event log says so) and nobody
 * excluded it since. Leads still being gathered or researched sit on no tab.
 */
export function sessionLeadTab(status: string, everQualified: boolean): SessionLeadTab | null {
  if ((EXCLUDED_LEAD_STATUSES as readonly string[]).includes(status)) return "excluded";
  if (status === "borderline") return "borderline";
  return everQualified ? "qualified" : null;
}

export function parseSessionLeadTab(value: string | null | undefined): SessionLeadTab | null {
  return SESSION_LEAD_TABS.find((tab) => tab === value) ?? null;
}

export type SessionLeadCounts = Record<SessionLeadTab, number> & {
  /** Outbound leads (research) in the window. */
  gathered: number;
  /** Leads from customer conversations in the window. */
  inbound: number;
};

/**
 * Tab the pane opens on. With an open agent question and borderline leads
 * (05 session-leads/agent-question) it opens on Borderline, where the
 * question's leads are.
 */
export function initialLeadTab(counts: SessionLeadCounts, openQuestion: boolean): SessionLeadTab {
  if (openQuestion && counts.borderline > 0) return "borderline";
  if (counts.qualified > 0 || counts.borderline === 0) return "qualified";
  return "borderline";
}

const TAB_TITLE: Record<SessionLeadTab, string> = {
  qualified: "Qualified leads",
  borderline: "Borderline leads",
  excluded: "Excluded leads",
};

export function leadPaneTitle(tab: SessionLeadTab): string {
  return TAB_TITLE[tab];
}

/** "Week 39 · 21–27 Sep 2026 · 146 gathered, 9 inbound". */
export function leadPaneSubtitle(args: {
  weekId: string;
  rangeLabel: string;
  counts: Pick<SessionLeadCounts, "gathered" | "inbound">;
}): string {
  const week = Number(args.weekId.split("-W")[1]);
  const weekLabel = Number.isFinite(week) ? `Week ${week}` : args.weekId;
  return `${weekLabel} · ${args.rangeLabel} · ${args.counts.gathered} gathered, ${args.counts.inbound} inbound`;
}

export type LeadPage<T> = {
  rows: T[];
  /** 1-based, clamped to `1..pageCount`. */
  page: number;
  pageCount: number;
  /** 1-based index of the first row shown; 0 when empty. */
  first: number;
  last: number;
  total: number;
};

export function paginateLeads<T>(rows: readonly T[], page: number, size = LEADS_PAGE_SIZE): LeadPage<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pageCount,
    first: slice.length ? start + 1 : 0,
    last: start + slice.length,
    total,
  };
}

const NOUN: Record<SessionLeadTab, [string, string]> = {
  qualified: ["lead", "leads"],
  borderline: ["borderline lead", "borderline leads"],
  excluded: ["excluded lead", "excluded leads"],
};

/**
 * "Showing 1–5 of 44 leads", "Showing 1 of 1 borderline lead". `total` is the
 * tab's full count, which can exceed the listed rows when the list is capped.
 */
export function showingLabel(tab: SessionLeadTab, page: LeadPage<unknown>, total: number): string {
  const [one, many] = NOUN[tab];
  const noun = total === 1 ? one : many;
  if (page.total === 0) return `No ${many}`;
  const span = page.first === page.last ? `${page.first}` : `${page.first}–${page.last}`;
  return `Showing ${span} of ${total} ${noun}`;
}

/** Shown under the list when a tab holds more leads than the pane lists. */
export function cappedNote(total: number, listed: number): string | null {
  if (total <= listed) return null;
  return `The list shows the first ${listed}. Export CSV includes all ${total}.`;
}

const SOURCE_LABEL: Record<string, string> = {
  outbound: "Outbound",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  widget: "Widget",
  shopify: "Shopify",
  telegram: "Telegram",
  messenger: "Messenger",
};

export type LeadRowView = {
  company: string;
  companyMeta?: string;
  contactName: string | null;
  contactMeta?: string;
  fitScore: number | null;
  reasons: string[];
  borderline: boolean;
};

/**
 * Lead row cells. Outbound accounts: company + domain/city, contact found by
 * research ("Not found" otherwise). Inbound people: name + channel/area,
 * phone as the contact.
 */
export function leadRowView(lead: SessionLeadRecord): LeadRowView {
  const inbound = lead.entityType === "person" || (lead.source !== null && lead.source !== "outbound");
  const reasons =
    lead.status === "rejected" || lead.status === "unqualified"
      ? [lead.rejectReason ?? lead.reasons[0]].filter((r): r is string => Boolean(r))
      : lead.reasons.slice(0, 3);
  const base = {
    company: lead.name.trim() || "Unnamed lead",
    fitScore: lead.fitScore,
    reasons,
    borderline: lead.status === "borderline",
  };
  if (inbound) {
    const channel = lead.source ? (SOURCE_LABEL[lead.source] ?? lead.source) : "Inbound";
    return {
      ...base,
      companyMeta: [channel, lead.location].filter(Boolean).join(" · "),
      contactName: lead.phone,
      contactMeta: lead.phone ? "Phone" : "No phone yet",
    };
  }
  return {
    ...base,
    companyMeta: [lead.location, lead.domain].filter(Boolean).join(" · ") || undefined,
    contactName: lead.contact?.name ?? null,
    contactMeta: lead.contact ? (lead.contact.role ?? undefined) : "No decision maker yet",
  };
}

export type LeadAction = "accept" | "reject" | "exclude";

/** Row menu actions: Accept/Reject a borderline lead, Exclude a qualified one. */
export function leadActionsFor(tab: SessionLeadTab): LeadAction[] {
  if (tab === "borderline") return ["accept", "reject"];
  if (tab === "qualified") return ["exclude"];
  return [];
}

export const LEAD_ACTION_LABEL: Record<LeadAction, string> = {
  accept: "Accept",
  reject: "Reject",
  exclude: "Exclude",
};

/** CSV export link for a tab of a session's pane. */
export function leadsExportHref(chatId: string, tab: SessionLeadTab): string {
  return `/api/operator/sessions/${chatId}/leads/export?tab=${tab}`;
}

/**
 * The Koleva funnel in picker order. Mirrors `KOLEVA_FUNNEL_STATUSES` from
 * `@relay/db` (a test keeps them equal); copied because this module is
 * client-safe and the db package is not.
 */
export const FUNNEL_STATUSES = [
  "gathered",
  "qualified",
  "meeting",
  "proposal",
  "won",
  "unqualified",
  "rejected",
] as const satisfies readonly KolevaFunnelStatus[];

export const FUNNEL_STATUS_LABEL: Record<KolevaFunnelStatus, string> = {
  gathered: "Yeni",
  qualified: "Nitelikli",
  meeting: "Görüşme",
  proposal: "Teklif",
  won: "Satış",
  unqualified: "Kaybedildi",
  rejected: "Uygun değil",
};

export function isFunnelStatus(status: string): status is KolevaFunnelStatus {
  return (FUNNEL_STATUSES as readonly string[]).includes(status);
}

export const SALE_PACKAGE_LABEL: Record<SalePackage, string> = {
  website: "Web sitesi",
  social: "Sosyal medya",
};

export const PAYMENT_KIND_LABEL: Record<LeadPaymentKind, string> = {
  deposit: "Peşinat",
  balance: "Teslim ödemesi",
  setup: "Kurulum",
  monthly: "Aylık",
};

/** "80.000 TL", "25.000,50 TL": Turkish grouping, kuruş only when present. */
export function formatTryMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minor));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const kurus = abs % 100;
  return `${sign}${whole}${kurus ? `,${String(kurus).padStart(2, "0")}` : ""} TL`;
}

const GROUPED = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/;
const PLAIN = /^\d+(?:,\d{1,2})?$/;

/**
 * A TL amount typed the Turkish way (thousands dot, decimal comma) to minor
 * units. Null when malformed or not positive.
 */
export function parseTryAmount(text: string): number | null {
  const value = text.replace(/\s+/g, "").replace(/TL$/i, "");
  if (!GROUPED.test(value) && !PLAIN.test(value)) return null;
  const [whole, fraction = ""] = value.replace(/\./g, "").split(",");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/**
 * Funnel label of a lead row: "Teklif", "Satış, Web sitesi, 80.000 TL,
 * tahsil edilen 40.000 TL". Null for statuses outside the funnel.
 */
export function leadStatusLabel(lead: SessionLeadRecord): string | null {
  if (!isFunnelStatus(lead.status)) return null;
  const label = FUNNEL_STATUS_LABEL[lead.status];
  if (lead.status !== "won") return label;
  const parts = [label];
  if (lead.salePackage) parts.push(SALE_PACKAGE_LABEL[lead.salePackage]);
  if (lead.saleAmountMinor) parts.push(formatTryMinor(lead.saleAmountMinor));
  if (lead.paidMinor) parts.push(`tahsil edilen ${formatTryMinor(lead.paidMinor)}`);
  return parts.join(", ");
}
