"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import {
  isConnectorAvailable,
  isConnectorCatalogType,
  isOAuthConnectorType,
  isOperatorConnectorType,
  type AvailableConnectorType,
  type OperatorConnectorType,
} from "@relay/db";
import { db } from "@/db";
import { integrations, type IntegrationConfig } from "@/db/schema";
import { requireCompanyAccess } from "@/lib/authorization";
import { pingOperatorConnector } from "@/lib/company/connector-ping";
import { resumeWaitingPackageSchedules } from "@relay/agent-ops/operator/packages";
import { INTEGRATION_TYPE_LABELS } from "@/constants";
import { revokeGoogleWorkspaceConnector } from "@/lib/integrations/google-workspace-connector";
import { CONNECTOR_INFO } from "../connectors/connector-view";

/**
 * Server actions take `type` from the client: only key connectors pass. Google Workspace connects
 * by Google sign-in (S73 OAuth routes), not here. Catalog entries in the "unavailable" state
 * (Meta, Google Business Profile, ...) and anything else are refused.
 */
function connectableTypeError(type: string): { error: string } | null {
  if (isOperatorConnectorType(type)) return null;
  if (isOAuthConnectorType(type)) {
    return { error: `${CONNECTOR_INFO[type].name} connects with Google sign-in` };
  }
  if (isConnectorCatalogType(type)) {
    return { error: `${CONNECTOR_INFO[type].name} isn't available yet` };
  }
  return { error: "Unknown connector" };
}

function findOperatorConnector(companyId: string, type: OperatorConnectorType) {
  return db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.type, type),
      isNull(integrations.agentId),
    ),
  });
}

/** True when the stored config holds every secret the connector type needs. */
function hasStoredKey(type: OperatorConnectorType, config: IntegrationConfig | null | undefined): boolean {
  switch (type) {
    case "hunter":
      return Boolean(config?.hunter?.apiKey);
    case "snov":
      return Boolean(config?.snov?.clientId && config.snov.clientSecret);
    case "google_places":
      return Boolean(config?.googlePlaces?.apiKey);
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function buildConfig(
  type: OperatorConnectorType,
  input: {
    hunterApiKey?: string;
    snovClientId?: string;
    snovClientSecret?: string;
    googlePlacesApiKey?: string;
  },
): IntegrationConfig | { error: string } {
  switch (type) {
    case "hunter": {
      const apiKey = input.hunterApiKey?.trim();
      if (!apiKey) {
        return { error: "Hunter API key is required" };
      }
      return { hunter: { apiKey } };
    }
    case "snov": {
      const clientId = input.snovClientId?.trim();
      const clientSecret = input.snovClientSecret?.trim();
      if (!clientId || !clientSecret) {
        return { error: "Snov client ID and secret are required" };
      }
      return { snov: { clientId, clientSecret } };
    }
    case "google_places": {
      const apiKey = input.googlePlacesApiKey?.trim();
      if (!apiKey) {
        return { error: "Google Places API key is required" };
      }
      return { googlePlaces: { apiKey } };
    }
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function buildPingInput(
  type: OperatorConnectorType,
  config: IntegrationConfig,
):
  | { type: "hunter"; apiKey: string }
  | { type: "snov"; clientId: string; clientSecret: string }
  | { type: "google_places"; apiKey: string } {
  switch (type) {
    case "hunter":
      return { type: "hunter", apiKey: config.hunter!.apiKey };
    case "snov":
      return {
        type: "snov",
        clientId: config.snov!.clientId,
        clientSecret: config.snov!.clientSecret,
      };
    case "google_places":
      return { type: "google_places", apiKey: config.googlePlaces!.apiKey };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

async function upsertOperatorConnector(
  existing: { id: string } | undefined,
  input: {
    companyId: string;
    type: OperatorConnectorType;
    config: IntegrationConfig;
    status: "connected" | "error";
    error: string | null;
  },
) {
  const now = new Date();
  const values = {
    name: INTEGRATION_TYPE_LABELS[input.type] ?? input.type,
    type: input.type,
    companyId: input.companyId,
    agentId: null,
    status: input.status,
    config: input.config,
    error: input.error,
    ...(input.status === "connected" ? { lastSyncAt: now } : {}),
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(integrations)
      .set(values)
      .where(eq(integrations.id, existing.id));
    return;
  }

  await db.insert(integrations).values(values);
}

export async function connectOperatorConnector(input: {
  companyId: string;
  type: OperatorConnectorType;
  hunterApiKey?: string;
  snovClientId?: string;
  snovClientSecret?: string;
  googlePlacesApiKey?: string;
}): Promise<{ ok: true } | { error: string }> {
  await requireCompanyAccess(input.companyId);

  const typeError = connectableTypeError(input.type);
  if (typeError) {
    return typeError;
  }

  const configResult = buildConfig(input.type, input);
  if ("error" in configResult) {
    return configResult;
  }

  const pingResult = await pingOperatorConnector(
    buildPingInput(input.type, configResult),
  );

  const existing = await findOperatorConnector(input.companyId, input.type);

  // Key edit: a working key stays in place until its replacement passes the check.
  if (
    !pingResult.ok &&
    existing?.status === "connected" &&
    hasStoredKey(input.type, existing.config)
  ) {
    return { error: pingResult.error };
  }

  const status = pingResult.ok ? "connected" : "error";
  const error = pingResult.ok ? null : pingResult.error;

  await upsertOperatorConnector(existing, {
    companyId: input.companyId,
    type: input.type,
    config: configResult,
    status,
    error,
  });

  revalidatePath(`/settings/companies/${input.companyId}`);
  revalidatePath("/settings/connectors");

  if (!pingResult.ok) {
    return { error: pingResult.error };
  }

  // Packages spec decision 6: Schedules waiting for this connector resume.
  await resumeWaitingPackageSchedules(input.companyId);

  return { ok: true };
}

/** Re-checks the stored key against the provider and records the result. */
export async function validateOperatorConnector(input: {
  companyId: string;
  type: OperatorConnectorType;
}): Promise<{ ok: true } | { error: string }> {
  await requireCompanyAccess(input.companyId);

  const typeError = connectableTypeError(input.type);
  if (typeError) {
    return typeError;
  }

  const existing = await findOperatorConnector(input.companyId, input.type);
  if (!existing || !hasStoredKey(input.type, existing.config)) {
    return { error: `${CONNECTOR_INFO[input.type].name} has no stored key` };
  }

  const pingResult = await pingOperatorConnector(
    buildPingInput(input.type, existing.config!),
  );
  const now = new Date();

  await db
    .update(integrations)
    .set(
      pingResult.ok
        ? { status: "connected", error: null, lastSyncAt: now, updatedAt: now }
        : { status: "error", error: pingResult.error, updatedAt: now },
    )
    .where(eq(integrations.id, existing.id));

  revalidatePath(`/settings/companies/${input.companyId}`);
  revalidatePath("/settings/connectors");

  if (!pingResult.ok) {
    return { error: pingResult.error };
  }
  await resumeWaitingPackageSchedules(input.companyId);
  return { ok: true };
}

export async function disconnectOperatorConnector(input: {
  companyId: string;
  type: AvailableConnectorType;
}): Promise<void> {
  await requireCompanyAccess(input.companyId);

  if (!isConnectorCatalogType(input.type) || !isConnectorAvailable(input.type)) {
    throw new Error("Unknown connector");
  }
  if (input.type === "google_workspace") {
    // Tell Google to drop Relay's Gmail access before the token is forgotten.
    await revokeGoogleWorkspaceConnector(input.companyId);
  }

  await db
    .update(integrations)
    .set({
      status: "disconnected",
      config: {},
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrations.companyId, input.companyId),
        eq(integrations.type, input.type),
        isNull(integrations.agentId),
      ),
    );

  revalidatePath(`/settings/companies/${input.companyId}`);
  revalidatePath("/settings/connectors");
}
