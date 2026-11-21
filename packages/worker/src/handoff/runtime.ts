import {
  getHandoffSettings,
  getLatestHandoffRequest,
  getTakeoverMessages,
  type HandoffAgentScope,
} from "./store";
import {
  buildHandoffPromptSection,
  enabledHandoffTriggers,
  waitingTextFor,
  type HandoffPromptContext,
} from "./prompt";
import type { AskHumanContext } from "./ask-human-tool";

export type HandoffRuntime = HandoffPromptContext & {
  /** A person has taken over: the agent must not reply. */
  paused: boolean;
};

/**
 * Everything one customer turn needs to know about human handoff. `chatId`
 * is null before the widget has created its conversation, which means no
 * request can exist yet.
 */
export async function loadHandoffRuntime(
  agent: HandoffAgentScope,
  chatId: string | null,
): Promise<HandoffRuntime> {
  const [settings, latest] = await Promise.all([
    getHandoffSettings(agent),
    chatId ? getLatestHandoffRequest(chatId) : Promise.resolve(null),
  ]);
  const takeoverMessages =
    latest?.status === "handed_back" ? await getTakeoverMessages(latest) : [];
  return {
    settings,
    latest,
    takeoverMessages,
    paused: latest?.status === "taken_over",
  };
}

/**
 * The tool option and prompt section for one turn. `ask_human` is offered
 * only when at least one trigger is on.
 */
export function handoffTurnOptions(
  runtime: HandoffRuntime,
  agent: HandoffAgentScope,
  companyName: string,
  getChatId: () => string | null,
): { askHuman?: AskHumanContext; handoffSection: string } {
  const handoffSection = buildHandoffPromptSection(runtime, companyName);
  if (enabledHandoffTriggers(runtime.settings).length === 0) {
    return { handoffSection };
  }
  return {
    handoffSection,
    askHuman: {
      agentId: agent.id,
      companyId: agent.companyId,
      getChatId,
      waitingText: waitingTextFor(runtime.settings, companyName),
    },
  };
}
