import { describe, expect, it } from "vitest";
import { CONNECTOR_CATALOG_TYPES, OPERATOR_CONNECTOR_TYPES, UNAVAILABLE_CONNECTOR_TYPES } from "@relay/db";
import { isBrandName } from "@/components/v2/primitives";

import {
  CONNECTOR_INFO,
  connectorKeyHint,
  connectorRowState,
  gmailAccountNote,
  hasStoredKey,
  maskedKeyHint,
  oauthConnectorRowState,
  oauthStartUrl,
} from "./connector-view";

describe("connector view (Figma 08c connectors)", () => {
  it("covers every operator connector type", () => {
    for (const type of OPERATOR_CONNECTOR_TYPES) {
      expect(CONNECTOR_INFO[type].fields.length).toBeGreaterThan(0);
    }
  });

  it("maps every catalog connector to a brand glyph", () => {
    for (const type of CONNECTOR_CATALOG_TYPES) {
      expect(isBrandName(CONNECTOR_INFO[type].brand)).toBe(true);
    }
    expect(CONNECTOR_INFO.meta.brand).toBe("meta");
    expect(CONNECTOR_INFO.google_business_profile.brand).toBe("google-business");
    expect(CONNECTOR_INFO.linkedin.brand).toBe("linkedin");
    expect(CONNECTOR_INFO.trustpilot.brand).toBe("trustpilot");
    expect(CONNECTOR_INFO.google_workspace.brand).toBe("google-workspace");
  });

  it("gives unavailable catalog entries no key fields", () => {
    for (const type of UNAVAILABLE_CONNECTOR_TYPES) {
      expect(CONNECTOR_INFO[type].fields).toEqual([]);
    }
  });

  it("signs in to Google Workspace instead of pasting a key (S73)", () => {
    expect(CONNECTOR_INFO.google_workspace.auth).toBe("oauth");
    expect(CONNECTOR_INFO.google_workspace.fields).toEqual([]);
    for (const type of OPERATOR_CONNECTOR_TYPES) {
      expect(CONNECTOR_INFO[type].auth).toBe("key");
    }
    for (const type of UNAVAILABLE_CONNECTOR_TYPES) {
      expect(CONNECTOR_INFO[type].auth).toBe("none");
    }
  });

  it("notes the Gmail mailbox on a connected Google Workspace row", () => {
    const note = gmailAccountNote({ googleWorkspace: { email: "me@agency.com" } });
    expect(note).toBe("Sends as me@agency.com");
    expect(gmailAccountNote({})).toBeUndefined();
    expect(oauthConnectorRowState({ status: "connected", error: null }, note)).toEqual({
      status: "connected",
      meta: "Sends as me@agency.com",
    });
    expect(
      oauthConnectorRowState({ status: "error", error: "Google access was revoked." }, note),
    ).toEqual({ status: "error", meta: "Google access was revoked." });
    expect(oauthConnectorRowState(undefined, undefined)).toEqual({ status: "disconnected" });
  });

  it("links Connect to the Google sign-in start route", () => {
    expect(oauthStartUrl("google_workspace", "co 1")).toBe(
      "/api/connectors/google-workspace/start?companyId=co%201",
    );
  });

  it("masks a key down to its last four characters", () => {
    expect(maskedKeyHint("abcd-efgh-3f2a")).toBe("••••••••3f2a");
    expect(maskedKeyHint("short")).toBeUndefined();
    expect(maskedKeyHint(undefined)).toBeUndefined();
  });

  it("hints the identifying secret of each type", () => {
    expect(connectorKeyHint("hunter", { hunter: { apiKey: "hunter-key-1234" } })).toBe("••••••••1234");
    expect(connectorKeyHint("snov", { snov: { clientId: "id", clientSecret: "secret-9876" } })).toBe(
      "••••••••9876",
    );
    expect(connectorKeyHint("google_places", {})).toBeUndefined();
  });

  it("maps stored rows to row status and note", () => {
    expect(connectorRowState(undefined, undefined)).toEqual({ status: "disconnected" });
    expect(connectorRowState({ status: "disconnected", error: null }, undefined)).toEqual({ status: "disconnected" });
    expect(connectorRowState({ status: "connected", error: null }, "••••••••3f2a")).toEqual({
      status: "connected",
      meta: "Key ••••••••3f2a",
    });
    expect(connectorRowState({ status: "error", error: "Quota reached" }, undefined)).toEqual({
      status: "error",
      meta: "Quota reached",
    });
    expect(connectorRowState({ status: "error", error: null }, undefined).meta).toBe("Connection failed");
  });

  it("offers replace/remove only when a key is stored", () => {
    expect(hasStoredKey({ status: "connected" })).toBe(true);
    expect(hasStoredKey({ status: "error" })).toBe(true);
    expect(hasStoredKey({ status: "disconnected" })).toBe(false);
  });
});
