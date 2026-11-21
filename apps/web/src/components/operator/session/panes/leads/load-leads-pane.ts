import { leadWindowFor } from "@/lib/leads/session-access";
import { loadSessionLeads } from "@/lib/leads/session-leads";
import { weekRangeLabel } from "@/app/(dashboard)/operator/_overview/overview-model";
import type { LeadsPaneProps } from "./leads-pane";

/** Session types that get the Leads work pane: the Revenue / lead packages. */
export function hasLeadsPane(packageSlug: string | null | undefined): boolean {
  return packageSlug === "revenue";
}

/**
 * Leads work pane props for a session the page already authorized (company
 * membership + operator access). `canAct` is the steer gate for overrides;
 * the server action checks it again.
 */
export async function loadLeadsPane(args: {
  chat: { id: string; companyId: string; createdAt: Date };
  timeZone: string | null;
  openQuestion: boolean;
  canAct: boolean;
}): Promise<LeadsPaneProps> {
  const { window, weekId, timeZone } = leadWindowFor(args.chat, args.timeZone);
  const { counts, tabs } = await loadSessionLeads(window);
  return {
    chatId: args.chat.id,
    weekId,
    rangeLabel: weekRangeLabel(window, timeZone),
    counts,
    tabs,
    openQuestion: args.openQuestion,
    canAct: args.canAct,
  };
}
