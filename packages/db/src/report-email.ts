import { inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  reportEmailDeliveries,
  type ReportEmailStatus,
} from "./schema/report-email-deliveries";
import type { ReportPeriod } from "./schema/report-snapshots";

// Daily report email (S71 render, Figma 11a `11/reports/email-daily`; moved
// here by S88 so the cron worker can send it, web re-exports it from
// `lib/reports/email-daily.ts`). Pure render: snapshot in, { subject, html,
// text } out. Cards follow the portal: a metric without a data source is left
// out, never shown empty. Styles are inline hex (email clients ignore CSS
// variables); values mirror the light tokens in apps/web globals.css.

const C = {
  page: "#f7f8fa", // --slate-50
  card: "#ffffff",
  border: "#dde1e8", // --slate-200
  text: "#151b25", // --slate-900
  muted: "#4a5769", // --slate-600
  primary: "#147f6b", // --teal-600
  onPrimary: "#ffffff",
};

const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The snapshot fields the email reads (web's `ReportSnapshot` fits). */
export type ReportEmailSnapshot = {
  period: ReportPeriod;
  start: Date;
  end: Date;
  metrics: { metricKey: string; value: number }[];
};

export type DailyReportEmailInput = {
  snapshot: ReportEmailSnapshot;
  /** Company IANA zone (already resolved with `reportTimeZone`). */
  timeZone: string;
  companyName: string;
  /** Recipient display name; the greeting uses the first word. */
  recipientName: string | null;
  /** Absolute portal URL of this report (http/https). */
  reportUrl: string;
  /** Absolute URL of the recipient's notification settings (opt-out, S88/S107). */
  preferencesUrl?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

const number = new Intl.NumberFormat("en-GB");

/** Daily headline cards in Figma order; same labels as web `lib/reports/view.ts`. */
const DAILY_HEADLINE: { metricKey: string; label: string }[] = [
  { metricKey: "conversations.started", label: "Conversations" },
  { metricKey: "leads.inbound", label: "Inbound leads" },
  { metricKey: "leads.qualified_delivered", label: "Qualified leads delivered" },
  { metricKey: "handoff.staff_answers", label: "Staff answers" },
];

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) URLs are linked; anything else becomes inert. */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function dayParts(at: Date, timeZone: string, weekday: "long" | "short") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: read("weekday"), day: read("day"), month: read("month"), year: read("year") };
}

/** "Thursday 24 Sep 2026" in company time. */
function longDayLabel(at: Date, timeZone: string): string {
  const p = dayParts(at, timeZone, "long");
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** "Thu 24 Sep" in company time (web view's daily `shortRangeLabel`). */
function shortDayLabel(at: Date, timeZone: string): string {
  const p = dayParts(at, timeZone, "short");
  return `${p.weekday} ${p.day} ${p.month}`;
}

const plural = (n: number, one: string, many: string) => `${number.format(n)} ${n === 1 ? one : many}`;

function greeting(snapshot: ReportEmailSnapshot, companyName: string, recipientName: string | null): string {
  const first = recipientName?.trim().split(/\s+/)[0];
  const hello = first ? `Good morning, ${first}.` : "Good morning.";
  const value = (key: string) => snapshot.metrics.find((m) => m.metricKey === key)?.value;
  const conversations = value("conversations.started");
  const delivered = value("leads.qualified_delivered");
  const clauses: string[] = [];
  if (conversations !== undefined) clauses.push(`handled ${plural(conversations, "conversation", "conversations")} yesterday`);
  if (delivered !== undefined) {
    clauses.push(`delivered ${plural(delivered, "qualified lead", "qualified leads")}${conversations === undefined ? " yesterday" : ""}`);
  }
  if (clauses.length === 0) return `${hello} Your daily report for ${companyName} is ready.`;
  return `${hello} Your agents ${clauses.join(" and ")}.`;
}

export function renderDailyReportEmail(input: DailyReportEmailInput): RenderedEmail {
  const { snapshot, timeZone, companyName, recipientName } = input;
  if (snapshot.period !== "daily") {
    throw new Error(`renderDailyReportEmail needs a daily snapshot, got ${snapshot.period}`);
  }
  const values = new Map(snapshot.metrics.map((m) => [m.metricKey, m.value]));
  const headline = DAILY_HEADLINE.flatMap(({ metricKey, label }) => {
    const value = values.get(metricKey);
    return value === undefined ? [] : [{ label, value: number.format(value) }];
  });
  const reportUrl = safeUrl(input.reportUrl);
  const preferencesUrl = safeUrl(input.preferencesUrl);
  const day = longDayLabel(snapshot.start, timeZone);
  const intro = greeting(snapshot, companyName, recipientName);
  const subject = `${companyName} · Daily report · ${shortDayLabel(snapshot.start, timeZone)}`;
  const footer = `You get this email because your agency sends ${companyName} a daily report.`;
  const e = escapeHtml;

  const cardCell = (label: string, value: string) => `
<td width="50%" valign="top" style="padding:8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:12px;background:${C.card};">
    <tr><td style="padding:20px;">
      <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${e(label)}</div>
      <div style="font-size:32px;line-height:40px;font-weight:600;color:${C.text};padding-top:6px;">${e(value)}</div>
    </td></tr>
  </table>
</td>`;
  const rows: string[] = [];
  for (let i = 0; i < headline.length; i += 2) {
    const pair = headline.slice(i, i + 2).map((c) => cardCell(c.label, c.value));
    if (pair.length === 1) pair.push('<td width="50%" style="padding:8px;"></td>');
    rows.push(`<tr>${pair.join("")}</tr>`);
  }
  const cards = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${rows.join("")}</table>`
    : "";

  const button = reportUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
  <td style="border-radius:8px;background:${C.primary};"><a href="${e(reportUrl)}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:600;color:${C.onPrimary};text-decoration:none;">Open full report</a></td>
  <td style="padding-left:16px;font-size:14px;color:${C.muted};">Opens the report in your client portal.</td>
</tr></table>`
    : "";

  const optOut = preferencesUrl
    ? ` <a href="${e(preferencesUrl)}" style="color:${C.muted};text-decoration:underline;">Manage email notifications</a>.`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};font-family:${FONT};color:${C.text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${C.card};border:1px solid ${C.border};border-radius:16px;">
  <tr><td style="padding:32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:18px;font-weight:600;color:${C.text};">Relay</td>
      <td align="right" style="font-size:13px;color:${C.muted};">${e(companyName)}</td>
    </tr></table>
    <div style="padding-top:24px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">Daily report</div>
    <h1 style="margin:6px 0 0 0;font-size:24px;line-height:32px;font-weight:600;color:${C.text};">${e(day)}</h1>
    <p style="margin:12px 0 0 0;font-size:15px;line-height:22px;color:${C.text};">${e(intro)}</p>
    ${cards}
    ${button}
    <hr style="border:none;border-top:1px solid ${C.border};margin:24px 0 16px 0;">
    <p style="margin:0;font-size:12px;line-height:18px;color:${C.muted};">${e(footer)}${optOut}</p>
  </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `${companyName} · Daily report`,
    day,
    "",
    intro,
    "",
    ...headline.map((c) => `${c.label}: ${c.value}`),
    ...(reportUrl ? ["", `Open full report: ${reportUrl}`] : []),
    "",
    footer,
    ...(preferencesUrl ? [`Manage email notifications: ${preferencesUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}

const MAX_SUBJECT_CHARS = 200;
/** RFC 2047: an encoded-word is at most 75 characters. */
const MAX_ENCODED_WORD = 75;

/**
 * A mail Subject header value. CR, LF and other control characters (header
 * injection, broken folding) collapse to one space; the result is capped.
 * Pure ASCII passes through; anything else (company names, the "·" in the
 * report subject) becomes RFC 2047 UTF-8 base64 encoded-words, split on
 * character boundaries so no word exceeds 75 characters.
 */
export function encodeMailSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = Array.from(subject.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, MAX_SUBJECT_CHARS)
    .join("");
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const prefix = "=?UTF-8?B?";
  const suffix = "?=";
  // base64 of n bytes is 4*ceil(n/3) chars; 75 - 12 = 63 -> at most 45 bytes.
  const maxBytes = Math.floor((MAX_ENCODED_WORD - prefix.length - suffix.length) / 4) * 3;
  const words: string[] = [];
  let chunk = "";
  for (const char of clean) {
    if (Buffer.byteLength(chunk + char, "utf8") > maxBytes) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words
    .map((w) => `${prefix}${Buffer.from(w, "utf8").toString("base64")}${suffix}`)
    .join(" ");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = PgDatabase<PgQueryResultHKT, any, any>;

/** Archive summary of one snapshot's report email (Emailed / Delivered, Sent-to). */
export type ReportEmailSummary = {
  /** `delivered` once any recipient is delivered, else `emailed` once any was sent. */
  status: "delivered" | "emailed" | "failed" | "pending";
  sentTo: string[];
  sentAt: Date | null;
};

const SENT_STATUSES: ReadonlySet<ReportEmailStatus> = new Set<ReportEmailStatus>([
  "sent",
  "delivered",
  "bounced",
]);

export function summarizeReportEmail(
  rows: { email: string; status: ReportEmailStatus; sentAt: Date | null }[],
): ReportEmailSummary | null {
  if (rows.length === 0) return null;
  const sent = rows.filter((r) => SENT_STATUSES.has(r.status));
  const sentAt = sent.reduce<Date | null>(
    (latest, r) => (r.sentAt && (!latest || r.sentAt > latest) ? r.sentAt : latest),
    null,
  );
  const status = rows.some((r) => r.status === "delivered")
    ? "delivered"
    : sent.length > 0
      ? "emailed"
      : rows.some((r) => r.status === "failed")
        ? "failed"
        : "pending";
  return { status, sentTo: sent.map((r) => r.email).sort(), sentAt };
}

/** Report email summaries keyed by snapshot id; snapshots never emailed are absent. */
export async function listReportEmailSummaries(
  db: Executor,
  snapshotIds: string[],
): Promise<Map<string, ReportEmailSummary>> {
  const out = new Map<string, ReportEmailSummary>();
  if (snapshotIds.length === 0) return out;
  const rows = await db
    .select({
      snapshotId: reportEmailDeliveries.snapshotId,
      email: reportEmailDeliveries.email,
      status: reportEmailDeliveries.status,
      sentAt: reportEmailDeliveries.sentAt,
    })
    .from(reportEmailDeliveries)
    .where(inArray(reportEmailDeliveries.snapshotId, snapshotIds));
  const bySnapshot = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = bySnapshot.get(row.snapshotId) ?? [];
    list.push(row);
    bySnapshot.set(row.snapshotId, list);
  }
  bySnapshot.forEach((list, id) => {
    const summary = summarizeReportEmail(list);
    if (summary) out.set(id, summary);
  });
  return out;
}
