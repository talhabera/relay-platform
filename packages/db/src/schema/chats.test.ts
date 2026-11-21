import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { chats, CHAT_STATUSES } from "./chats";

describe("chats session status (S04)", () => {
  const config = getTableConfig(chats);
  const column = (name: string) => config.columns.find((c) => c.name === name);

  it("carries the four Session row statuses", () => {
    expect(CHAT_STATUSES).toEqual([
      "running",
      "needs_you",
      "completed",
      "failed",
    ]);
    expect(column("status")?.notNull).toBe(true);
    expect(column("status")?.enumValues).toEqual([...CHAT_STATUSES]);
  });

  it("tracks last activity for the Sessions sort", () => {
    expect(column("last_activity_at")?.notNull).toBe(true);
    expect(column("last_activity_at")?.hasDefault).toBe(true);
    const index = config.indexes.find(
      (i) => i.config.name === "chats_company_id_last_activity_at_idx",
    );
    expect(index).toBeDefined();
  });
});
