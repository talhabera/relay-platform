import { and, eq } from "drizzle-orm";
import {
  agents,
  agentVersions,
  db,
  DEFAULT_TOOL_TOGGLES,
  operatorAgentEditors,
} from "@relay/db";
import {
  requireCompanyMembership,
  requireOperatorAgentAccess,
  requireOperatorAgentEdit,
} from "../auth/access";
import {
  createOperatorAgentSchema,
  forkVersionSchema,
  updateOperatorVersionSchema,
  type CreateOperatorAgentInput,
  type UpdateOperatorVersionInput,
} from "./schemas";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

async function canEditOperatorAgent(
  userId: string,
  agent: { id: string; createdByUserId: string | null },
): Promise<boolean> {
  if (agent.createdByUserId === userId) {
    return true;
  }

  const editor = await db.query.operatorAgentEditors.findFirst({
    where: and(
      eq(operatorAgentEditors.agentId, agent.id),
      eq(operatorAgentEditors.userId, userId),
    ),
  });

  return editor?.canEdit === true;
}

export async function listOperatorAgents(userId: string, companyId: string) {
  await requireCompanyMembership(userId, companyId);

  const operatorAgents = await db.query.agents.findMany({
    where: and(eq(agents.companyId, companyId), eq(agents.kind, "operator")),
    with: {
      versions: {
        orderBy: (versions, { desc }) => [desc(versions.createdAt)],
      },
    },
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });

  const mappedAgents = await Promise.all(
    operatorAgents.map(async (agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      packageSlug: agent.packageSlug,
      createdByUserId: agent.createdByUserId,
      canEdit: await canEditOperatorAgent(userId, agent),
      versions: agent.versions.map((version) => ({
        id: version.id,
        name: version.name,
        status: version.status,
        model: version.model,
        parentVersionId: version.parentVersionId,
        createdAt: version.createdAt,
      })),
    })),
  );

  return { agents: mappedAgents };
}

export async function getOperatorAgent(userId: string, agentId: string) {
  const { agent } = await requireOperatorAgentAccess(userId, agentId);

  const [versions, editors] = await Promise.all([
    db.query.agentVersions.findMany({
      where: eq(agentVersions.agentId, agentId),
      orderBy: (versions, { desc }) => [desc(versions.createdAt)],
    }),
    db.query.operatorAgentEditors.findMany({
      where: and(
        eq(operatorAgentEditors.agentId, agentId),
        eq(operatorAgentEditors.canEdit, true),
      ),
      with: { user: true },
    }),
  ]);

  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    companyId: agent.companyId,
    packageSlug: agent.packageSlug,
    createdByUserId: agent.createdByUserId,
    versions: versions.map((version) => ({
      id: version.id,
      name: version.name,
      status: version.status,
      model: version.model,
      instructions: version.instructions,
      toolToggles: version.toolToggles,
      parentVersionId: version.parentVersionId,
      createdAt: version.createdAt,
    })),
    editors: editors.map((editor) => ({
      userId: editor.userId,
      name: editor.user.name,
      email: editor.user.email,
    })),
  };
}

export async function createOperatorAgent(
  userId: string,
  input: CreateOperatorAgentInput,
) {
  const parsed = createOperatorAgentSchema.parse(input);
  await requireCompanyMembership(userId, parsed.companyId);

  const [agent] = await db
    .insert(agents)
    .values({
      name: parsed.name,
      description: parsed.description ?? null,
      companyId: parsed.companyId,
      kind: "operator",
      createdByUserId: userId,
    })
    .returning({ id: agents.id });

  const [version] = await db
    .insert(agentVersions)
    .values({
      agentId: agent.id,
      name: "v1",
      instructions: "",
      toolToggles: DEFAULT_TOOL_TOGGLES,
      status: "live",
      model: "haiku",
      createdByUserId: userId,
    })
    .returning({ id: agentVersions.id });

  return { id: agent.id, versionId: version.id };
}

export async function updateOperatorVersion(
  userId: string,
  versionId: string,
  input: UpdateOperatorVersionInput,
) {
  const parsed = updateOperatorVersionSchema.parse(input);

  const version = await db.query.agentVersions.findFirst({
    where: eq(agentVersions.id, versionId),
  });

  if (!version) {
    throw new Error("Version not found");
  }

  await requireOperatorAgentEdit(userId, version.agentId);

  await db
    .update(agentVersions)
    .set({
      ...(parsed.instructions !== undefined
        ? { instructions: parsed.instructions }
        : {}),
      ...(parsed.toolToggles !== undefined
        ? { toolToggles: parsed.toolToggles }
        : {}),
      ...(parsed.model !== undefined ? { model: parsed.model } : {}),
    })
    .where(eq(agentVersions.id, versionId));

  return { versionId };
}

export async function forkOperatorVersion(
  userId: string,
  agentId: string,
  parentVersionId: string,
  name: string,
  changeNote?: string,
) {
  await requireOperatorAgentEdit(userId, agentId);
  const parsed = forkVersionSchema.parse({ name, changeNote });

  const parent = await db.query.agentVersions.findFirst({
    where: and(
      eq(agentVersions.id, parentVersionId),
      eq(agentVersions.agentId, agentId),
    ),
  });

  if (!parent) {
    throw new Error("Parent version not found");
  }

  try {
    const [version] = await db
      .insert(agentVersions)
      .values({
        agentId,
        name: parsed.name,
        parentVersionId: parent.id,
        instructions: parent.instructions,
        toolToggles: parent.toolToggles,
        status: "draft",
        model: parent.model,
        changeNote: parsed.changeNote || null,
        createdByUserId: userId,
      })
      .returning({ id: agentVersions.id });

    return { id: version.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Version name already exists");
    }
    throw error;
  }
}
