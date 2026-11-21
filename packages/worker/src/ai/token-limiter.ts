import { db, tokenUsage } from "@relay/db";
import { and, eq, sql } from "drizzle-orm";

// Keep in sync with apps/web/src/constants. Make per-company/plan later.
const WEEKLY_TOKEN_LIMIT_USER = 1_000_000;
const WEEKLY_TOKEN_LIMIT_WIDGET = 50_000;
// An inbound messaging channel is a business surface, not an anonymous
// visitor: between the two, and per channel so one busy number cannot
// starve another.
const WEEKLY_TOKEN_LIMIT_CHANNEL = 250_000;

type IdentifierType = "user" | "widget" | "channel";

const WEEKLY_TOKEN_LIMITS: Record<IdentifierType, number> = {
  user: WEEKLY_TOKEN_LIMIT_USER,
  widget: WEEKLY_TOKEN_LIMIT_WIDGET,
  channel: WEEKLY_TOKEN_LIMIT_CHANNEL,
};

function getWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().split("T")[0];
}

function getNextWeekStart(): Date {
  const weekStart = getWeekStart();
  const next = new Date(weekStart + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

function getLimit(type: IdentifierType): number {
  return WEEKLY_TOKEN_LIMITS[type];
}

export async function checkTokenBudget(
  identifier: string,
  type: IdentifierType
) {
  const weekStart = getWeekStart();
  const limit = getLimit(type);

  const row = await db.query.tokenUsage.findFirst({
    where: and(
      eq(tokenUsage.identifier, identifier),
      eq(tokenUsage.identifierType, type),
      eq(tokenUsage.weekStart, weekStart)
    ),
  });

  const used = row?.tokensUsed ?? 0;

  return {
    allowed: used < limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: getNextWeekStart().toISOString(),
  };
}

export async function recordTokenUsage(
  identifier: string,
  type: IdentifierType,
  tokens: number
) {
  const weekStart = getWeekStart();

  await db
    .insert(tokenUsage)
    .values({
      identifier,
      identifierType: type,
      tokensUsed: tokens,
      weekStart,
    })
    .onConflictDoUpdate({
      target: [
        tokenUsage.identifier,
        tokenUsage.identifierType,
        tokenUsage.weekStart,
      ],
      set: {
        tokensUsed: sql`${tokenUsage.tokensUsed} + ${tokens}`,
        updatedAt: new Date(),
      },
    });
}
