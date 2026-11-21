import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { agents } from "./agents";
import { chats } from "./chats";
import { cronRuns } from "./cron-runs";
import { users } from "./users";

/**
 * Agent question (checkpoints spec decisions 8-12): its own entity, not a
 * checkpoint kind. Answered in text, never executes, never goes stale or
 * fails, never expires. `open` blocks the session or Schedule run until a
 * person who can steer answers it.
 */
export const AGENT_QUESTION_STATUSES = ["open", "answered"] as const;

export type AgentQuestionStatus = (typeof AGENT_QUESTION_STATUSES)[number];

/** The agent offers 2-4 one-tap answers, or none (decision 10). */
export const AGENT_QUESTION_MIN_SUGGESTIONS = 2;
export const AGENT_QUESTION_MAX_SUGGESTIONS = 4;

export const agentQuestions = pgTable(
  "agent_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    cronRunId: uuid("cron_run_id").references(() => cronRuns.id, {
      onDelete: "cascade",
    }),
    question: text("question").notNull(),
    suggestedAnswers: jsonb("suggested_answers")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text("status", { enum: AGENT_QUESTION_STATUSES })
      .notNull()
      .default("open"),
    answer: text("answer"),
    answeredByUserId: text("answered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    answeredAt: timestamp("answered_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("agent_questions_chat_id_idx").on(table.chatId),
    index("agent_questions_cron_run_id_idx").on(table.cronRunId),
    index("agent_questions_open_company_idx")
      .on(table.companyId)
      .where(sql`${table.status} = 'open'`),
    check(
      "agent_questions_parent_chk",
      sql`(chat_id IS NOT NULL AND cron_run_id IS NULL) OR (chat_id IS NULL AND cron_run_id IS NOT NULL)`,
    ),
    check(
      "agent_questions_status_chk",
      sql`status IN ('open', 'answered')`,
    ),
    check(
      "agent_questions_answer_chk",
      sql`(status = 'open' AND answer IS NULL) OR (status = 'answered' AND answer IS NOT NULL AND answered_at IS NOT NULL)`,
    ),
  ],
);
