import { describe, expect, it } from "vitest";
import { getAllTools } from "./tools";

describe("getAllTools", () => {
  it("does not register company memory or proposeAction", () => {
    expect(Object.keys(getAllTools("agent-1")).sort()).toEqual(
      [
        "getConversations",
        "getMessageHistory",
        "getShopifyCollections",
        "getShopifyProducts",
        "listInstagramComments",
        "replyToInstagramComment",
        "searchKnowledgeBase",
        "sendInstagramPrivateReply",
        "sendPlatformMessage",
      ].sort(),
    );
  });
});
