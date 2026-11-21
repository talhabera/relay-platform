import { type UIMessage } from "ai";
import { checkTokenBudget } from "@/lib/ai/token-limiter";
import { db } from "@/db";
import { agents, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth-server";
import { proxyToWorker } from "@/lib/worker-proxy";
import {
  RATE_LIMIT_SURFACES,
  enforceSurface,
  holdUntilStreamEnds,
  rateLimitedResponse,
} from "@/lib/rate-limit";

export const maxDuration = 30;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    agentId?: string;
    companyId?: string;
    chatId?: string;
  };

  const { messages, agentId, companyId, chatId } = body;

  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
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

  if (!companyId) {
    return new Response("Company ID is required", { status: 400 });
  }

  if (!messages || messages.length === 0) {
    return new Response("Messages are required", { status: 400 });
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });

  // Customer agents are owner-only (see requireCompanyAccess). The companyId
  // also selects whose rate-limit settings apply, so it must be the caller's.
  if (!company || company.ownerId !== session.user.id) {
    return new Response("Company not found", { status: 404 });
  }

  if (agentId) {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });

    if (agent && agent.companyId !== companyId) {
      return new Response("Agent not found", { status: 404 });
    }

    if (agent && agent.kind === "operator") {
      return new Response("Operator agents cannot be used on this endpoint", {
        status: 400,
      });
    }
  }

  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.customerChat({
      userId: session.user.id,
      companyId,
      chatId,
    }),
  );
  if (!limited.ok) {
    return rateLimitedResponse(limited.denial);
  }

  return holdUntilStreamEnds(
    await proxyToWorker({
      kind: "customer",
      messages,
      agentId,
      companyId,
      chatId,
      userId: session.user.id,
    }),
    limited.release,
  );
}
