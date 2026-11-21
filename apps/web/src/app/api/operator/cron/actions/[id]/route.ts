import { db } from "@/db";
import { checkpoints, cronRunMessages } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { getSession } from "@/lib/auth-server";
import {
  RATE_LIMIT_SURFACES,
  enforceSurface,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { requireCheckpointApprove } from "@/lib/operator/access";
import { pokeCronContinue } from "@/lib/operator/cron-continue";
import { resolveCheckpoint } from "@/lib/operator/resolve-action";
import {
  checkpointActionBodySchema,
  checkpointToolResult,
} from "@/lib/operator/checkpoint-actions";

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
    where: and(eq(checkpoints.id, id), isNotNull(checkpoints.cronRunId)),
  });

  if (!pending || !pending.cronRunId) {
    return new Response("Pending action not found", { status: 404 });
  }

  try {
    await requireCheckpointApprove(pending.agentId);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.cronApproval({
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
  });

  if (!result.ok) {
    return Response.json(
      { status: result.status },
      { status: result.httpStatus },
    );
  }

  // A Refresh already waiting on the agent. Do not repeat the transcript
  // messages or poke the run twice.
  if (result.alreadyRequested) {
    return Response.json({ status: result.status });
  }

  // The run transcript carries the outcome; the reply box feedback (Ask for
  // changes) and Refresh resume the run as the person's direction.
  await db.insert(cronRunMessages).values({
    runId: pending.cronRunId,
    role: "tool",
    content: JSON.stringify(
      checkpointToolResult(id, result.status, result.executeResult),
    ),
  });
  const direction =
    body.data.action === "ask_for_changes"
      ? body.data.feedback?.trim()
      : body.data.action === "refresh"
        ? "The draft changed. Propose a fresh card from the current draft."
        : null;
  if (direction) {
    await db.insert(cronRunMessages).values({
      runId: pending.cronRunId,
      role: "user",
      content: direction,
    });
  }

  await pokeCronContinue(pending.cronRunId);

  return Response.json({ status: result.status });
}
