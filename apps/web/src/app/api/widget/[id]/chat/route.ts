import { type UIMessage } from "ai";
import { checkTokenBudget } from "@/lib/ai/token-limiter";
import { db } from "@/db";
import { agents, companies, widgetConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { clearTyping } from "@/lib/handoff/typing";
import { proxyToWorker } from "@/lib/worker-proxy";
import {
  RATE_LIMIT_SURFACES,
  clientIp,
  enforceSurface,
  holdUntilStreamEnds,
  rateLimitedResponse,
} from "@/lib/rate-limit";

export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

function withWidgetCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return new Response(res.body, { status: res.status, headers });
}

/** Handle CORS preflight */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: widgetId } = await params;

  const visitorIp = clientIp(req.headers);

  const budget = await checkTokenBudget(visitorIp, "widget");
  if (!budget.allowed) {
    return new Response(
      JSON.stringify({
        error: "Weekly usage limit reached. Please try again later.",
        used: budget.used,
        limit: budget.limit,
        resetsAt: budget.resetsAt,
      }),
      {
        status: 429,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  const body = (await req.json()) as {
    messages: UIMessage[];
    chatId?: string;
  };

  const { messages, chatId } = body;

  if (!messages || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "Messages are required" }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.widgetId, widgetId),
  });

  if (!company) {
    return new Response(
      JSON.stringify({ error: "Widget not found" }),
      {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  const widgetConfig = await db.query.widgetConfigs.findFirst({
    where: eq(widgetConfigs.companyId, company.id),
  });

  if (widgetConfig?.agentId) {
    const configuredAgent = await db.query.agents.findFirst({
      where: eq(agents.id, widgetConfig.agentId),
    });

    if (!configuredAgent || configuredAgent.kind === "operator") {
      return new Response(
        JSON.stringify({ error: "Widget agent is invalid" }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }
  }

  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.widgetChat({
      companyId: company.id,
      visitor: visitorIp,
    }),
  );
  if (!limited.ok) {
    return rateLimitedResponse(limited.denial, CORS_HEADERS);
  }

  // The customer sent their message: stop showing them as typing (S62).
  if (typeof chatId === "string") clearTyping(chatId, "customer");

  return proxyToWorker({
    kind: "widget",
    messages,
    visitorId: visitorIp,
    companyId: company.id,
    chatId,
  })
    .then((res) => holdUntilStreamEnds(res, limited.release))
    .then(withWidgetCors);
}
