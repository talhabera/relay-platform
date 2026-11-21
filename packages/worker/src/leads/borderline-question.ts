import { and, desc, eq, gte, isNotNull, like } from "drizzle-orm";
import {
  agentQuestions,
  companyRecords,
  cronJobs,
  cronRunMessages,
  cronRuns,
  db,
  leadEvents,
} from "@relay/db";
import { ASK_OPERATOR_TOOL, AWAITING_ANSWER } from "../operator/ask-operator";
import { isInboundSource } from "./score-lead";

// One Agent question per run for its borderline leads (lead scoring spec,
// decision 6). Posted by the runtime once the run has finished, so the run
// never waits on it: it is already `succeeded` and has delivered its
// qualified leads. Answering it does not change any lead; a person accepts or
// rejects each one in the Borderline filter. Inbound borderline leads are left
// out (decision 15): the customer is live in chat, they go to the filter only.
//
// The answer reaches the agent's next run (W3GAP): the run has already
// succeeded when the question is posted, so answering it resumes nothing.
// Instead every run of the agent gets its latest answered borderline
// questions in its instructions (`borderlineAnswersForAgent`) and calibrates
// later scores with them. The answer still changes no lead by itself; the
// listed leads wait in the Borderline filter for a person. An open question is
// left out and blocks nothing.

export type BorderlineLead = {
  id: string;
  name: string;
  score: number | null;
  fitReasons: string[];
};

const LISTED_MAX = 10;
/** Every borderline question starts with this; it tells them from others. */
export const BORDERLINE_QUESTION_PREFIX = "This run held ";
/** Answered borderline questions a run reads, newest first. */
const ANSWERS_MAX = 3;
const ANSWER_CHARS = 500;

/** The question text, or null when the run left no borderline lead. */
export function buildBorderlineQuestion(leads: BorderlineLead[]): string | null {
  if (leads.length === 0) return null;
  const listed = leads.slice(0, LISTED_MAX).map((lead) => {
    const why = lead.fitReasons.length > 0 ? ` (${lead.fitReasons.join("; ")})` : "";
    return `- ${lead.name}: ${lead.score ?? "?"}${why}`;
  });
  const more =
    leads.length > LISTED_MAX ? [`- and ${leads.length - LISTED_MAX} more`] : [];
  const noun = leads.length === 1 ? "lead" : "leads";
  return [
    `${BORDERLINE_QUESTION_PREFIX}${leads.length} borderline ${noun} (fit 50-69):`,
    ...listed,
    ...more,
    "Should leads like these count as qualified? Accept or reject each one in the Borderline filter.",
  ].join("\n");
}

/** Outbound leads this run's agent moved to `borderline` that still sit there. */
export async function findRunBorderlineLeads(run: {
  companyId: string;
  agentId: string;
  since: Date;
}): Promise<BorderlineLead[]> {
  const rows = await db
    .selectDistinct({
      id: companyRecords.id,
      name: companyRecords.name,
      score: companyRecords.score,
      fitReasons: companyRecords.fitReasons,
      source: companyRecords.source,
    })
    .from(leadEvents)
    .innerJoin(companyRecords, eq(companyRecords.id, leadEvents.recordId))
    .where(
      and(
        eq(leadEvents.companyId, run.companyId),
        eq(leadEvents.agentId, run.agentId),
        eq(leadEvents.toStatus, "borderline"),
        gte(leadEvents.at, run.since),
        eq(companyRecords.status, "borderline"),
      ),
    );

  return rows
    .filter((row) => !isInboundSource(row.source))
    .map(({ source: _source, ...row }) => row)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Posts the run's borderline question, once. Returns the question id, or null
 * when there is nothing to ask or the run already carries this question.
 */
export async function postBorderlineQuestion(runId: string): Promise<string | null> {
  const [run] = await db
    .select({
      id: cronRuns.id,
      startedAt: cronRuns.startedAt,
      createdAt: cronRuns.createdAt,
      companyId: cronJobs.companyId,
      agentId: cronJobs.agentId,
    })
    .from(cronRuns)
    .innerJoin(cronJobs, eq(cronJobs.id, cronRuns.jobId))
    .where(eq(cronRuns.id, runId));
  if (!run) return null;

  const leads = await findRunBorderlineLeads({
    companyId: run.companyId,
    agentId: run.agentId,
    since: run.startedAt ?? run.createdAt,
  });
  const question = buildBorderlineQuestion(leads);
  if (!question) return null;

  const existing = await db.query.agentQuestions.findFirst({
    where: and(
      eq(agentQuestions.cronRunId, runId),
      eq(agentQuestions.question, question),
    ),
  });
  if (existing) return null;

  const [row] = await db
    .insert(agentQuestions)
    .values({
      companyId: run.companyId,
      agentId: run.agentId,
      cronRunId: runId,
      question,
      suggestedAnswers: [],
      status: "open",
    })
    .returning({ id: agentQuestions.id });

  // The transcript shows the question like one the agent asked itself.
  const output = {
    status: AWAITING_ANSWER,
    kind: "agent_question",
    toolName: ASK_OPERATOR_TOOL,
    questionId: row.id,
    question,
    suggestedAnswers: [],
    message: "Borderline leads are in the Borderline filter. The run is done.",
  };
  await db.insert(cronRunMessages).values({
    runId,
    role: "tool",
    content: JSON.stringify(output),
    metadata: {
      toolCalls: [{ type: "tool", tool: ASK_OPERATOR_TOOL, data: output }],
    },
  });

  return row.id;
}

export type AnsweredBorderlineQuestion = { question: string; answer: string };

/** The instructions block for a run, or null when nothing was answered. */
export function buildBorderlineAnswers(
  answered: AnsweredBorderlineQuestion[],
): string | null {
  if (answered.length === 0) return null;
  const blocks = answered.map(({ question, answer }) =>
    [question, `Answer: ${answer.trim().slice(0, ANSWER_CHARS)}`].join("\n"),
  );
  return [
    "## Answers to your earlier borderline questions (newest first)",
    "A person answered these. Use them to calibrate fit scores for similar leads in this run. They do not change a lead that is already scored; a person still accepts or rejects each borderline lead in the Borderline filter.",
    ...blocks,
  ].join("\n\n");
}

/** The agent's latest answered borderline questions, as instructions. */
export async function borderlineAnswersForAgent(agentId: string): Promise<string | null> {
  const rows = await db.query.agentQuestions.findMany({
    where: and(
      eq(agentQuestions.agentId, agentId),
      eq(agentQuestions.status, "answered"),
      isNotNull(agentQuestions.cronRunId),
      like(agentQuestions.question, `${BORDERLINE_QUESTION_PREFIX}%`),
    ),
    orderBy: [desc(agentQuestions.answeredAt)],
    limit: ANSWERS_MAX,
  });
  return buildBorderlineAnswers(
    rows
      .filter((row): row is typeof row & { answer: string } => !!row.answer)
      .map((row) => ({ question: row.question, answer: row.answer })),
  );
}
