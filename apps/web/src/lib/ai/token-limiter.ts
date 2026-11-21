import { db } from "@/db";
import { tokenUsage } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  WEEKLY_TOKEN_LIMIT_USER,
  WEEKLY_TOKEN_LIMIT_WIDGET,
} from "@/constants";

type IdentifierType = "user" | "widget";

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
  return type === "user" ? WEEKLY_TOKEN_LIMIT_USER : WEEKLY_TOKEN_LIMIT_WIDGET;
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
