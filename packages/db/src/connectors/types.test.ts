import { describe, expect, it } from "vitest";
import { integrations } from "../schema/integrations";
import {
  CONNECTOR_CATALOG_TYPES,
  OAUTH_CONNECTOR_TYPES,
  OPERATOR_CONNECTOR_TYPES,
  UNAVAILABLE_CONNECTOR_TYPES,
  isConnectorAvailable,
  isConnectorCatalogType,
  isOAuthConnectorType,
  isOperatorConnectorType,
} from "./types";

describe("operator connector types", () => {
  it("lists hunter, snov, and google_places only", () => {
    expect(OPERATOR_CONNECTOR_TYPES).toEqual([
      "hunter",
      "snov",
      "google_places",
    ]);
  });

  it("rejects customer integration types", () => {
    expect(isOperatorConnectorType("shopify")).toBe(false);
    expect(isOperatorConnectorType("hunter")).toBe(true);
  });
});

describe("connector catalog", () => {
  it("lists the key connectors, then the OAuth ones, then the unavailable ones", () => {
    expect(CONNECTOR_CATALOG_TYPES).toEqual([
      "hunter",
      "snov",
      "google_places",
      "google_workspace",
      "meta",
      "google_business_profile",
      "linkedin",
      "trustpilot",
    ]);
    expect(OAUTH_CONNECTOR_TYPES).toEqual(["google_workspace"]);
    expect(UNAVAILABLE_CONNECTOR_TYPES).toEqual([
      "meta",
      "google_business_profile",
      "linkedin",
      "trustpilot",
    ]);
  });

  it("marks the key connectors and Google Workspace (S73) available", () => {
    expect(isConnectorAvailable("hunter")).toBe(true);
    expect(isConnectorAvailable("google_workspace")).toBe(true);
    expect(isConnectorAvailable("meta")).toBe(false);
    expect(isConnectorAvailable("trustpilot")).toBe(false);
  });

  it("recognizes catalog types and rejects customer integration types", () => {
    expect(isConnectorCatalogType("google_business_profile")).toBe(true);
    expect(isConnectorCatalogType("shopify")).toBe(false);
    expect(isOperatorConnectorType("linkedin")).toBe(false);
  });

  it("recognizes OAuth connectors apart from key connectors", () => {
    expect(isOAuthConnectorType("google_workspace")).toBe(true);
    expect(isOAuthConnectorType("hunter")).toBe(false);
    expect(isOperatorConnectorType("google_workspace")).toBe(false);
  });

  it("keeps every catalog type in the integrations.type enum", () => {
    const enumValues = integrations.type.enumValues as readonly string[];
    for (const type of CONNECTOR_CATALOG_TYPES) {
      expect(enumValues).toContain(type);
    }
  });
});
