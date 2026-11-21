import { tool } from "ai";
import { z } from "zod";
import {
  FIT_SCORE_QUALIFIED,
  type CompanyRecordStatus,
  type WorkflowIntakeField,
} from "@relay/db";
import {
  LeadScopeError,
  pgLeadStore,
  recordLead,
  type LeadStore,
} from "../leads/record-lead";
import { notifyQualifiedLead } from "../leads/notify-lead";
import { recordFirstResponse } from "../leads/first-response";
import { scoreLead } from "../leads/score-lead";

export const RECORD_LEAD_TOOL_NAME = "record_lead";

export interface LeadCaptureContext {
  agentId: string;
  companyId: string;
  /**
   * The widget creates its chat after the tools are built, so the id is read
   * when the tool runs, not when it is registered.
   */
  getChatId: () => string | null;
  /** The intake checklist (already passed through `effectiveIntake`). */
  intake: readonly WorkflowIntakeField[];
  /**
   * Legacy inbound intake (Lead capture on, no workflow picked): score the
   * lead as soon as its checklist is complete, as captureLead did, since no
   * Qualify agent picks these leads up until the agent feeds a workflow.
   */
  scoreOnComplete?: boolean;
  /** Test seam; the Postgres store otherwise. */
  store?: LeadStore;
}

/**
 * The fit score a complete legacy checklist gets: the qualified threshold.
 * The old captureLead qualified on a complete checklist alone; this keeps
 * that rule while putting the lead through scoreLead (event log, Live feed,
 * notification, delivery card).
 */
export const LEGACY_COMPLETE_SCORE = FIT_SCORE_QUALIFIED;

/**
 * One optional string per intake field, plus the tri-state `rejected`. There
 * is deliberately no chat, company, agent, phone or campaign-code field: the
 * tenant comes from the closure, the phone from the channel and the code is
 * extracted from the first message by the worker, so the model cannot aim a
 * write at someone else's conversation or invent a code.
 */
export function recordLeadInputSchema(intake: readonly WorkflowIntakeField[]) {
  const shape: Record<string, z.ZodOptional<z.ZodString>> = {};
  for (const field of intake) {
    shape[field.key] = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(field.required ? `${field.label} (required)` : field.label);
  }
  return z.object({
    ...shape,
    rejected: z
      .boolean()
      .optional()
      .describe(
        "true when it turns out this person is not a prospect after all; false to undo that",
      ),
  });
}

function describeTool(intake: readonly WorkflowIntakeField[]): string {
  const checklist = intake
    .map((field) => `${field.label}${field.required ? " (required)" : ""}`)
    .join(", ");
  return [
    "Record this person as a sales lead. Call it only once you judge them a prospect (someone who may buy); never for support questions, complaints or small talk.",
    `Intake checklist, in order: ${checklist}. Ask for these naturally over the conversation and call again whenever you learn a new answer; send only the fields you have.`,
    "Never ask for their phone number: it comes from the channel.",
    "The campaign code is read from the first message automatically; do not ask for it.",
    "Do not score the lead; it is scored later.",
  ].join(" ");
}

export function makeRecordLeadTool(ctx: LeadCaptureContext) {
  const inputSchema = recordLeadInputSchema(ctx.intake);
  return tool({
    description: describeTool(ctx.intake),
    inputSchema,
    execute: async (input) => {
      const chatId = ctx.getChatId();
      if (!chatId) {
        return {
          success: false as const,
          error: "There is no conversation to attach this lead to yet",
        };
      }

      const values = input as Record<string, unknown>;
      const answers: Record<string, string | undefined> = {};
      for (const field of ctx.intake) {
        const value = values[field.key];
        if (typeof value === "string") answers[field.key] = value;
      }

      try {
        const result = await recordLead(
          ctx.store ?? pgLeadStore,
          { agentId: ctx.agentId, companyId: ctx.companyId, chatId },
          ctx.intake,
          {
            answers,
            // Omitted stays undefined: a partial call must not un-reject.
            rejected: typeof values.rejected === "boolean" ? values.rejected : undefined,
          },
        );

        if (!result.recorded) {
          return { success: true as const, recorded: false as const };
        }

        // The lead now exists, so a first reply that already went out can be
        // timed onto it. Best effort: a missing reply is a no-op inside.
        if (result.created) {
          try {
            await recordFirstResponse(chatId);
          } catch (error) {
            console.error("[record_lead] could not record the first response", result.id, error);
          }
        }

        let status: CompanyRecordStatus = result.status;
        if (ctx.scoreOnComplete && result.intakeComplete && status === "gathered") {
          // Notifies and opens the delivery card itself; never throws past here.
          try {
            const scored = await scoreLead({
              companyId: ctx.companyId,
              agentId: ctx.agentId,
              recordId: result.id,
              score: LEGACY_COMPLETE_SCORE,
              reasons: ["Intake checklist complete"],
              parent: { chatId },
            });
            if (!("error" in scored)) status = scored.status;
          } catch (error) {
            console.error("[record_lead] legacy scoring failed", result.id, error);
          }
          return {
            success: true as const,
            recorded: true as const,
            status,
            intakeComplete: result.intakeComplete,
            missing: result.missing,
          };
        }

        // A known number can land on a lead that is already qualified; the
        // notification claim makes this a no-op once it has been sent.
        if (result.status === "qualified") {
          try {
            await notifyQualifiedLead(result.id);
          } catch (error) {
            console.error("[record_lead] notification failed", result.id, error);
          }
        }

        return {
          success: true as const,
          recorded: true as const,
          status: result.status,
          intakeComplete: result.intakeComplete,
          missing: result.missing,
        };
      } catch (error) {
        if (error instanceof LeadScopeError) {
          return { success: false as const, error: error.message };
        }
        console.error("[record_lead] could not save the lead", error);
        return { success: false as const, error: "Lead could not be saved" };
      }
    },
  });
}
