import { describe, expect, it } from "vitest";
import { parseInboundRequest } from "./inbound-request";

const VALID = {
  platform: "whatsapp",
  chatId: "chat-1",
  channelId: "channel-1",
};

describe("parseInboundRequest", () => {
  it("accepts a well-formed whatsapp request", () => {
    expect(parseInboundRequest(VALID)).toEqual(VALID);
  });

  it("accepts instagram", () => {
    const body = { ...VALID, platform: "instagram" };
    expect(parseInboundRequest(body)).toEqual(body);
  });

  it("rejects a platform we do not serve", () => {
    expect(parseInboundRequest({ ...VALID, platform: "telegram" })).toBeNull();
  });

  it("rejects a missing chatId", () => {
    expect(parseInboundRequest({ ...VALID, chatId: "" })).toBeNull();
  });

  it("rejects a missing channelId", () => {
    const { channelId: _drop, ...rest } = VALID;
    expect(parseInboundRequest(rest)).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseInboundRequest(null)).toBeNull();
    expect(parseInboundRequest("nope")).toBeNull();
  });
});
