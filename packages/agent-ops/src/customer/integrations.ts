import { and, eq } from "drizzle-orm";
import { db, integrations } from "@relay/db";
import { requireCompanyAccess } from "../auth/access";
import { maskIntegrationConfig } from "../shared/secrets";
import {
  createIntegrationSchema,
  updateIntegrationSchema,
  type CreateIntegrationInput,
  type UpdateIntegrationInput,
} from "./schemas";

async function requireOwnedIntegration(userId: string, integrationId: string) {
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, integrationId),
  });
  if (!integration) {
    throw new Error("Integration not found");
  }

  await requireCompanyAccess(userId, integration.companyId);

  return integration;
}

export async function listIntegrations(
  userId: string,
  companyId: string,
  agentId?: string,
) {
  await requireCompanyAccess(userId, companyId);

  const rows = await db.query.integrations.findMany({
    where: agentId
      ? and(
          eq(integrations.companyId, companyId),
          eq(integrations.agentId, agentId),
        )
      : eq(integrations.companyId, companyId),
  });

  return {
    integrations: rows.map((integration) => ({
      id: integration.id,
      name: integration.name,
      type: integration.type,
      companyId: integration.companyId,
      agentId: integration.agentId,
      status: integration.status,
      config: maskIntegrationConfig(integration.config),
      error: integration.error,
      lastSyncAt: integration.lastSyncAt,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    })),
  };
}

export async function createIntegration(
  userId: string,
  input: CreateIntegrationInput,
) {
  const parsed = createIntegrationSchema.parse(input);

  await requireCompanyAccess(userId, parsed.companyId);

  const [integration] = await db
    .insert(integrations)
    .values({
      name: parsed.name,
      type: parsed.type,
      companyId: parsed.companyId,
      agentId: parsed.agentId ?? null,
      config: parsed.config ?? {},
    })
    .returning({ id: integrations.id });

  return { id: integration.id };
}

export async function updateIntegration(
  userId: string,
  integrationId: string,
  input: UpdateIntegrationInput,
) {
  const parsed = updateIntegrationSchema.parse(input);
  await requireOwnedIntegration(userId, integrationId);

  await db
    .update(integrations)
    .set({
      ...parsed,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, integrationId));

  return { id: integrationId };
}

export async function deleteIntegration(
  userId: string,
  integrationId: string,
) {
  await requireOwnedIntegration(userId, integrationId);

  await db.delete(integrations).where(eq(integrations.id, integrationId));

  return { id: integrationId };
}
