import { and, count, eq } from "drizzle-orm";
import {
  agents,
  channels,
  db,
  integrations,
  knowledgeBase,
} from "@relay/db";
import { requireAgentAccess, requireCompanyAccess } from "../auth/access";
import {
  createAgentSchema,
  updateAgentSchema,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "./schemas";

function assertCustomerAgent(
  agent: { kind: string },
  action: "accessed" | "updated" | "deleted",
) {
  if (agent.kind !== "customer") {
    const messages = {
      accessed: "Only customer agents in this company can be accessed",
      updated: "Only customer agents in this company can be updated",
      deleted: "Only customer agents in this company can be deleted",
    } as const;
    throw new Error(messages[action]);
  }
}

async function countAgentRows(
  table:
    | typeof channels
    | typeof integrations
    | typeof knowledgeBase,
  agentId: string,
) {
  const [row] = await db
    .select({ count: count() })
    .from(table)
    .where(eq(table.agentId, agentId));

  return row?.count ?? 0;
}

export async function listCustomerAgents(userId: string, companyId: string) {
  await requireCompanyAccess(userId, companyId);

  const customerAgents = await db.query.agents.findMany({
    where: and(eq(agents.companyId, companyId), eq(agents.kind, "customer")),
  });

  return {
    agents: customerAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      model: agent.model,
      isActive: agent.isActive,
      persona: agent.persona,
      language: agent.language,
      responseLength: agent.responseLength,
      memoryEnabled: agent.memoryEnabled,
    })),
  };
}

export async function getCustomerAgent(userId: string, agentId: string) {
  const { agent } = await requireAgentAccess(userId, agentId);
  assertCustomerAgent(agent, "accessed");

  const [channelCount, integrationCount, knowledgeCount] = await Promise.all([
    countAgentRows(channels, agentId),
    countAgentRows(integrations, agentId),
    countAgentRows(knowledgeBase, agentId),
  ]);

  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    companyId: agent.companyId,
    isActive: agent.isActive,
    responseLength: agent.responseLength,
    language: agent.language,
    memoryEnabled: agent.memoryEnabled,
    persona: agent.persona,
    kind: agent.kind,
    model: agent.model,
    packageSlug: agent.packageSlug,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    channelCount,
    integrationCount,
    knowledgeCount,
  };
}

export async function createCustomerAgent(
  userId: string,
  input: CreateAgentInput,
) {
  const parsed = createAgentSchema.parse(input);
  await requireCompanyAccess(userId, parsed.companyId);

  const [agent] = await db
    .insert(agents)
    .values({
      name: parsed.name,
      description: parsed.description ?? null,
      companyId: parsed.companyId,
      kind: "customer",
      model: "haiku",
    })
    .returning({ id: agents.id });

  return { id: agent.id };
}

export async function updateCustomerAgent(
  userId: string,
  agentId: string,
  input: UpdateAgentInput,
) {
  const { agent } = await requireAgentAccess(userId, agentId);
  assertCustomerAgent(agent, "updated");

  const parsed = updateAgentSchema.parse(input);

  await db
    .update(agents)
    .set({
      ...parsed,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));

  return { id: agentId };
}

export async function deleteCustomerAgent(userId: string, agentId: string) {
  const { agent } = await requireAgentAccess(userId, agentId);
  assertCustomerAgent(agent, "deleted");

  await db.delete(agents).where(eq(agents.id, agentId));

  return { id: agentId };
}
