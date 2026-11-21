import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";
import {
  COMPANY_RECORD_STATUSES,
  db,
  normalizeToolToggles,
  sessionFiles,
  type ToolToggles,
} from "@relay/db";
import {
  getCompanyRecord,
  searchCompanyRecords,
  upsertCompanyRecord,
} from "./company-records";
import { ASK_OPERATOR_TOOL, makeAskOperatorTool } from "./ask-operator";
import { listLeadsToQualify, scoreLead } from "../leads/score-lead";
import { buildExcelWorkbook } from "./excel";
import { proposeOutreach } from "./propose-action";
import { runResearchPipeline, type ResearchMode } from "./research-pipeline";
import { saveSessionFile } from "./session-file-store";
import { DAILY_MANAGER_PACKAGE } from "./cron-tools";
import { makeManagerTools } from "./task-tools";

const EXCEL_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const recordStatusSchema = z.enum(COMPANY_RECORD_STATUSES);
// An agent never marks a sale: `won` needs a package and an amount, which only
// a person sets (the DB CHECK company_records_won_sale_chk is the backstop).
const upsertStatusSchema = recordStatusSchema.exclude(["won"]);

export function applyRevenueTools({
  selected,
  toolToggles,
  companyId,
  agentId,
  parent,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selected: Record<string, ReturnType<typeof tool<any, any>>>;
  toolToggles: ToolToggles;
  companyId: string;
  agentId: string;
  parent: { chatId: string } | { cronRunId: string };
}) {
  if (toolToggles.companyMemory) {
    selected.searchCompanyRecords = tool({
      description:
        "Search company memory for accounts. Returns up to 20 rows without payload.",
      inputSchema: z.object({
        query: z.string(),
        status: recordStatusSchema.optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ query, status, domain }) =>
        searchCompanyRecords({
          companyId,
          query,
          status,
          domain,
        }),
    });

    selected.getCompanyRecord = tool({
      description: "Get one company memory record by id, including payload.",
      inputSchema: z.object({
        recordId: z.string().uuid(),
      }),
      execute: async ({ recordId }) =>
        getCompanyRecord({ companyId, recordId }),
    });

    selected.upsertCompanyRecord = tool({
      description:
        "Insert or merge a company memory record. Empty domain is stored as null. Status won is set only by a person with a package and an amount, never by this tool.",
      inputSchema: z.object({
        recordId: z.string().uuid().optional(),
        entityType: z.enum(["account", "person"]),
        name: z.string(),
        domain: z.string().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
        score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("Fit score 0-100: 70+ qualified, 50-69 borderline, under 50 rejected"),
        status: upsertStatusSchema.optional(),
        nextFollowUpAt: z.string().optional(),
      }),
      execute: async (input) =>
        upsertCompanyRecord({
          companyId,
          sourceAgentId: agentId,
          recordId: input.recordId,
          entityType: input.entityType,
          name: input.name,
          domain: input.domain,
          payload: input.payload,
          score: input.score,
          status: input.status,
          nextFollowUpAt:
            input.nextFollowUpAt === undefined
              ? undefined
              : new Date(input.nextFollowUpAt),
        }),
    });

    // Lead engine qualify step (S27): the band sets the status.
    selected.listLeadsToQualify = tool({
      description:
        "Leads waiting for a fit score: outbound leads not yet scored, inbound leads with intake complete, and inbound leads quiet for 24 h.",
      inputSchema: z.object({}),
      execute: async () => listLeadsToQualify({ companyId }),
    });

    selected.scoreLead = tool({
      description:
        "Score one lead 0-100 with 1-3 short fit reasons. 70+ qualified, 50-69 borderline (a person decides), under 50 rejected with exactly one reject reason. Only unscored leads.",
      inputSchema: z.object({
        recordId: z.string().uuid(),
        score: z.number().int().min(0).max(100),
        reasons: z.array(z.string().trim().min(1).max(80)).min(1).max(3),
        rejectReason: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("Required under 50, never at 50 or more"),
      }),
      execute: async (input) => scoreLead({ companyId, agentId, ...input, parent }),
    });
  }

  if (toolToggles.proposeAction) {
    selected.proposeAction = tool({
      description:
        "Draft outreach for a researched account. A human must Send before anything leaves Relay.",
      inputSchema: z.object({
        recordId: z.string().uuid(),
        actionType: z.literal("outreach"),
        channel: z.enum(["email", "whatsapp", "copy"]),
        recipient: z.string(),
        subject: z.string().optional(),
        body: z.string(),
        reason: z.string(),
        force: z.boolean().optional(),
      }),
      execute: async (input) =>
        proposeOutreach({
          companyId,
          agentId,
          ...parent,
          input,
        }),
    });
  }
}

export function applyResearchTools({
  selected,
  companyId,
  agentId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selected: Record<string, ReturnType<typeof tool<any, any>>>;
  companyId: string;
  /** The agent running the tool, credited in the lead event log. */
  agentId?: string;
}) {
  const recordIdSchema = z.object({
    recordId: z.string().uuid(),
  });

  const researchTool = (mode: ResearchMode, description: string) =>
    tool({
      description,
      inputSchema: recordIdSchema,
      execute: async ({ recordId }) =>
        runResearchPipeline({
          companyId,
          recordId,
          mode,
          ...(agentId ? { actor: { agentId } } : {}),
        }),
    });

  selected.researchAccount = researchTool(
    "all",
    "Run the full research pipeline (Google Places, Hunter, Snov) for a company memory account.",
  );
  selected.googlePlaces_searchCompany = researchTool(
    "google_places",
    "Search Google Places for a company memory account and enrich its record.",
  );
  selected.hunter_findEmails = researchTool(
    "hunter",
    "Find emails for a company memory account domain using Hunter.",
  );
  selected.snov_findEmails = researchTool(
    "snov",
    "Find emails for a company memory account domain using Snov.io.",
  );
}

interface SelectOperatorToolsOptions {
  version: { toolToggles: ToolToggles };
  chatId: string;
  agentId: string;
  companyId: string;
  /** The agent's install package; `manager` adds the Daily Manager session tools. */
  packageSlug?: string | null;
  /** The session user the Daily Manager task tools act as. */
  userId?: string | null;
}

export function selectOperatorTools({
  version,
  chatId,
  agentId,
  companyId,
  packageSlug,
  userId,
}: SelectOperatorToolsOptions) {
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
      execute: async ({ filename, sheets }) => {
        const totalRows = sheets.reduce(
          (sum, sheet) => sum + sheet.rows.length,
          0,
        );
        const buffer = await buildExcelWorkbook(sheets);
        const { storageKey, byteSize } = await saveSessionFile(buffer, filename);

        const [file] = await db
          .insert(sessionFiles)
          .values({
            chatId,
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
          downloadPath: `/api/operator/sessions/${chatId}/files/${file.id}`,
        };
      },
    });
  }

  applyRevenueTools({
    selected,
    toolToggles,
    companyId,
    agentId,
    parent: { chatId },
  });

  applyResearchTools({ selected, companyId, agentId });

  selected[ASK_OPERATOR_TOOL] = makeAskOperatorTool({
    companyId,
    agentId,
    parent: { chatId },
  });

  // Daily Manager in a session: the workspace snapshot and task tools, acting
  // as the session user. postDailyBrief stays cron-only.
  if (packageSlug === DAILY_MANAGER_PACKAGE && userId) {
    Object.assign(selected, makeManagerTools({ companyId, userId }));
  }

  return selected;
}

