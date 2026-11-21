import { describe, expect, it } from "vitest";
import { toChannelView, toIntegrationView } from "./client-views";
import type { Channel, Integration } from "@/types";

function channelRow(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "channel-1",
    name: "WhatsApp",
    type: "whatsapp",
    agentId: "agent-1",
    status: "active",
    config: {
      apiKey: "wa-api-key-SECRET",
      accessToken: "EAAGaccess-SECRET",
      phoneNumberId: "123456789012345",
      accountId: "17841400000000000",
      botToken: "telegram-bot-SECRET",
      widgetId: "widget-1",
      webhookVerifyToken: "verify-SECRET",
      autoReply: true,
      autoCommentReply: false,
    },
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  } as Channel;
}

describe("toChannelView", () => {
  it("keeps what the channels tab renders", () => {
    expect(toChannelView(channelRow())).toEqual({
      id: "channel-1",
      name: "WhatsApp",
      type: "whatsapp",
      status: "active",
      config: { autoReply: true, autoCommentReply: false },
    });
  });

  // The channels tab is a client component, so whatever this returns is
  // serialised into the page's flight payload and readable in page source.
  // A credential must not be able to ride along in it.
  it("carries no credential through, whatever the row holds", () => {
    const serialised = JSON.stringify(toChannelView(channelRow()));

    expect(serialised).not.toContain("SECRET");
    expect(serialised).not.toContain("123456789012345");
    expect(serialised).not.toContain("17841400000000000");
  });

  it("survives a row whose config was never set", () => {
    expect(toChannelView(channelRow({ config: null }))).toEqual({
      id: "channel-1",
      name: "WhatsApp",
      type: "whatsapp",
      status: "active",
      config: { autoReply: false, autoCommentReply: false },
    });
  });

  it("reports a missing status as inactive rather than dropping it", () => {
    expect(toChannelView(channelRow({ status: null })).status).toBe("inactive");
  });
});

describe("toIntegrationView", () => {
  function integrationRow(overrides: Partial<Integration> = {}): Integration {
    return {
      id: "integration-1",
      name: "Shopify",
      type: "shopify",
      companyId: "company-1",
      agentId: "agent-1",
      status: "connected",
      config: {
        apiKey: "shopify-key-SECRET",
        apiSecret: "shopify-secret-SECRET",
        accessToken: "shpat-SECRET",
        refreshToken: "refresh-SECRET",
        webhookUrl: "https://example.com/hook",
        mcpHeaders: { authorization: "Bearer SECRET" },
      },
      error: null,
      lastSyncAt: new Date("2026-09-01T00:00:00.000Z"),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      ...overrides,
    } as Integration;
  }

  it("keeps what the integrations tab renders", () => {
    expect(toIntegrationView(integrationRow())).toEqual({
      id: "integration-1",
      name: "Shopify",
      type: "shopify",
      status: "connected",
      error: null,
      lastSyncAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("carries no credential through, whatever the row holds", () => {
    const serialised = JSON.stringify(toIntegrationView(integrationRow()));

    expect(serialised).not.toContain("SECRET");
  });
});
