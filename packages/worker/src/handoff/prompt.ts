import { HANDOFF_LOW_CONFIDENCE_THRESHOLD, type HandoffTrigger } from "@relay/db";
import type { HandoffRequestRow, HandoffSettingsRow } from "./store";

/** The tool name the model sees. */
export const ASK_HUMAN_TOOL_NAME = "ask_human";

/** Prompt wording for each fixed trigger. The threshold is fixed, not a setting. */
export const HANDOFF_TRIGGER_RULES: Record<HandoffTrigger, string> = {
  price_not_listed:
    "The customer asks for a price that is not in your price list or knowledge base.",
  asks_for_person: "The customer asks to talk to a person.",
  complaint_or_refund: "The customer makes a complaint or asks for a refund.",
  low_confidence: `You are less than ${HANDOFF_LOW_CONFIDENCE_THRESHOLD}% confident in your answer.`,
};

export function enabledHandoffTriggers(
  settings: Pick<
    HandoffSettingsRow,
    | "triggerPriceNotListed"
    | "triggerAsksForPerson"
    | "triggerComplaintOrRefund"
    | "triggerLowConfidence"
  >,
): HandoffTrigger[] {
  const enabled: HandoffTrigger[] = [];
  if (settings.triggerPriceNotListed) enabled.push("price_not_listed");
  if (settings.triggerAsksForPerson) enabled.push("asks_for_person");
  if (settings.triggerComplaintOrRefund) enabled.push("complaint_or_refund");
  if (settings.triggerLowConfidence) enabled.push("low_confidence");
  return enabled;
}

/** "Customer sees while waiting" when the agent has no text of its own. */
export function defaultWaitingText(companyName: string): string {
  return `I've asked a colleague at ${companyName} and will get back to you here as soon as I hear back.`;
}

export function waitingTextFor(
  settings: Pick<HandoffSettingsRow, "waitingText">,
  companyName: string,
): string {
  return settings.waitingText?.trim() || defaultWaitingText(companyName);
}

export type HandoffPromptContext = {
  settings: HandoffSettingsRow;
  /** The conversation's latest handoff request, if any. */
  latest: HandoffRequestRow | null;
  /** The person's messages during a takeover that has been handed back. */
  takeoverMessages: { content: string; authorDisplayName: string | null }[];
};

function quoteList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * The "Human handoff" part of the customer system prompt: the enabled
 * triggers, and what the agent must know about the conversation's request.
 * Returns "" when there is nothing to say (no trigger on and no request).
 */
export function buildHandoffPromptSection(
  ctx: HandoffPromptContext,
  companyName: string,
): string {
  const triggers = enabledHandoffTriggers(ctx.settings);
  const waiting = waitingTextFor(ctx.settings, companyName);
  const parts: string[] = [];

  if (triggers.length > 0) {
    parts.push(`You can ask a colleague at ${companyName} with the ${ASK_HUMAN_TOOL_NAME} tool. Call it when any of these is true:
${quoteList(triggers.map((t) => HANDOFF_TRIGGER_RULES[t]))}
Pass the reason (which rule applies and why), your confidence (0-100), the exact question for the colleague, and up to 5 short replies they could pick from.
After calling it, tell the customer: "${waiting}" Then keep helping with anything else you can answer. Never guess the answer you asked about.`);
  }

  const latest = ctx.latest;
  if (latest?.status === "open") {
    const asked = (latest.questions ?? []).map((q) => q.text);
    parts.push(`You have already asked a colleague and are waiting for the answer to:
${quoteList(asked)}
Do not guess these answers. If the customer asks about them, tell them: "${waiting}" Keep answering anything else you can. Another hard question goes through ${ASK_HUMAN_TOOL_NAME} too; it is added to the same request.`);
  } else if (
    latest?.status === "answered" &&
    latest.replyMode === "agent" &&
    latest.answer
  ) {
    const asked = (latest.questions ?? []).map((q) => q.text);
    parts.push(`A colleague answered your question:
${quoteList(asked)}
Their answer, which you should treat as a fact: "${latest.answer}"
Give the customer this answer in your own words if you have not already.`);
  } else if (latest?.status === "handed_back" && ctx.takeoverMessages.length > 0) {
    const lines = ctx.takeoverMessages.map(
      (m) => `${m.authorDisplayName ?? "Colleague"}: ${m.content}`,
    );
    parts.push(`A colleague took over this conversation for a while and has handed it back to you. What they wrote to the customer:
${quoteList(lines)}
Continue from there. Do not contradict what they said.`);
  }

  if (parts.length === 0) return "";
  return `## Human handoff\n${parts.join("\n\n")}`;
}
