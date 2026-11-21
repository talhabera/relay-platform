import { describe, expect, it } from "vitest";
import {
  maskChannelConfig,
  maskIntegrationConfig,
  maskRecord,
  maskSecret,
} from "./secrets";

describe("maskSecret", () => {
  it("returns null for empty values", () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret(undefined)).toBeNull();
    expect(maskSecret("")).toBeNull();
  });

  it("masks short and long secrets", () => {
    expect(maskSecret("abc")).toBe("****");
    expect(maskSecret("sk_live_1234567890")).toBe("sk_l****");
  });
});

describe("maskRecord", () => {
  it("returns null for null input", () => {
    expect(maskRecord(null)).toBeNull();
  });

  it("masks every value in a record", () => {
    expect(maskRecord({ Authorization: "Bearer secret-token" })).toEqual({
      Authorization: "Bear****",
    });
  });
});

describe("maskChannelConfig", () => {
  // Reserved for the Instagram connect flow and unused today, which is
  // exactly why it would be missed: the first write of it would otherwise
  // return the token in cleartext from listChannels.
  it("masks the per-channel webhook verify token", () => {
    expect(maskChannelConfig({ webhookVerifyToken: "verify_1234567890" })).toEqual({
      webhookVerifyToken: "veri****",
    });
  });

  it("masks channel secret keys with first-4 + ****", () => {
    expect(
      maskChannelConfig({
        apiKey: "sk_live_1234567890",
        accessToken: "tok_abcdefghijklmnop",
        botToken: "12345678901234567890",
        accountId: "acct_9876543210",
      }),
    ).toEqual({
      apiKey: "sk_l****",
      accessToken: "tok_****",
      botToken: "1234****",
      accountId: "acct****",
    });
  });

  it("leaves non-secret channel fields unmasked", () => {
    expect(
      maskChannelConfig({
        widgetId: "widget-abc-123",
        phoneNumberId: "+15551234567",
        apiKey: "secret-key-value",
      }),
    ).toEqual({
      widgetId: "widget-abc-123",
      phoneNumberId: "+15551234567",
      apiKey: "secr****",
    });
  });
});

describe("maskIntegrationConfig", () => {
  it("masks integration secret keys with first-4 + ****", () => {
    expect(
      maskIntegrationConfig({
        apiKey: "sk_live_1234567890",
        apiSecret: "shhh_super_secret",
        accessToken: "tok_abcdefghijklmnop",
        refreshToken: "refr_abcdefghijklmnop",
      }),
    ).toEqual({
      apiKey: "sk_l****",
      apiSecret: "shhh****",
      accessToken: "tok_****",
      refreshToken: "refr****",
    });
  });

  it("masks mcpHeaders via maskRecord", () => {
    expect(
      maskIntegrationConfig({
        mcpHeaders: { Authorization: "Bearer secret-token" },
      }),
    ).toEqual({
      mcpHeaders: { Authorization: "Bear****" },
    });
  });
});
