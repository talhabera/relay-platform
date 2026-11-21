import { anthropic } from "@ai-sdk/anthropic";

import { tool } from "ai";

import { z } from "zod";

import {

  db,

  normalizeToolToggles,

  sessionFiles,

  type ToolToggles,

} from "@relay/db";

import {
  ReportNarrativeError,
  writeReportNarrative,
} from "@relay/db/report-snapshots";
import { buildExcelWorkbook } from "./excel";

import { saveSessionFile } from "./session-file-store";

import { ASK_OPERATOR_TOOL, makeAskOperatorTool } from "./ask-operator";

import { applyResearchTools, applyRevenueTools } from "./tools";
import {
  executePostDailyBrief,
  POST_DAILY_BRIEF_TOOL,
  postDailyBriefInputSchema,
  READ_WORKSPACE_STATE_TOOL,
} from "./daily-brief-tool";
import { loadWorkspaceState } from "./workspace-state";
import { loadAdState, READ_AD_STATE_TOOL } from "./ad-state";
import { executePostAdBrief, POST_AD_BRIEF_TOOL, postAdBriefInputSchema } from "./ad-brief-tool";
import {
  adAccountInputSchema,
  adRangeInputSchema,
  getAdPerformance,
  getAdSearchTerms,
  listAdCampaigns,
  proposeAdChange,
  proposeAdChangeInputSchema,
} from "../ads/propose-ad-change";



const EXCEL_CONTENT_TYPE =

  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";



export async function executeCronExcelWorkbook(

  cronRunId: string,

  input: {

    filename: string;

    sheets: Array<{ name: string; rows: string[][] }>;

  },

) {

  const { filename, sheets } = input;

  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);

  const buffer = await buildExcelWorkbook(sheets);

  const { storageKey, byteSize } = await saveSessionFile(buffer, filename);



  const [file] = await db

    .insert(sessionFiles)

    .values({

      cronRunId,

      filename,

      contentType: EXCEL_CONTENT_TYPE,

      byteSize,

      storageKey,

    })

    .returning();



  return {

    fileId: file.id,

    filename,

    rowCount: totalRows,

    downloadPath: `/api/operator/cron/runs/${cronRunId}/files/${file.id}`,

  };

}



export const WRITE_REPORT_NARRATIVE_TOOL = "writeReportNarrative";

/**
 * Insights writes words, never numbers (report snapshot spec, decision 1):
 * the summary and Highlights go onto the latest frozen weekly or monthly
 * snapshot of the run's company.
 */
export async function executeWriteReportNarrative(
  companyId: string,
  input: {
    period: "weekly" | "monthly";
    summary: string;
    highlights: string[];
  },
) {
  try {
    const row = await writeReportNarrative(db, {
      companyId,
      period: input.period,
      narrative: { summary: input.summary, highlights: input.highlights },
    });
    if (!row) {
      return {
        ok: false as const,
        error: `No closed ${input.period} report exists yet for this company.`,
      };
    }
    return {
      ok: true as const,
      snapshotId: row.id,
      periodStart: row.start.toISOString(),
      periodEnd: row.end.toISOString(),
    };
  } catch (error) {
    if (error instanceof ReportNarrativeError) {
      return { ok: false as const, error: error.message };
    }
    throw error;
  }
}

interface SelectCronOperatorToolsOptions {

  version: { toolToggles: ToolToggles };

  cronRunId: string;

  agentId: string;

  companyId: string;

  /** `cron_jobs.packageSlug` of the run's Schedule; null for hand-made Schedules. */

  packageSlug?: string | null;

}



/** Only Insights Schedules write the client report narrative (S86-87, S81-82). */

export const REPORT_NARRATIVE_PACKAGE = "insights";

/** Only Daily Manager Schedules read the workspace and post the morning brief. */
export const DAILY_MANAGER_PACKAGE = "manager";

/** Only Ad monitor Schedules read the ad state and post the ad brief (RL7). */
export const AD_MONITOR_PACKAGE = "ad-monitor";

/** RL8b1: ad reads plus `proposeAdChange`, which picks the path in code. */
export const AD_MANAGER_PACKAGE = "ad-manager";



export function selectCronOperatorTools({

  version,

  cronRunId,

  agentId,

  companyId,

  packageSlug = null,

}: SelectCronOperatorToolsOptions) {

  const toolToggles = normalizeToolToggles(version.toolToggles);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  const selected: Record<string, ReturnType<typeof tool<any, any>>> = {};



  if (toolToggles.webSearch) {

    selected.web_search = anthropic.tools.webSearch_20250305({ maxUses: 5 });

  }



  if (toolToggles.excel) {

    selected.createExcelWorkbook = tool({

      description:

        "Create an Excel workbook with one or more sheets and save it to the session.",

      inputSchema: z.object({

        filename: z.string(),

        sheets: z.array(

          z.object({

            name: z.string(),

            rows: z.array(z.array(z.string())),

          }),

        ),

      }),

      execute: async ({ filename, sheets }) =>

        executeCronExcelWorkbook(cronRunId, { filename, sheets }),

    });

  }



  applyRevenueTools({

    selected,

    toolToggles,

    companyId,

    agentId,

    parent: { cronRunId },

  });



  applyResearchTools({ selected, companyId, agentId });

  if (packageSlug === REPORT_NARRATIVE_PACKAGE) {

    selected[WRITE_REPORT_NARRATIVE_TOOL] = tool({
      description:
        "Write the summary and highlights onto the company's latest closed weekly or monthly report. The report's numbers are already frozen; this adds only the text.",
      inputSchema: z.object({
        period: z.enum(["weekly", "monthly"]),
        summary: z.string().min(1).max(2000),
        highlights: z.array(z.string().min(1).max(400)).max(8),
      }),
      execute: async (input) => executeWriteReportNarrative(companyId, input),
    });

  }

  if (packageSlug === DAILY_MANAGER_PACKAGE) {
    selected[READ_WORKSPACE_STATE_TOOL] = tool({
      description:
        "Read a snapshot of what needs attention in this company: tasks (overdue, due today, doing and blocked, with open, unassigned and done-yesterday counts and open and overdue counts per active project), the last brief's items and where the reader left them (open, done or dismissed), paused and failed Schedules, open questions and approvals, Inbox counts, weekly targets, packages and connectors. Ids, names, counts and in-app links only.",
      inputSchema: z.object({}),
      execute: async () => loadWorkspaceState(companyId),
    });
    selected[POST_DAILY_BRIEF_TOOL] = tool({
      description:
        "Post today's morning brief: a short summary and 1 to 5 ranked items (rank 1 first). Posting again today replaces the brief.",
      inputSchema: postDailyBriefInputSchema,
      execute: async (input) =>
        executePostDailyBrief({ companyId, agentId, cronRunId }, input),
    });
  }

  if (packageSlug === AD_MONITOR_PACKAGE) {
    selected[READ_AD_STATE_TOOL] = tool({
      description:
        "Read today's ad state for this company: spend, leads and cost per lead per channel for yesterday and month to date, the stop-rule window per channel, data gaps and warnings (alerts), open action proposals, capacity and in-app links. Every figure is final and already formatted; copy it as written and never recompute it.",
      inputSchema: z.object({}),
      execute: async () => loadAdState(companyId),
    });
    selected[POST_AD_BRIEF_TOOL] = tool({
      description:
        "Post today's ad brief: a short summary and 1 to 5 ranked items (rank 1 first). Every open proposal from readAdState must be carried by a decide item with its proposalKey, or the post is refused. Figures must be copied from readAdState, never recomputed. Posting again today replaces only the ad items.",
      inputSchema: postAdBriefInputSchema,
      execute: async (input) => executePostAdBrief({ companyId, agentId, cronRunId }, input),
    });
  }

  if (packageSlug === AD_MANAGER_PACKAGE) {
    selected[READ_AD_STATE_TOOL] = tool({
      description:
        "Read today's ad state for this company: the daily cap, spend, leads and cost per lead per channel, data gaps, open proposals and capacity. Every figure is final and already formatted; copy it as written.",
      inputSchema: z.object({}),
      execute: async () => loadAdState(companyId),
    });
    selected.listAdCampaigns = tool({
      description:
        "List the campaigns of one ad account: id, name, status and daily budget in kuruş. Also says whether the account is managed by hand (mode: manual).",
      inputSchema: adAccountInputSchema,
      execute: async (input) => listAdCampaigns(companyId, input),
    });
    selected.getAdPerformance = tool({
      description:
        "Read impressions, clicks, conversions and cost in kuruş per campaign of one ad account for an inclusive YYYY-MM-DD range.",
      inputSchema: adRangeInputSchema,
      execute: async (input) => getAdPerformance(companyId, input),
    });
    selected.getSearchTerms = tool({
      description:
        "Read the search terms of one ad account with clicks and cost in kuruş per campaign for an inclusive YYYY-MM-DD range.",
      inputSchema: adRangeInputSchema,
      execute: async (input) => getAdSearchTerms(companyId, input),
    });
    selected.proposeAdChange = tool({
      description:
        "Propose one ad change. The tool decides the path in code: a safe pause or budget decrease runs on its own and raises an undo card; increases, resumes, keywords and copy become approval cards; a change over the daily cap is refused with no card. There is no delete. The reason needs text, metric, value and threshold.",
      inputSchema: proposeAdChangeInputSchema,
      execute: async ({ command, reason }) =>
        proposeAdChange({ companyId, agentId, parent: { cronRunId }, command, reason }),
    });
  }

  selected[ASK_OPERATOR_TOOL] = makeAskOperatorTool({

    companyId,

    agentId,

    parent: { cronRunId },

  });



  return selected;

}


