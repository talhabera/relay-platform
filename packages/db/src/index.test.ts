import { describe, expect, it } from "vitest";
import { agents, chats } from "./schema";

describe("@relay/db schema barrel", () => {
  it("exports agents and chats tables", () => {
    expect(agents).toBeDefined();
    expect(chats).toBeDefined();
  });
});
