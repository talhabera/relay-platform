import { db } from "@/db";
import { messages, checkpoints, chats } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { getSession } from "@/lib/auth-server";
import {
  RATE_LIMIT_SURFACES,
  enforceSurface,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import {
  requireCustomerChatCheckpointApprove,
  requireOperatorSessionApprove,
} from "@/lib/operator/access";
import type { CheckpointAction } from "@/lib/operator/approvals";
import { resolveCheckpoint } from "@/lib/operator/resolve-action";
import {
  checkpointActionBodySchema,
  checkpointToolResult,
} from "@/lib/operator/checkpoint-actions";

/**
 * Actions a card on a customer conversation takes (W3GAP2). No agent loop
 * answers on that chat, so Ask for changes and Refresh have nobody to act.
 */
const CUSTOMER_CHAT_ACTIONS: ReadonlySet<CheckpointAction> = new Set([
  "approve",
  "discard",
  "retry",
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const body = checkpointActionBodySchema.safeParse(await req.json());
  if (!body.success) {
    return new Response("Invalid request body", { status: 400 });
  }

  const pending = await db.query.checkpoints.findFirst({
    where: and(eq(checkpoints.id, id), isNotNull(checkpoints.chatId)),
  });

  if (!pending || !pending.chatId) {
    return new Response("Pending action not found", { status: 404 });
  }

  // Pick the approve check by parent kind. Cron-run cards go through
  // /api/operator/cron/actions/:id. An operator session keeps its own check;
  // anything else is a customer conversation (lead_delivery on the lead's
  // chat, W3GAP2).
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, pending.chatId),
    columns: { channelType: true },
  });
  const onCustomerChat = !!chat && chat.channelType !== "operator";

  try {
    if (onCustomerChat) {
      await requireCustomerChatCheckpointApprove({
        chatId: pending.chatId,
        agentId: pending.agentId,
        companyId: pending.companyId,
      });
    } else {
      await requireOperatorSessionApprove(pending.chatId);
    }
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (onCustomerChat && !CUSTOMER_CHAT_ACTIONS.has(body.data.action)) {
    return new Response("Action not available on this card", { status: 400 });
  }

  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.operatorApproval({
      userId: session.user.id,
      companyId: pending.companyId,
    }),
  );
  if (!limited.ok) {
    return rateLimitedResponse(limited.denial);
  }

  const result = await resolveCheckpoint({
    checkpointId: id,
    action: body.data.action,
    feedback: body.data.feedback,
    userId: session.user.id,
    ...(onCustomerChat ? { syncSession: false } : {}),
  });

  if (!result.ok) {
    return Response.json(
      { status: result.status },
      { status: result.httpStatus },
    );
  }

  // A Refresh already waiting on the agent. Do not write a second tool
  // result to the session.
  if (result.alreadyRequested) {
    return Response.json({ status: result.status });
  }

  // The customer conversation is not an agent session: no tool result goes
  // into its transcript.
  if (onCustomerChat) {
    return Response.json({ status: result.status });
  }

  await db.insert(messages).values({
    chatId: pending.chatId,
    role: "tool",
    content: JSON.stringify(
      checkpointToolResult(id, result.status, result.executeResult),
    ),
  });

  return Response.json({ status: result.status });
}
