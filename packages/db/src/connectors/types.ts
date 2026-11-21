/** Key connectors an owner can connect today (Settings › Connectors, API key + live check). */
export const OPERATOR_CONNECTOR_TYPES = [
  "hunter",
  "snov",
  "google_places",
] as const;

export type OperatorConnectorType = (typeof OPERATOR_CONNECTOR_TYPES)[number];

/**
 * Connectors an owner connects by signing in with the provider (OAuth), not with a pasted key.
 * Google Workspace (S73): Gmail send-only, so an approved outreach checkpoint sends from Gmail.
 */
export const OAUTH_CONNECTOR_TYPES = ["google_workspace"] as const;

export type OAuthConnectorType = (typeof OAUTH_CONNECTOR_TYPES)[number];

/**
 * Catalog entries that exist before they work (packages spec: "unavailable" state). Packages may
 * name them as required or optional connectors; nothing can connect them yet.
 */
export const UNAVAILABLE_CONNECTOR_TYPES = [
  "meta",
  "google_business_profile",
  "linkedin",
  "trustpilot",
] as const;

export type UnavailableConnectorType =
  (typeof UNAVAILABLE_CONNECTOR_TYPES)[number];

/** Every company-level connector in the catalog, in display order. */
export const CONNECTOR_CATALOG_TYPES = [
  ...OPERATOR_CONNECTOR_TYPES,
  ...OAUTH_CONNECTOR_TYPES,
  ...UNAVAILABLE_CONNECTOR_TYPES,
] as const;

export type ConnectorCatalogType = (typeof CONNECTOR_CATALOG_TYPES)[number];

export function isOperatorConnectorType(
  type: string,
): type is OperatorConnectorType {
  return (OPERATOR_CONNECTOR_TYPES as readonly string[]).includes(type);
}

export function isConnectorCatalogType(
  type: string,
): type is ConnectorCatalogType {
  return (CONNECTOR_CATALOG_TYPES as readonly string[]).includes(type);
}

export function isOAuthConnectorType(type: string): type is OAuthConnectorType {
  return (OAUTH_CONNECTOR_TYPES as readonly string[]).includes(type);
}

/** A connector that can be connected today, by key or by OAuth. */
export type AvailableConnectorType = OperatorConnectorType | OAuthConnectorType;

/** True when the connector can be connected today (it is not an "unavailable" catalog entry). */
export function isConnectorAvailable(
  type: ConnectorCatalogType,
): type is AvailableConnectorType {
  return isOperatorConnectorType(type) || isOAuthConnectorType(type);
}
