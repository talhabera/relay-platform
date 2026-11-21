export type RecurringInterval = "daily" | "weekly" | "monthly";

export function localToday(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function parseYmd(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function formatYmd(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function nextDueDate(
  recurrence: RecurringInterval,
  from: string,
): string {
  const { year, month, day } = parseYmd(from);

  if (recurrence === "monthly") {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    // Day 0 of the month after nextMonth is the last day of nextMonth.
    const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
    return formatYmd(nextYear, nextMonth, Math.min(day, lastDay));
  }

  const addDays = recurrence === "weekly" ? 7 : 1;
  const next = new Date(Date.UTC(year, month - 1, day + addDays));
  return formatYmd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function followUpDueDate(
  recurrence: RecurringInterval,
  dueDate: string | null,
  today: string,
): string {
  return nextDueDate(recurrence, dueDate ?? today);
}
