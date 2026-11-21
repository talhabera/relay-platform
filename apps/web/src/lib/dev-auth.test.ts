import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  expectedDevUsername,
  isLocalDevAuthEnabled,
  isOidcConfigured,
  verifyDevCredentials,
} from "./dev-auth";

const KEYS = [
  "AUTH_DEV_ENABLED",
  "AUTH_URL",
  "AUTH_DEV_USER",
  "AUTH_DEV_PASSWORD",
  "NEXAUTH_ISSUER",
  "NEXAUTH_CLIENT_ID",
  "NEXAUTH_CLIENT_SECRET",
] as const;

const snapshot: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function setEnv(
  values: Partial<Record<(typeof KEYS)[number], string | undefined>>,
) {
  for (const key of KEYS) {
    if (key in values) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("dev-auth gates", () => {
  beforeAll(() => {
    for (const key of KEYS) snapshot[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = snapshot[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("is off by default", () => {
    setEnv({ AUTH_DEV_ENABLED: undefined, AUTH_URL: "http://localhost:3000" });
    expect(isLocalDevAuthEnabled()).toBe(false);
  });

  it("requires AUTH_URL to be localhost even when the flag is on", () => {
    setEnv({
      AUTH_DEV_ENABLED: "true",
      AUTH_URL: "https://trade.example.com",
      AUTH_DEV_PASSWORD: "local-dev",
    });
    expect(isLocalDevAuthEnabled()).toBe(false);
    expect(verifyDevCredentials("operator", "local-dev")).toBe(false);
  });

  it("accepts matching operator credentials on localhost", () => {
    setEnv({
      AUTH_DEV_ENABLED: "true",
      AUTH_URL: "http://localhost:3000",
      AUTH_DEV_USER: "operator",
      AUTH_DEV_PASSWORD: "local-dev",
    });
    expect(isLocalDevAuthEnabled()).toBe(true);
    expect(expectedDevUsername()).toBe("operator");
    expect(verifyDevCredentials("operator", "local-dev")).toBe(true);
    expect(verifyDevCredentials("operator", "wrong")).toBe(false);
    expect(verifyDevCredentials("other", "local-dev")).toBe(false);
  });

  it("treats .env.example OIDC placeholders as unconfigured", () => {
    setEnv({
      NEXAUTH_ISSUER: "https://your-oidc-provider",
      NEXAUTH_CLIENT_ID: "your-client-id",
      NEXAUTH_CLIENT_SECRET: "your-client-secret",
    });
    expect(isOidcConfigured()).toBe(false);
  });

  it("accepts a real OIDC issuer + client", () => {
    setEnv({
      NEXAUTH_ISSUER: "https://auth.example.com",
      NEXAUTH_CLIENT_ID: "prod-client",
      NEXAUTH_CLIENT_SECRET: "prod-secret",
    });
    expect(isOidcConfigured()).toBe(true);
  });
});
