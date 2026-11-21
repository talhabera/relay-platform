import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentQuestions } from "@/db/schema";
import type { SessionQuestionView } from "@/components/operator/session-questions";

/** "07:20" in the company timezone. */
export function questionTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** A session's agent questions, oldest first, with who answered. */
export async function loadSessionQuestions(
  chatId: string,
  timeZone: string,
): Promise<SessionQuestionView[]> {
  const rows = await db.query.agentQuestions.findMany({
    where: eq(agentQuestions.chatId, chatId),
    orderBy: [asc(agentQuestions.createdAt)],
    with: { answeredBy: { columns: { name: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    suggestedAnswers: row.suggestedAnswers ?? [],
    status: row.status,
    answer: row.answer,
    answeredBy: row.answeredBy?.name ?? row.answeredBy?.email ?? null,
    askedAt: questionTime(row.createdAt, timeZone),
    answeredAt: row.answeredAt ? questionTime(row.answeredAt, timeZone) : null,
  }));
}
