import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { channels } from "./channels";
import { chats } from "./chats";
import { messages } from "./messages";

/**
 * The four indexes the inbound webhook path depends on were written by hand in
 * SQL and left out of the Drizzle schema. `pnpm db:push` diffs the live
 * database against this schema, so an undeclared index is one it offers to
 * drop — and dropping `messages_platform_message_id_idx` means every Meta
 * redelivery stores a second message and sends a second billed reply, while
 * dropping the others reopens the split-conversation race and lets two
 * companies claim one routing key.
 */
function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  const config = getTableConfig(table);
  return [
    ...config.indexes.map((entry) => entry.config.name),
    ...config.uniqueConstraints.map((entry) => entry.name),
  ].filter((name): name is string => typeof name === "string");
}

describe("indexes the webhook path relies on", () => {
  it("declares the redelivery guard on messages", () => {
    expect(indexNames(messages)).toContain("messages_platform_message_id_idx");
  });

  it("declares the one-conversation-per-sender guard on chats", () => {
    expect(indexNames(chats)).toContain("chats_agent_channel_visitor_idx");
  });

  it("declares both inbound routing keys on channels", () => {
    const names = indexNames(channels);

    expect(names).toContain("channels_whatsapp_phone_number_uidx");
    expect(names).toContain("channels_instagram_account_uidx");
  });

  it("keeps all four unique, which is what makes them guards", () => {
    const unique = [
      ...getTableConfig(messages).indexes,
      ...getTableConfig(chats).indexes,
      ...getTableConfig(channels).indexes,
    ].filter((entry) =>
      [
        "messages_platform_message_id_idx",
        "chats_agent_channel_visitor_idx",
        "channels_whatsapp_phone_number_uidx",
        "channels_instagram_account_uidx",
      ].includes(entry.config.name ?? ""),
    );

    expect(unique).toHaveLength(4);
    for (const entry of unique) {
      expect(entry.config.unique).toBe(true);
    }
  });
});
