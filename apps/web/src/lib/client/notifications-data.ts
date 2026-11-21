import { and, desc, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { companies, companyMembers, handoffRequests, reportSnapshots, users } from "@/db/schema";
import { reportTimeZone } from "@relay/db/report-snapshots";

import {
  CLIENT_NOTIFICATION_LIMIT,
  CLIENT_NOTIFICATION_WINDOW_DAYS,
  buildClientNotifications,
  type ClientNotification,
} from "./notifications";

export type ClientNotificationState = {
  /** How the viewer relates to the company; `owner` / `member` see the read-only preview. */
  viewer: "client" | "member" | "owner";
  items: ClientNotification[];
  unread: boolean;
  /** Null for the owner / member preview (no client membership row). */
  reportEmailOptOut: boolean | null;
};

/**
 * Bell feed for one portal viewer: closed report snapshots of the company and
 * handoff requests whose recipient WhatsApp is the viewer's profile number.
 * Callers (the `/client/*` pages) have already authorized the viewer for the company.
 */
export async function loadClientNotifications(
  userId: string,
  companyId: string,
): Promise<ClientNotificationState> {
  const since = new Date(Date.now() - CLIENT_NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [company] = await db
    .select({ id: companies.id, timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) return { viewer: "owner", items: [], unread: false, reportEmailOptOut: null };

  const [user] = await db
    .select({ whatsappNumber: users.whatsappNumber })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [membership] = await db
    .select({
      role: companyMembers.role,
      reportEmailOptOut: companyMembers.reportEmailOptOut,
      notificationsSeenAt: companyMembers.notificationsSeenAt,
    })
    .from(companyMembers)
    .where(and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, company.id)))
    .limit(1);
  const client = membership?.role === "client" ? membership : null;

  const reports = await db
    .select({
      id: reportSnapshots.id,
      period: reportSnapshots.period,
      start: reportSnapshots.start,
      end: reportSnapshots.end,
      frozenAt: reportSnapshots.frozenAt,
    })
    .from(reportSnapshots)
    .where(and(eq(reportSnapshots.companyId, company.id), gte(reportSnapshots.frozenAt, since)))
    .orderBy(desc(reportSnapshots.frozenAt))
    .limit(CLIENT_NOTIFICATION_LIMIT);

  const handoffs = user?.whatsappNumber
    ? await db
        .select({
          id: handoffRequests.id,
          status: handoffRequests.status,
          createdAt: handoffRequests.createdAt,
          questions: handoffRequests.questions,
        })
        .from(handoffRequests)
        .where(
          and(
            eq(handoffRequests.companyId, company.id),
            eq(handoffRequests.recipientWhatsapp, user.whatsappNumber),
            gte(handoffRequests.createdAt, since),
          ),
        )
        .orderBy(desc(handoffRequests.createdAt))
        .limit(CLIENT_NOTIFICATION_LIMIT)
    : [];

  const items = buildClientNotifications({
    reports,
    handoffs,
    // The preview has nowhere to store a read marker: nothing shows as unread.
    seenAt: client ? client.notificationsSeenAt : new Date(),
    timeZone: reportTimeZone(company.timezone),
  });

  return {
    viewer: client ? "client" : membership ? "member" : "owner",
    items,
    unread: items.some((item) => item.unread),
    reportEmailOptOut: client ? client.reportEmailOptOut : null,
  };
}
