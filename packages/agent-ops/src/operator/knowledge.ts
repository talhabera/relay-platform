import { eq } from "drizzle-orm";
import { db, knowledgeBase } from "@relay/db";
import { requireOperatorAgentEdit } from "../auth/access";
import {
  createKnowledgeEntrySchema,
  createKnowledgeFromWebsiteSchema,
  updateKnowledgeEntrySchema,
  type CreateKnowledgeEntryInput,
  type CreateKnowledgeFromWebsiteInput,
  type UpdateKnowledgeEntryInput,
} from "../customer/schemas";

function assertOperatorAgent(
  agent: { kind: string },
  action: "accessed" | "updated" | "deleted",
) {
  if (agent.kind !== "operator") {
    const messages = {
      accessed: "Only operator agents can be accessed",
      updated: "Only operator agents can be updated",
      deleted: "Only operator agents can be deleted",
    } as const;
    throw new Error(messages[action]);
  }
}

async function requireOperatorKnowledgeEntry(userId: string, knowledgeId: string) {
  const entry = await db.query.knowledgeBase.findFirst({
    where: eq(knowledgeBase.id, knowledgeId),
  });
  if (!entry) {
    throw new Error("Knowledge entry not found");
  }

  const { agent } = await requireOperatorAgentEdit(userId, entry.agentId);
  assertOperatorAgent(agent, "accessed");

  return { entry, agent };
}

export async function listKnowledge(userId: string, agentId: string) {
  const { agent } = await requireOperatorAgentEdit(userId, agentId);
  assertOperatorAgent(agent, "accessed");

  const entries = await db.query.knowledgeBase.findMany({
    where: eq(knowledgeBase.agentId, agentId),
  });

  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      type: entry.type,
      content: entry.content,
      sourceUrl: entry.sourceUrl,
      metadata: entry.metadata,
      status: entry.status,
      errorMessage: entry.errorMessage,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
  };
}

export async function createTextKnowledge(
  userId: string,
  input: CreateKnowledgeEntryInput,
) {
  const parsed = createKnowledgeEntrySchema.parse(input);

  const { agent } = await requireOperatorAgentEdit(userId, parsed.agentId);
  assertOperatorAgent(agent, "accessed");

  const [entry] = await db
    .insert(knowledgeBase)
    .values({
      name: parsed.name,
      description: parsed.description ?? null,
      agentId: parsed.agentId,
      companyId: parsed.companyId,
      type: parsed.type === "file" ? "file" : "api",
      content: parsed.content ?? null,
      fileType: parsed.fileType ?? null,
      fileSize: parsed.fileSize ?? null,
      status: "ready",
    })
    .returning({ id: knowledgeBase.id });

  return { id: entry.id };
}

export async function beginWebsiteKnowledge(
  userId: string,
  input: CreateKnowledgeFromWebsiteInput,
) {
  const parsed = createKnowledgeFromWebsiteSchema.parse(input);

  const { agent } = await requireOperatorAgentEdit(userId, parsed.agentId);
  assertOperatorAgent(agent, "accessed");

  const [entry] = await db
    .insert(knowledgeBase)
    .values({
      name: parsed.name || new URL(parsed.url).hostname,
      description: parsed.description ?? null,
      agentId: parsed.agentId,
      companyId: parsed.companyId,
      type: "website",
      sourceUrl: parsed.url,
      status: "processing",
    })
    .returning({ id: knowledgeBase.id });

  return { id: entry.id, status: "processing" as const };
}

export async function completeWebsiteKnowledge(
  userId: string,
  entryId: string,
  input: {
    content: string;
    metadata: NonNullable<(typeof knowledgeBase.$inferSelect)["metadata"]>;
    name?: string;
  },
) {
  const { entry } = await requireOperatorKnowledgeEntry(userId, entryId);

  await db
    .update(knowledgeBase)
    .set({
      content: input.content,
      metadata: input.metadata,
      name: input.name ?? entry.name,
      status: "ready",
      updatedAt: new Date(),
    })
    .where(eq(knowledgeBase.id, entryId));

  return { id: entryId, status: "ready" as const };
}

export async function failWebsiteKnowledge(
  userId: string,
  entryId: string,
  errorMessage: string,
) {
  await requireOperatorKnowledgeEntry(userId, entryId);

  await db
    .update(knowledgeBase)
    .set({
      status: "error",
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeBase.id, entryId));

  return { id: entryId, status: "error" as const };
}

export async function updateKnowledge(
  userId: string,
  knowledgeId: string,
  input: UpdateKnowledgeEntryInput,
) {
  const parsed = updateKnowledgeEntrySchema.parse(input);
  await requireOperatorKnowledgeEntry(userId, knowledgeId);

  await db
    .update(knowledgeBase)
    .set({
      ...parsed,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeBase.id, knowledgeId));

  return { id: knowledgeId };
}

export async function deleteKnowledge(userId: string, knowledgeId: string) {
  await requireOperatorKnowledgeEntry(userId, knowledgeId);

  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, knowledgeId));

  return { id: knowledgeId };
}
