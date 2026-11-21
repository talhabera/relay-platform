import { eq } from "drizzle-orm";
import { chats, PORTAL_EVENT_CHANNELS, type PortalEventChannel } from "@/db/schema";
import { emitPortalEvent, type PortalEventExecutor } from "@/lib/live/portal-events";
import type { HandoffRequest } from "./requests";

const CHANNELS: ReadonlySet<string> = new Set(PORTAL_EVENT_CHANNELS);

const DETAIL_MAX = 140;

function channelOf(channelType: string | null | undefined): PortalEventChannel | null {
  return channelType && CHANNELS.has(channelType) ? (channelType as PortalEventChannel) : null;
}

function clip(text: string): string {
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

/**
 * Live feed `handoff_sent` (S101): a person took a handoff request through its
 * quick link or Answer now, i.e. the request's first answer or takeover. Call
 * it inside the transaction of that status move, once per request.
 */
export async function emitHandoffSent(
  executor: PortalEventExecutor,
  request: Pick<HandoffRequest, "id" | "companyId" | "chatId" | "recipientName" | "questions">,
  at: Date,
): Promise<void> {
  const [chat] = await executor
    .select({ channelType: chats.channelType })
    .from(chats)
    .where(eq(chats.id, request.chatId))
    .limit(1);
  const name = request.recipientName?.trim() || "the team";
  const question = request.questions[0]?.text?.trim() ?? "";
  await emitPortalEvent(executor, {
    companyId: request.companyId,
    type: "handoff_sent",
    title: `Handoff sent to ${name}`,
    detail: clip(question),
    channel: channelOf(chat?.channelType),
    refId: request.id,
    at,
  });
}
