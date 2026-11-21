import { getSession } from "@/lib/auth-server";
import {
  agentQuestionAnswerSchema,
  answerAgentQuestion,
  requireAgentQuestionAnswer,
} from "@/lib/operator/agent-questions";

/**
 * Answer an agent question (checkpoints spec decisions 8-12). Anyone who can
 * steer the agent may answer. A session question returns `resume.kind =
 * "session"`: the client then sends the answer as the chat message so the
 * agent resumes in the stream. A run question is resumed here (cron poked).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = agentQuestionAnswerSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response("Invalid request body", { status: 400 });

  try {
    await requireAgentQuestionAnswer(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return message.startsWith("Unauthorized")
      ? new Response("Forbidden", { status: 403 })
      : new Response("Not found", { status: 404 });
  }

  const result = await answerAgentQuestion({
    questionId: id,
    userId: session.user.id,
    answer: body.data.answer,
  });
  if (!result.ok) {
    const text = result.httpStatus === 409 ? "Already answered" : "Could not answer";
    return new Response(text, { status: result.httpStatus });
  }
  return Response.json({ resume: result.resume });
}
