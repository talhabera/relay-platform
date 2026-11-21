import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chats, companies } from "@/db/schema";
import { requireCompanyMembership, requireOperatorAgentAccess } from "@/lib/operator/access";
import { isoWeekId, isoWeekRange } from "@/lib/time";
import type { LeadWindow } from "./session-leads";

// Gate for the Leads work pane, its CSV and its lead actions: the viewer is a
// member of the session's company and can steer its operator agent (the same
// gate as answering an agent question). lib/leads itself does no auth.

function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export type LeadSessionAccess = {
  userId: string;
  chatId: string;
  window: LeadWindow;
  weekId: string;
  timeZone: string;
};

/** The session's lead window: the ISO week it started in, company time. */
export function leadWindowFor(
  chat: { companyId: string; createdAt: Date },
  timeZone: string | null | undefined,
): Omit<LeadSessionAccess, "userId" | "chatId"> {
  const tz = safeTimeZone(timeZone);
  const range = isoWeekRange(chat.createdAt, tz);
  return {
    window: { companyId: chat.companyId, from: range.from, to: range.to },
    weekId: isoWeekId(chat.createdAt, tz),
    timeZone: tz,
  };
}

/** Throws `Not found` / `Unauthorized:` like the other operator gates. */
export async function requireLeadSession(chatId: string): Promise<LeadSessionAccess> {
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.channelType, "operator")),
    columns: { id: true, companyId: true, agentId: true, createdAt: true },
  });
  if (!chat?.agentId) throw new Error("Not found: session");

  await requireCompanyMembership(chat.companyId);
  const { session, agent } = await requireOperatorAgentAccess(chat.agentId);
  if (agent.companyId !== chat.companyId) {
    throw new Error("Unauthorized: You don't have access to this agent");
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, chat.companyId),
    columns: { timezone: true },
  });
  return {
    userId: session.user.id,
    chatId: chat.id,
    ...leadWindowFor(chat, company?.timezone),
  };
}
