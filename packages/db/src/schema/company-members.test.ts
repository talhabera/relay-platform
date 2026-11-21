import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_PERMISSIONS,
  OWNER_PAGE_PERMISSIONS,
  PAGE_PERMISSION_KEYS,
  normalizePagePermissions,
} from "./company-members";

describe("PAGE_PERMISSION_KEYS", () => {
  it("lists every dashboard page that owners can grant", () => {
    expect(PAGE_PERMISSION_KEYS).toEqual([
      "operator",
      "agents",
      "messaging",
      "analytics",
    ]);
  });
});

describe("DEFAULT_PAGE_PERMISSIONS", () => {
  it("preserves current member access: Operator on, owner pages off", () => {
    expect(DEFAULT_PAGE_PERMISSIONS).toEqual({
      operator: true,
      agents: false,
      messaging: false,
      analytics: false,
    });
  });
});

describe("OWNER_PAGE_PERMISSIONS", () => {
  it("grants every page", () => {
    expect(OWNER_PAGE_PERMISSIONS).toEqual({
      operator: true,
      agents: true,
      messaging: true,
      analytics: true,
    });
  });
});

describe("normalizePagePermissions", () => {
  it("treats missing keys and a missing object as denied", () => {
    expect(normalizePagePermissions(undefined)).toEqual({
      operator: false,
      agents: false,
      messaging: false,
      analytics: false,
    });
    expect(normalizePagePermissions({ operator: true })).toEqual({
      operator: true,
      agents: false,
      messaging: false,
      analytics: false,
    });
  });

  it("only treats an explicit true as granted", () => {
    expect(
      normalizePagePermissions({
          operator: false,
        agents: true,
        messaging: false,
        analytics: false,
      }),
    ).toEqual({
      operator: false,
      agents: true,
      messaging: false,
      analytics: false,
    });
  });
});
