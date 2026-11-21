import { type UIMessage } from "ai";
import { checkTokenBudget } from "@/lib/ai/token-limiter";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth-server";
import { requireOperatorAgentAccess } from "@/lib/operator/access";
import { assertPageAccess } from "@/lib/page-access";
import { proxyToWorker } from "@/lib/worker-proxy";
import {
  RATE_LIMIT_SURFACES,
  enforceSurface,
  holdUntilStreamEnds,
  rateLimitedResponse,
} from "@/lib/rate-limit";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    chatId?: string;
    messages: UIMessage[];
  };

  const { chatId, messages } = body;

  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!chatId) {
    return new Response("Chat ID is required", { status: 400 });
  }

  if (!messages || messages.length === 0) {
    return new Response("Messages are required", { status: 400 });
  }

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (!chat) {
    return new Response("Chat not found", { status: 404 });
  }

  if (chat.channelType !== "operator" || !chat.versionId) {
    return new Response("Invalid operator session", { status: 400 });
  }

  if (!chat.agentId) {
    return new Response("Invalid operator session", { status: 400 });
  }

  try {
    const access = await requireOperatorAgentAccess(chat.agentId);
    await assertPageAccess(access.session.user.id, access.agent.company, [
      "operator",
    ]);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (chat.userId !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  const budget = await checkTokenBudget(session.user.id, "user");
  if (!budget.allowed) {
    return Response.json(
      {
        error: "Weekly token limit reached",
        used: budget.used,
        limit: budget.limit,
        resetsAt: budget.resetsAt,
      },
      { status: 429 },
    );
  }

  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.operatorChat({
      userId: session.user.id,
      companyId: chat.companyId,
      chatId,
    }),
  );
  if (!limited.ok) {
    return rateLimitedResponse(limited.denial);
  }

  return holdUntilStreamEnds(
    await proxyToWorker({
      kind: "operator",
      chatId,
      messages,
      userId: session.user.id,
    }),
    limited.release,
  );
}
