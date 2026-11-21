import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { integrations, type GoogleWorkspaceConfig } from "@/db/schema";
import { revokeGoogleToken } from "./google-workspace";

// Persistence for the company-level `google_workspace` connector row (S73).
// One row per company (partial unique index from 0038), agentId null.

function findRow(companyId: string) {
  return db.query.integrations.findFirst({
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.type, "google_workspace"),
      isNull(integrations.agentId),
    ),
  });
}

/** Store a fresh consent: the row becomes connected and sends as `email`. */
export async function saveGoogleWorkspaceConnector(
  companyId: string,
  config: GoogleWorkspaceConfig,
  now: Date = new Date(),
): Promise<void> {
  const existing = await findRow(companyId);
  const previousToken = existing?.config?.googleWorkspace?.refreshToken;
  const values = {
    name: "Google Workspace",
    type: "google_workspace" as const,
    companyId,
    agentId: null,
    status: "connected" as const,
    config: { googleWorkspace: config },
    error: null,
    lastSyncAt: now,
    updatedAt: now,
  };
  if (existing) {
    await db.update(integrations).set(values).where(eq(integrations.id, existing.id));
  } else {
    await db.insert(integrations).values(values);
  }
  // A reconnect with another account leaves the old grant unused: drop it.
  if (previousToken && previousToken !== config.refreshToken) {
    await revokeGoogleToken(previousToken);
  }
}

/** Revoke Relay's Gmail access (best effort) before the row's config is cleared. */
export async function revokeGoogleWorkspaceConnector(companyId: string): Promise<void> {
  const existing = await findRow(companyId);
  const token = existing?.config?.googleWorkspace?.refreshToken;
  if (token) await revokeGoogleToken(token);
}
