import type {
  AvailableConnectorType,
  ConnectorCatalogType,
  OperatorConnectorType,
} from "@relay/db";
import type { ConnectorRowStatus } from "@/components/v2/data";
import type { BrandName } from "@/components/v2/primitives";

/**
 * Pure view model for Settings › Connectors (Figma 08c `connectors`, `connectors-edit-key`,
 * `connectors-remove`). Covers the whole connector catalog: the three key connectors, Google
 * Workspace (OAuth, S73) and the "unavailable" entries (no key fields; nothing can connect them).
 */

export type ConnectorKeyField = {
  /** Field name on `connectOperatorConnector`'s input. */
  name: "hunterApiKey" | "snovClientId" | "snovClientSecret" | "googlePlacesApiKey";
  label: string;
};

export type ConnectorAuth = "key" | "oauth" | "none";

export const CONNECTOR_INFO: Record<
  ConnectorCatalogType,
  {
    brand: BrandName;
    name: string;
    description: string;
    /** key: pasted API key; oauth: sign in with the provider; none: unavailable. */
    auth: ConnectorAuth;
    fields: ConnectorKeyField[];
  }
> = {
  hunter: {
    brand: "hunter",
    name: "Hunter",
    description: "Finds and verifies work emails",
    auth: "key",
    fields: [{ name: "hunterApiKey", label: "API key" }],
  },
  snov: {
    brand: "snov",
    name: "Snov.io",
    description: "Finds emails by company domain",
    auth: "key",
    fields: [
      { name: "snovClientId", label: "Client ID" },
      { name: "snovClientSecret", label: "Client secret" },
    ],
  },
  google_places: {
    brand: "google-places",
    name: "Google Places",
    description: "Finds local businesses and their details",
    auth: "key",
    fields: [{ name: "googlePlacesApiKey", label: "API key" }],
  },
  google_workspace: {
    brand: "google-workspace",
    name: "Google Workspace",
    description: "Sends approved outreach from Gmail",
    auth: "oauth",
    fields: [],
  },
  meta: {
    brand: "meta",
    name: "Meta",
    description: "Posts and replies on Facebook and Instagram",
    auth: "none",
    fields: [],
  },
  google_business_profile: {
    brand: "google-business",
    name: "Google Business Profile",
    description: "Posts updates and replies to Google reviews",
    auth: "none",
    fields: [],
  },
  linkedin: {
    brand: "linkedin",
    name: "LinkedIn",
    description: "Posts to your company page",
    auth: "none",
    fields: [],
  },
  trustpilot: {
    brand: "trustpilot",
    name: "Trustpilot",
    description: "Reads and replies to Trustpilot reviews",
    auth: "none",
    fields: [],
  },
};

/** "••••••••3f2a": the last four characters of a stored secret, never more. */
export function maskedKeyHint(secret: string | null | undefined): string | undefined {
  const value = secret?.trim();
  if (!value || value.length < 8) return undefined;
  return `••••••••${value.slice(-4)}`;
}

type StoredConfig = {
  hunter?: { apiKey?: string };
  snov?: { clientId?: string; clientSecret?: string };
  googlePlaces?: { apiKey?: string };
} | null;

/** Hint for the secret that identifies the stored key of a connector type. */
export function connectorKeyHint(type: OperatorConnectorType, config: StoredConfig): string | undefined {
  switch (type) {
    case "hunter":
      return maskedKeyHint(config?.hunter?.apiKey);
    case "snov":
      return maskedKeyHint(config?.snov?.clientSecret);
    case "google_places":
      return maskedKeyHint(config?.googlePlaces?.apiKey);
  }
}

export type ConnectorUser = {
  id: string;
  name: string;
  /** Live version name, e.g. "v1". */
  version?: string;
  /** Package that installed the agent's workflow, e.g. "Lead engine". */
  packageName?: string;
};

export type ConnectorListItem = {
  type: AvailableConnectorType;
  status: ConnectorRowStatus;
  meta?: string;
  keyHint?: string;
  /** Operator agents that call this connector's tools. */
  usedBy: ConnectorUser[];
};

/** Row status and right-aligned note from the stored integration row (none = disconnected). */
export function connectorRowState(
  row: { status: string | null; error: string | null } | undefined,
  keyHint: string | undefined,
): { status: ConnectorRowStatus; meta?: string } {
  switch (row?.status) {
    case "connected":
      return { status: "connected", meta: keyHint ? `Key ${keyHint}` : undefined };
    case "error":
      return { status: "error", meta: row.error?.trim() || "Connection failed" };
    case "pending":
      return { status: "pending" };
    default:
      return { status: "disconnected" };
  }
}

/** Where an OAuth connector's Connect / Reconnect goes (the S73 start route). */
export function oauthStartUrl(type: "google_workspace", companyId: string): string {
  const slug = type.replace("_", "-");
  return `/api/connectors/${slug}/start?companyId=${encodeURIComponent(companyId)}`;
}

/** Right-aligned note of a connected Google Workspace row: the mailbox it sends from. */
export function gmailAccountNote(config: { googleWorkspace?: { email?: string } } | null): string | undefined {
  const email = config?.googleWorkspace?.email?.trim();
  return email ? `Sends as ${email}` : undefined;
}

/** Row status and note for an OAuth connector (no key hint; the note names the account). */
export function oauthConnectorRowState(
  row: { status: string | null; error: string | null } | undefined,
  accountNote: string | undefined,
): { status: ConnectorRowStatus; meta?: string } {
  const state = connectorRowState(row, undefined);
  return state.status === "connected" ? { status: "connected", meta: accountNote } : state;
}

/** True when the connector holds a key that "Replace key" / "Remove connector" act on. */
export function hasStoredKey(item: Pick<ConnectorListItem, "status">): boolean {
  return item.status === "connected" || item.status === "error";
}
