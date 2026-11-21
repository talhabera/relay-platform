import {
  convertToModelMessages,
  generateText,
  hasToolCall,
  stepCountIs,
} from "ai";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import {
  agents,
  agentVersions,
  companies,
  cronJobs,
  cronRunMessages,
  cronRuns,
  db,
  knowledgeBase,
  normalizeToolToggles,
  checkpoints,
  isOpenCheckpointStatus,
  type CheckpointStatus,
  type MessageMetadata,
  type ToolToggles,
} from "@relay/db";
import { getModel } from "./ai/provider";
import { resolveModelId } from "./ai/model-keys";
import { checkTokenBudget, recordTokenUsage } from "./ai/token-limiter";
import {
  fetchMessageBatchResults,
  pollMessageBatch,
  submitMessageBatch,
} from "./anthropic-batch";
import { cronRunMessagesToUIMessages } from "./operator/cron-messages";
import {
  ASK_OPERATOR_TOOL,
  askOperator,
  askOperatorAnthropicTool,
  countOpenRunQuestions,
  isAwaitingAnswer,
  type AskOperatorInput,
} from "./operator/ask-operator";
import { executeCronExcelWorkbook, selectCronOperatorTools } from "./operator/cron-tools";
import { buildOperatorSystemPrompt } from "./operator/system-prompt";
import {
  borderlineAnswersForAgent,
  postBorderlineQuestion,
} from "./leads/borderline-question";

const LIVE_TIMEOUT_MS = 15 * 60 * 1000;
const BATCH_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_TOKENS = 4096;

type AnthropicContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

async function loadRunContext(runId: string) {
  const run = await db.query.cronRuns.findFirst({
    where: eq(cronRuns.id, runId),
  });

  if (!run) {
    return null;
  }

  const job = await db.query.cronJobs.findFirst({
    where: eq(cronJobs.id, run.jobId),
  });

  if (!job) {
    return null;
  }

  const [agent, company, version, knowledgeEntries] =
    await Promise.all([
      db.query.agents.findFirst({ where: eq(agents.id, job.agentId) }),
      db.query.companies.findFirst({
        where: eq(companies.id, job.companyId),
      }),
      db.query.agentVersions.findFirst({
        where: eq(agentVersions.id, job.versionId),
      }),
      db.query.knowledgeBase.findMany({
        where: and(
          eq(knowledgeBase.agentId, job.agentId),
          eq(knowledgeBase.status, "ready"),
        ),
      }),
    ]);

  if (!agent || !company || !version || !job.createdByUserId) {
    return null;
  }

  return {
    run,
    job,
    agent,
    company,
    version,
    knowledgeEntries,
    createdByUserId: job.createdByUserId,
  };
}

async function getCronRunHistory(runId: string) {
  return db.query.cronRunMessages.findMany({
    where: eq(cronRunMessages.runId, runId),
    orderBy: [cronRunMessages.createdAt],
  });
}

async function saveCronAssistantMessage(
  runId: string,
  content: string,
  metadata?: MessageMetadata,
) {
  await db.insert(cronRunMessages).values({
    runId,
    role: "assistant",
    content,
    metadata: metadata ?? null,
  });
}

async function saveCronToolMessage(
  runId: string,
  content: unknown,
  metadata?: MessageMetadata,
) {
  await db.insert(cronRunMessages).values({
    runId,
    role: "tool",
    content: JSON.stringify(content),
    metadata: metadata ?? null,
  });
}

async function failRun(runId: string, error: string) {
  await db
    .update(cronRuns)
    .set({
      status: "failed",
      error,
      finishedAt: new Date(),
    })
    .where(eq(cronRuns.id, runId));
}

async function succeedRun(runId: string) {
  await db
    .update(cronRuns)
    .set({
      status: "succeeded",
      finishedAt: new Date(),
      error: null,
    })
    .where(eq(cronRuns.id, runId));

  // After the run is done, so the borderline question never holds it
  // (lead scoring spec, decision 6). A failure here must not fail the run.
  try {
    await postBorderlineQuestion(runId);
  } catch (error) {
    console.error("borderline question failed", runId, error);
  }
}

async function setAwaitingInput(runId: string) {
  await db
    .update(cronRuns)
    .set({ status: "awaiting_input" })
    .where(eq(cronRuns.id, runId));
}

function tokenLimitError(budget: {
  used: number;
  limit: number;
  resetsAt: string;
}) {
  return JSON.stringify({
    error: "Weekly token limit reached",
    used: budget.used,
    limit: budget.limit,
    resetsAt: budget.resetsAt,
  });
}

export function buildAnthropicTools(toolTogglesInput: Partial<ToolToggles>) {
  const toolToggles = normalizeToolToggles(toolTogglesInput);
  const tools: Array<Record<string, unknown>> = [];

  if (toolToggles.webSearch) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 5,
    });
  }

  if (toolToggles.excel) {
    tools.push({
      name: "createExcelWorkbook",
      description:
        "Create an Excel workbook with one or more sheets and save it to the session.",
      input_schema: {
        type: "object",
        properties: {
          filename: { type: "string" },
          sheets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                rows: {
                  type: "array",
                  items: { type: "array", items: { type: "string" } },
                },
              },
              required: ["name", "rows"],
            },
          },
        },
        required: ["filename", "sheets"],
      },
    });
  }

  if (toolToggles.companyMemory) {
    tools.push(
      {
        name: "searchCompanyRecords",
        description:
          "Search company memory for accounts. Returns up to 20 rows without payload.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string" },
            status: { type: "string" },
            domain: { type: "string" },
          },
          required: ["query"],
        },
      },
      {
        name: "getCompanyRecord",
        description: "Get one company memory record by id, including payload.",
        input_schema: {
          type: "object",
          properties: {
            recordId: { type: "string" },
          },
          required: ["recordId"],
        },
      },
      {
        name: "upsertCompanyRecord",
        description:
          "Insert or merge a company memory record. Empty domain is stored as null.",
        input_schema: {
          type: "object",
          properties: {
            recordId: { type: "string" },
            entityType: { type: "string" },
            name: { type: "string" },
            domain: { type: "string" },
            payload: { type: "object" },
            score: { type: "number" },
            status: { type: "string" },
            nextFollowUpAt: { type: "string" },
          },
          required: ["entityType", "name"],
        },
      },
    );
  }

  if (toolToggles.proposeAction) {
    tools.push({
      name: "proposeAction",
      description:
        "Draft outreach for a researched account. A human must Send before anything leaves Relay.",
      input_schema: {
        type: "object",
        properties: {
          recordId: { type: "string" },
          actionType: { type: "string" },
          channel: { type: "string" },
          recipient: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          reason: { type: "string" },
          force: { type: "boolean" },
        },
        required: [
          "recordId",
          "actionType",
          "channel",
          "recipient",
          "body",
          "reason",
        ],
      },
    });
  }

  // Always on: any operator agent may ask a person (checkpoints spec 8-12).
  tools.push(askOperatorAnthropicTool);

  return tools;
}

function cronHistoryToAnthropicMessages(
  history: Awaited<ReturnType<typeof getCronRunHistory>>,
) {
  return history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

async function buildSystemPromptForRun(
  context: NonNullable<Awaited<ReturnType<typeof loadRunContext>>>,
) {
  // Borderline answers reach the agent's next run here (W3GAP).
  const answers = await borderlineAnswersForAgent(context.agent.id).catch(
    (error: unknown) => {
      console.error("borderline answers failed", context.agent.id, error);
      return null;
    },
  );
  const versionInstructions = answers
    ? [context.version.instructions, answers].filter(Boolean).join("\n\n")
    : context.version.instructions;
  return buildOperatorSystemPrompt({
    agent: context.agent,
    company: context.company,
    versionInstructions,
    knowledgeEntries: context.knowledgeEntries,
    toolToggles: context.version.toolToggles,
  });
}

/**
 * True when the turn left something waiting on a person: a checkpoint card
 * (`pending_approval`) or an agent question (`awaiting_answer`). Either one
 * pauses the run in `awaiting_input`.
 */
export function stepHasPendingApproval(
  steps: Array<{ toolResults?: Array<{ output: unknown }> }>,
) {
  for (const step of steps) {
    for (const toolResult of step.toolResults ?? []) {
      const output = toolResult.output;
      if (isAwaitingAnswer(output)) {
        return true;
      }
      if (
        output &&
        typeof output === "object" &&
        "status" in output &&
        (output as { status: string }).status === "pending_approval"
      ) {
        return true;
      }
    }
  }

  return false;
}

async function persistToolSteps(
  runId: string,
  steps: Array<{
    toolResults?: Array<{ toolName: string; output: unknown }>;
  }>,
) {
  for (const step of steps) {
    for (const toolResult of step.toolResults ?? []) {
      await saveCronToolMessage(runId, toolResult.output, {
        toolCalls: [
          {
            type: "tool",
            tool: toolResult.toolName,
            data: toolResult.output,
          },
        ],
      });
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function executeCronModelTurn(runId: string) {
  const context = await loadRunContext(runId);
  if (!context) {
    return;
  }

  const budget = await checkTokenBudget(context.createdByUserId, "user");
  if (!budget.allowed) {
    await failRun(runId, tokenLimitError(budget));
    return;
  }

  const history = await getCronRunHistory(runId);
  const uiMessages = cronRunMessagesToUIMessages(history);
  const modelMessages = await convertToModelMessages(uiMessages);
  const systemPrompt = await buildSystemPromptForRun(context);
  const tools = selectCronOperatorTools({
    version: context.version,
    cronRunId: runId,
    agentId: context.agent.id,
    companyId: context.company.id,
    packageSlug: context.job.packageSlug,
  });

  let result;
  try {
    result = await generateText({
      model: getModel(context.version.model),
      system: systemPrompt,
      messages: modelMessages,
      tools,
      // An agent question ends the turn (checkpoints spec decision 9).
      stopWhen: [stepCountIs(10), hasToolCall(ASK_OPERATOR_TOOL)],
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
    });
  } catch (error) {
    await failRun(runId, errorMessage(error));
    return;
  }

  await persistToolSteps(runId, result.steps);

  if (stepHasPendingApproval(result.steps)) {
    await setAwaitingInput(runId);
    return;
  }

  if (result.text) {
    await saveCronAssistantMessage(runId, result.text, {
      model: resolveModelId(context.version.model),
      tokens: result.usage.totalTokens ?? undefined,
    });
  }

  const totalTokens = result.usage.totalTokens ?? 0;
  if (totalTokens > 0) {
    await recordTokenUsage(context.createdByUserId, "user", totalTokens);
  }

  await succeedRun(runId);
}

export async function runLiveCron(runId: string): Promise<void> {
  const run = await db.query.cronRuns.findFirst({
    where: eq(cronRuns.id, runId),
  });

  if (!run || run.status !== "running" || run.anthropicBatchId) {
    return;
  }

  await executeCronModelTurn(runId);
}

export async function continueCronRun(runId: string): Promise<void> {
  const run = await db.query.cronRuns.findFirst({
    where: eq(cronRuns.id, runId),
  });

  if (!run || run.status !== "awaiting_input") {
    return;
  }

  if (await runHasPendingApproval(runId)) {
    return;
  }

  // The /internal/cron/continue poke and resumeApprovedCronRuns race on the
  // same run; only the caller whose guarded update moved it runs the turn.
  const claimed = await db
    .update(cronRuns)
    .set({ status: "running", anthropicBatchId: null })
    .where(and(eq(cronRuns.id, runId), eq(cronRuns.status, "awaiting_input")))
    .returning({ id: cronRuns.id });

  if (claimed.length === 0) {
    return;
  }

  await executeCronModelTurn(runId);
}

export function stuckLiveRunWhere(now: Date, timeoutMs = LIVE_TIMEOUT_MS) {
  const cutoff = new Date(now.getTime() - timeoutMs);
  return and(
    eq(cronRuns.status, "running"),
    isNull(cronRuns.anthropicBatchId),
    lt(cronRuns.startedAt, cutoff),
  );
}

export async function failStuckLiveRuns(
  now: Date,
  timeoutMs = LIVE_TIMEOUT_MS,
): Promise<number> {
  const rows = await db
    .update(cronRuns)
    .set({
      status: "failed",
      error: "live run timed out after 15 minutes",
      finishedAt: now,
    })
    .where(stuckLiveRunWhere(now, timeoutMs))
    .returning({ id: cronRuns.id });

  return rows.length;
}

function extractAssistantText(body: unknown) {
  if (!body || typeof body !== "object" || !("content" in body)) {
    return "";
  }

  const blocks = (body as { content: AnthropicContentBlock[] }).content ?? [];
  return blocks
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("");
}

function extractToolUses(body: unknown) {
  if (!body || typeof body !== "object" || !("content" in body)) {
    return [];
  }

  const blocks = (body as { content: AnthropicContentBlock[] }).content ?? [];
  return blocks.filter((block) => block.type === "tool_use");
}

async function clearAnthropicBatchId(runId: string) {
  await db
    .update(cronRuns)
    .set({ anthropicBatchId: null })
    .where(eq(cronRuns.id, runId));
}

function extractUsageTokens(body: unknown): number {
  if (!body || typeof body !== "object" || !("usage" in body)) {
    return 0;
  }

  const usage = (
    body as {
      usage?: { input_tokens?: number; output_tokens?: number };
    }
  ).usage;

  if (!usage) {
    return 0;
  }

  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

async function handleBatchToolUses(
  runId: string,
  toolUses: AnthropicContentBlock[],
) {
  let asked = false;
  for (const toolUse of toolUses) {
    if (toolUse.name === ASK_OPERATOR_TOOL) {
      const context = await loadRunContext(runId);
      if (!context) {
        await failRun(runId, "run context missing");
        return;
      }
      const askResult = await askOperator({
        companyId: context.company.id,
        agentId: context.agent.id,
        parent: { cronRunId: runId },
        input: (toolUse.input ?? {}) as AskOperatorInput,
      });
      await saveCronToolMessage(runId, askResult, {
        toolCalls: [
          { type: "tool", tool: ASK_OPERATOR_TOOL, data: askResult },
        ],
      });
      if (isAwaitingAnswer(askResult)) {
        asked = true;
      }
      continue;
    }

    if (toolUse.name === "createExcelWorkbook") {
      const input = (toolUse.input ?? {}) as {
        filename?: string;
        sheets?: Array<{ name: string; rows: string[][] }>;
      };

      if (!input.filename || !input.sheets) {
        await saveCronToolMessage(runId, { error: "Invalid excel input" });
        continue;
      }

      const excelResult = await executeCronExcelWorkbook(runId, {
        filename: input.filename,
        sheets: input.sheets,
      });
      await saveCronToolMessage(runId, excelResult, {
        toolCalls: [
          {
            type: "tool",
            tool: "createExcelWorkbook",
            data: excelResult,
          },
        ],
      });
      continue;
    }

    if (toolUse.name === "web_search") {
      continue;
    }
  }

  // The question blocks: the run waits for an answer instead of another turn.
  if (asked) {
    await setAwaitingInput(runId);
    return;
  }

  await executeCronModelTurn(runId);
}

async function processBatchResult(
  runId: string,
  ok: boolean,
  body: unknown,
) {
  await clearAnthropicBatchId(runId);

  if (!ok) {
    await failRun(runId, JSON.stringify(body));
    return;
  }

  const context = await loadRunContext(runId);
  const totalTokens = extractUsageTokens(body);
  if (context && totalTokens > 0) {
    await recordTokenUsage(context.createdByUserId, "user", totalTokens);
  }

  const text = extractAssistantText(body);
  if (text) {
    await saveCronAssistantMessage(runId, text, {
      model: resolveModelId(context?.version.model),
      tokens: totalTokens > 0 ? totalTokens : undefined,
    });
  }

  const toolUses = extractToolUses(body);
  if (toolUses.length > 0) {
    await handleBatchToolUses(runId, toolUses);
    return;
  }

  await succeedRun(runId);
}

async function processOpenBatch(batchId: string, now: Date) {
  const runs = await db.query.cronRuns.findMany({
    where: and(
      eq(cronRuns.anthropicBatchId, batchId),
      eq(cronRuns.status, "running"),
    ),
  });

  if (runs.length === 0) {
    return;
  }

  const oldestCreatedAt = runs.reduce(
    (oldest, run) => (run.createdAt < oldest ? run.createdAt : oldest),
    runs[0]!.createdAt,
  );

  if (oldestCreatedAt.getTime() < now.getTime() - BATCH_TIMEOUT_MS) {
    await failBatchRuns(batchId, "batch timed out after 24 hours", now);
    return;
  }

  try {
    const status = await pollMessageBatch(batchId);
    if (status === "open") {
      return;
    }

    const results = await fetchMessageBatchResults(batchId);
    for (const result of results) {
      try {
        await processBatchResult(result.customId, result.ok, result.body);
      } catch (error) {
        await failRun(result.customId, errorMessage(error));
      }
    }
  } catch (error) {
    await failBatchRuns(batchId, errorMessage(error), now);
  }
}

async function failBatchRuns(batchId: string, error: string, now: Date) {
  await db
    .update(cronRuns)
    .set({
      status: "failed",
      error,
      finishedAt: now,
    })
    .where(
      and(
        eq(cronRuns.anthropicBatchId, batchId),
        eq(cronRuns.status, "running"),
      ),
    );
}

export async function pollOpenBatches(now: Date): Promise<void> {
  const rows = await db
    .selectDistinct({ batchId: cronRuns.anthropicBatchId })
    .from(cronRuns)
    .where(
      and(eq(cronRuns.status, "running"), isNotNull(cronRuns.anthropicBatchId)),
    );

  for (const row of rows) {
    if (row.batchId) {
      try {
        await processOpenBatch(row.batchId, now);
      } catch (error) {
        console.error("poll open batch failed", row.batchId, error);
      }
    }
  }
}

/** A run waits while it has an open checkpoint or an open agent question. */
async function runHasPendingApproval(runId: string): Promise<boolean> {
  const actionRows = await db.query.checkpoints.findMany({
    where: eq(checkpoints.cronRunId, runId),
  });

  if (hasOpenCheckpoint(actionRows)) {
    return true;
  }

  return (await countOpenRunQuestions(runId)) > 0;
}

/**
 * A run stays paused while any card on it waits on a person: pending, stale
 * (until Refresh or Discard) or failed (until Retry, Ask for changes or
 * Discard). Superseded cards and `changes_requested` do not hold it.
 */
export function hasOpenCheckpoint(
  rows: Array<{ status: CheckpointStatus; supersededBy: string | null }>,
): boolean {
  return rows.some(
    (row) => !row.supersededBy && isOpenCheckpointStatus(row.status),
  );
}

export async function resumeApprovedCronRuns(): Promise<void> {
  const runs = await db.query.cronRuns.findMany({
    where: eq(cronRuns.status, "awaiting_input"),
  });

  for (const run of runs) {
    if (await runHasPendingApproval(run.id)) {
      continue;
    }

    try {
      await continueCronRun(run.id);
    } catch (error) {
      console.error("resume approved cron run failed", run.id, error);
      await failRun(run.id, errorMessage(error));
    }
  }
}

export async function submitCronBatch(runIds: string[]): Promise<void> {
  const requests: Array<{ customId: string; params: Record<string, unknown> }> =
    [];

  for (const runId of runIds) {
    const context = await loadRunContext(runId);
    if (!context) {
      await failRun(runId, "run context missing");
      continue;
    }

    const budget = await checkTokenBudget(context.createdByUserId, "user");
    if (!budget.allowed) {
      await failRun(runId, tokenLimitError(budget));
      continue;
    }

    const history = await getCronRunHistory(runId);
    const systemPrompt = await buildSystemPromptForRun(context);
    const tools = buildAnthropicTools(context.version.toolToggles);

    const params: Record<string, unknown> = {
      model: resolveModelId(context.version.model),
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: cronHistoryToAnthropicMessages(history),
    };

    if (tools.length > 0) {
      params.tools = tools;
    }

    requests.push({ customId: runId, params });
  }

  if (requests.length === 0) {
    return;
  }

  try {
    const batchId = await submitMessageBatch(requests);
    await db
      .update(cronRuns)
      .set({ anthropicBatchId: batchId })
      .where(inArray(cronRuns.id, requests.map((request) => request.customId)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const request of requests) {
      await failRun(request.customId, message);
    }
  }
}

export async function startCronLive(runIds: string[]): Promise<void> {
  for (const runId of runIds) {
    await runLiveCron(runId);
  }
}

export async function startCronBatch(runIds: string[]): Promise<void> {
  await submitCronBatch(runIds);
}
