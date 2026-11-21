import { and, eq, gte, lte, notExists, sql } from "drizzle-orm";
import {
  companies,
  companyMembers,
  db,
  reportEmailDeliveries,
  reportSnapshots,
  users,
  type ReportEmailStatus,
} from "@relay/db";
import { encodeMailSubject, renderDailyReportEmail } from "@relay/db/report-email";
import { mailConfigFromEnv, sendMail, type MailConfig, type MailTransport } from "@relay/agent-ops/shared/mailer";
import { reportTimeZone, type ReportExecutor } from "@relay/db/report-snapshots";

// Report email delivery (S88, Figma 11a `11/reports/email-daily`). Runs on
// the cron tick after the freeze: every daily snapshot that closed at least
// SEND_DELAY_MS ago (about 08:00 company time, so "Good morning" is true) and
// has no delivery rows yet is mailed to each client user of its company who
// has not opted out under Notifications (S107). Rows are claimed as
// `pending` before the SMTP send, so a crash or restart never sends twice;
// a snapshot older than MAX_AGE_MS is never mailed (an outage or a late
// SMTP config does not flood inboxes with stale reports). Weekly and
// monthly have no email design yet.

/** Daily snapshot `end` is local midnight; +8h is 08:00 company time (±1h on DST days). */
export const SEND_DELAY_MS = 8 * 3_600_000;
export const MAX_AGE_MS = 2 * 86_400_000;

export type DueReportEmail = {
  snapshotId: string;
  companyId: string;
  companyName: string;
  timezone: string | null;
  start: Date;
  end: Date;
  frozenAt: Date;
  metrics: { metricKey: string; value: number }[];
};

export type ReportEmailRecipient = { userId: string; email: string; name: string | null };

export type OutgoingReportEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
};

export type ReportEmailDeps = {
  listDue(now: Date): Promise<DueReportEmail[]>;
  /** Client users of the company, not opted out, who were members when the report froze. */
  listRecipients(companyId: string, frozenAt: Date): Promise<ReportEmailRecipient[]>;
  /** Insert `pending` rows; returns the recipients actually claimed (not already present). */
  claim(
    report: DueReportEmail,
    recipients: ReportEmailRecipient[],
  ): Promise<{ id: string; recipient: ReportEmailRecipient }[]>;
  complete(
    id: string,
    result: { status: ReportEmailStatus; providerMessageId: string | null; error: string | null; sentAt: Date | null },
  ): Promise<void>;
  send(message: OutgoingReportEmail): Promise<{ id: string | null }>;
};

export type ReportEmailConfig = { mail: MailConfig; from: string; appUrl: string };

/** Null (delivery off) unless SMTP credentials and an app URL are set. */
export function reportEmailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ReportEmailConfig | null {
  const mail = mailConfigFromEnv(env);
  const appUrl = (env.APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/+$/, "");
  if (!mail || !/^https?:\/\//.test(appUrl)) return null;
  const from = env.REPORT_EMAIL_FROM?.trim() || mail.from;
  return { mail, from, appUrl };
}

export function reportUrl(appUrl: string, snapshotId: string): string {
  const query = new URLSearchParams({ period: "daily", id: snapshotId });
  return `${appUrl}/client/reports?${query.toString()}`;
}

export function preferencesUrl(appUrl: string): string {
  return `${appUrl}/client/profile/notifications`;
}

export async function deliverDueReportEmails(
  now: Date,
  config: ReportEmailConfig | null = reportEmailConfigFromEnv(),
  deps?: ReportEmailDeps,
): Promise<{ sent: number; failed: number }> {
  if (!config) return { sent: 0, failed: 0 };
  const d = deps ?? createPgReportEmailDeps(db, config);
  let sent = 0;
  let failed = 0;
  for (const report of await d.listDue(now)) {
    try {
      const recipients = await d.listRecipients(report.companyId, report.frozenAt);
      if (recipients.length === 0) continue;
      const claimed = await d.claim(report, recipients);
      const timeZone = reportTimeZone(report.timezone);
      for (const { id, recipient } of claimed) {
        try {
          const email = renderDailyReportEmail({
            snapshot: { period: "daily", start: report.start, end: report.end, metrics: report.metrics },
            timeZone,
            companyName: report.companyName,
            recipientName: recipient.name,
            reportUrl: reportUrl(config.appUrl, report.snapshotId),
            preferencesUrl: preferencesUrl(config.appUrl),
          });
          const result = await d.send({
            from: config.from,
            to: recipient.email,
            subject: encodeMailSubject(email.subject),
            html: email.html,
            text: email.text,
            unsubscribeUrl: preferencesUrl(config.appUrl),
          });
          await d.complete(id, { status: "sent", providerMessageId: result.id, error: null, sentAt: new Date() });
          sent += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.error("report email send failed", { snapshotId: report.snapshotId, deliveryId: id, error: message });
          await d.complete(id, { status: "failed", providerMessageId: null, error: message.slice(0, 500), sentAt: null });
        }
      }
    } catch (error) {
      console.error("report email delivery failed", { snapshotId: report.snapshotId, error });
    }
  }
  return { sent, failed };
}

/** Sends one report over SMTP with a List-Unsubscribe header. Throws on failure. */
export async function sendReportEmail(
  mail: MailConfig,
  message: OutgoingReportEmail,
  transport?: MailTransport,
): Promise<{ id: string | null }> {
  return sendMail(
    mail,
    {
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: { "List-Unsubscribe": `<${message.unsubscribeUrl}>` },
    },
    transport,
  );
}

export function createPgReportEmailDeps(executor: ReportExecutor, config: ReportEmailConfig): ReportEmailDeps {
  return {
    async listDue(now) {
      const rows = await executor
        .select({
          snapshotId: reportSnapshots.id,
          companyId: reportSnapshots.companyId,
          companyName: companies.name,
          timezone: companies.timezone,
          start: reportSnapshots.start,
          end: reportSnapshots.end,
          frozenAt: reportSnapshots.frozenAt,
          metrics: reportSnapshots.metrics,
        })
        .from(reportSnapshots)
        .innerJoin(companies, eq(companies.id, reportSnapshots.companyId))
        .where(
          and(
            eq(reportSnapshots.period, "daily"),
            lte(reportSnapshots.end, new Date(now.getTime() - SEND_DELAY_MS)),
            gte(reportSnapshots.end, new Date(now.getTime() - MAX_AGE_MS)),
            notExists(
              executor
                .select({ one: sql`1` })
                .from(reportEmailDeliveries)
                .where(eq(reportEmailDeliveries.snapshotId, reportSnapshots.id)),
            ),
          ),
        );
      return rows;
    },
    async listRecipients(companyId, frozenAt) {
      return executor
        .select({ userId: users.id, email: users.email, name: users.name })
        .from(companyMembers)
        .innerJoin(users, eq(users.id, companyMembers.userId))
        .where(
          and(
            eq(companyMembers.companyId, companyId),
            eq(companyMembers.role, "client"),
            eq(companyMembers.reportEmailOptOut, false),
            lte(companyMembers.createdAt, frozenAt),
          ),
        );
    },
    async claim(report, recipients) {
      const byEmail = new Map(recipients.map((r) => [r.email, r]));
      const rows = await executor
        .insert(reportEmailDeliveries)
        .values(
          [...byEmail.values()].map((r) => ({
            snapshotId: report.snapshotId,
            companyId: report.companyId,
            userId: r.userId,
            email: r.email,
            status: "pending" as const,
          })),
        )
        .onConflictDoNothing({ target: [reportEmailDeliveries.snapshotId, reportEmailDeliveries.email] })
        .returning({ id: reportEmailDeliveries.id, email: reportEmailDeliveries.email });
      return rows.flatMap((row) => {
        const recipient = byEmail.get(row.email);
        return recipient ? [{ id: row.id, recipient }] : [];
      });
    },
    async complete(id, result) {
      await executor.update(reportEmailDeliveries).set(result).where(eq(reportEmailDeliveries.id, id));
    },
    send(message) {
      return sendReportEmail(config.mail, message);
    },
  };
}
