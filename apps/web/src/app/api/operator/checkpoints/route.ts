import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chats, checkpoints } from "@/db/schema";
import { getSession } from "@/lib/auth-server";
import {
  requireCheckpointApprove,
  requireCompanyMembership,
  requireCustomerChatCheckpointApprove,
  requireOperatorSessionApprove,
} from "@/lib/operator/access";
import {
  checkpointCardView,
  type CheckpointCardView,
} from "@/lib/operator/checkpoint-card-view";

/**
 * GET /api/operator/checkpoints?chatId=… | ?runId=…
 *
 * The Checkpoint cards of one operator session, customer conversation
 * (W3GAP2 lead_delivery) or Schedule run, as this viewer sees them (S45).
 * Viewing needs company membership (owner or member; client users never
 * pass). Actions are listed only for approvers, by the same checks the
 * action routes enforce.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId");
  const runId = url.searchParams.get("runId");
  if (!chatId === !runId) {
    return new Response("Pass exactly one of chatId or runId", { status: 400 });
  }

  if (chatId) {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      columns: { id: true, companyId: true, channelType: true },
    });
    if (!chat?.companyId) {
      return new Response("Not found", { status: 404 });
    }
    try {
      await requireCompanyMembership(chat.companyId);
    } catch {
      return new Response("Forbidden", { status: 403 });
    }

    const rows = await db.query.checkpoints.findMany({
      where: eq(checkpoints.chatId, chatId),
      orderBy: asc(checkpoints.createdAt),
    });
    const onCustomerChat = chat.channelType !== "operator";

    let sessionApprover: boolean | null = null;
    const customerApprover = new Map<string, boolean>();
    const cards: CheckpointCardView[] = [];
    for (const row of rows) {
      let canApprove: boolean;
      if (onCustomerChat) {
        const cached = customerApprover.get(row.agentId);
        canApprove =
          cached ??
          (await passes(() =>
            requireCustomerChatCheckpointApprove({
              chatId,
              agentId: row.agentId,
              companyId: row.companyId,
            }),
          ));
        customerApprover.set(row.agentId, canApprove);
      } else {
        sessionApprover ??= await passes(() =>
          requireOperatorSessionApprove(chatId),
        );
        canApprove = sessionApprover;
      }
      cards.push(checkpointCardView(row, { canApprove, onCustomerChat }));
    }
    return Response.json({ checkpoints: cards });
  }

  const rows = await db.query.checkpoints.findMany({
    where: eq(checkpoints.cronRunId, runId!),
    orderBy: asc(checkpoints.createdAt),
  });
  if (rows.length === 0) {
    return Response.json({ checkpoints: [] });
  }
  try {
    await requireCompanyMembership(rows[0].companyId);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const approver = new Map<string, boolean>();
  const cards: CheckpointCardView[] = [];
  for (const row of rows) {
    const canApprove =
      approver.get(row.agentId) ??
      (await passes(() => requireCheckpointApprove(row.agentId)));
    approver.set(row.agentId, canApprove);
    cards.push(checkpointCardView(row, { canApprove }));
  }
  return Response.json({ checkpoints: cards });
}

async function passes(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch {
    return false;
  }
}
