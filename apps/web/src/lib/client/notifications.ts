/**
 * Client portal bell + Notifications (S107, spec client-role-and-portal,
 * decision 8): report ready, and handoff requests addressed to the viewer.
 * Pure helpers only; the DB loader lives in `notifications-data.ts`.
 */

export type ClientNotificationKind = "report_ready" | "handoff_request";

export type ClientNotification = {
  id: string;
  kind: ClientNotificationKind;
  title: string;
  detail: string;
  /** ISO timestamp (serializable across the server/client boundary). */
  at: string;
  /** `at` in the company timezone, e.g. "2 Oct, 11:05". */
  when: string;
  href: string;
  unread: boolean;
};

/** How many items the bell and the Notifications page show. */
export const CLIENT_NOTIFICATION_LIMIT = 20;

/** How far back the bell looks. */
export const CLIENT_NOTIFICATION_WINDOW_DAYS = 30;

const E164 = /^\+[1-9]\d{6,14}$/;

export type WhatsappNumberResult = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * Profile WhatsApp number to E.164 (the format handoff recipients are stored in,
 * so the bell can match `handoff_requests.recipient_whatsapp`). Empty clears it.
 */
export function normalizeWhatsappNumber(input: string): WhatsappNumberResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  let compact = trimmed.replace(/[\s().-]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  if (!E164.test(compact)) {
    return { ok: false, message: "Enter the number with its country code, e.g. +49 151 2345 6789" };
  }
  return { ok: true, value: compact };
}

type ReportPeriod = "daily" | "weekly" | "monthly";

const PERIOD_TITLES: Record<ReportPeriod, string> = {
  daily: "Daily report ready",
  weekly: "Weekly report ready",
  monthly: "Monthly report ready",
};

export function reportReadyTitle(period: ReportPeriod): string {
  return PERIOD_TITLES[period];
}

function reportDetail(period: ReportPeriod, start: Date, end: Date, timeZone: string): string {
  if (period === "monthly") {
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone }).format(start);
  }
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
  if (period === "daily") return day.format(start);
  // `end` is exclusive: show the last day of the week.
  return `${day.format(start)} – ${day.format(new Date(end.getTime() - 1))}`;
}

export type ReportReadyRow = { id: string; period: ReportPeriod; start: Date; end: Date; frozenAt: Date };

export type HandoffRow = {
  id: string;
  status: string;
  createdAt: Date;
  questions: ReadonlyArray<{ text?: string | null }>;
};

const HANDOFF_TITLES: Record<string, string> = {
  open: "Handoff request: waiting for you",
  answered: "Handoff request answered",
  taken_over: "Handoff request taken over",
  handed_back: "Handoff request handed back",
  expired: "Handoff request expired",
};

export function buildClientNotifications(input: {
  reports: readonly ReportReadyRow[];
  handoffs: readonly HandoffRow[];
  seenAt: Date | null;
  timeZone: string;
}): ClientNotification[] {
  const { seenAt, timeZone } = input;
  const stamp = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  const unread = (at: Date) => seenAt === null || at.getTime() > seenAt.getTime();

  const items: ClientNotification[] = [
    ...input.reports.map((r) => ({
      id: `report:${r.id}`,
      kind: "report_ready" as const,
      title: reportReadyTitle(r.period),
      detail: reportDetail(r.period, r.start, r.end, timeZone),
      at: r.frozenAt.toISOString(),
      when: stamp.format(r.frozenAt),
      href: `/client/reports?${new URLSearchParams({ period: r.period, id: r.id }).toString()}`,
      unread: unread(r.frozenAt),
    })),
    ...input.handoffs.map((h) => ({
      id: `handoff:${h.id}`,
      kind: "handoff_request" as const,
      title: HANDOFF_TITLES[h.status] ?? "Handoff request",
      detail: h.questions[0]?.text?.trim() ?? "",
      at: h.createdAt.toISOString(),
      when: stamp.format(h.createdAt),
      href: "/client/live",
      unread: unread(h.createdAt),
    })),
  ];

  return items
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, CLIENT_NOTIFICATION_LIMIT);
}
