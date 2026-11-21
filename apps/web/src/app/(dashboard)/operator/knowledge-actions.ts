"use server";

import { revalidatePath } from "next/cache";
import {
  createOperatorTextKnowledge,
  beginOperatorWebsiteKnowledge,
  completeOperatorWebsiteKnowledge,
  failOperatorWebsiteKnowledge,
  updateOperatorKnowledge,
  deleteOperatorKnowledge,
} from "@relay/agent-ops";
import { requireSession } from "@/lib/auth-server";
import { processWebsiteContent } from "@/lib/ai/content-processor";
import { RATE_LIMIT_SURFACES, assertWithinLimits } from "@/lib/rate-limit";
import {
  createKnowledgeFromWebsiteSchema,
  type CreateKnowledgeEntryInput,
  type CreateKnowledgeFromWebsiteInput,
  type UpdateKnowledgeEntryInput,
} from "@/lib/validators/knowledge";

export async function createOperatorKnowledgeEntry(
  data: CreateKnowledgeEntryInput,
) {
  const session = await requireSession();
  const result = await createOperatorTextKnowledge(session.user.id, data);
  revalidatePath("/operator");
  revalidatePath("/agents/operator");
  return result;
}

export async function createOperatorKnowledgeFromWebsite(
  data: CreateKnowledgeFromWebsiteInput,
) {
  const session = await requireSession();
  const parsed = createKnowledgeFromWebsiteSchema.parse(data);
  await assertWithinLimits(
    RATE_LIMIT_SURFACES.knowledgeIngest({ userId: session.user.id }),
  );
  const { id } = await beginOperatorWebsiteKnowledge(session.user.id, parsed);

  try {
    const { markdown, metadata } = await processWebsiteContent(parsed.url);
    const result = await completeOperatorWebsiteKnowledge(session.user.id, id, {
      content: markdown,
      metadata,
      name:
        parsed.name || metadata.title || new URL(parsed.url).hostname,
    });
    revalidatePath("/operator");
    revalidatePath("/agents/operator");
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const result = await failOperatorWebsiteKnowledge(
      session.user.id,
      id,
      message,
    );
    revalidatePath("/operator");
    revalidatePath("/agents/operator");
    return { ...result, error: message };
  }
}

export async function updateOperatorKnowledgeEntry(
  id: string,
  data: UpdateKnowledgeEntryInput,
) {
  const session = await requireSession();
  await updateOperatorKnowledge(session.user.id, id, data);
  revalidatePath("/operator");
  revalidatePath("/agents/operator");
}

export async function deleteOperatorKnowledgeEntry(id: string) {
  const session = await requireSession();
  await deleteOperatorKnowledge(session.user.id, id);
  revalidatePath("/operator");
  revalidatePath("/agents/operator");
}
