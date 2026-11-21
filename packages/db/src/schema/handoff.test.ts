import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  agentHandoffSettings,
  canTransitionHandoffRequest,
  handoffRequests,
  handoffTeamChatGroups,
  handoffTeamChatQuestions,
  HANDOFF_REQUEST_STATUSES,
} from "./handoff";
import { messages } from "./messages";

const columnNames = (cols: unknown[]) =>
  cols.map((c) => (c && typeof c === "object" && "name" in c ? c.name : ""));

describe("handoff_requests table", () => {
  const config = getTableConfig(handoffRequests);

  it("allows one open request per conversation (partial unique index)", () => {
    const index = config.indexes.find(
      (i) => i.config.name === "handoff_requests_chat_open_uidx",
    );
    expect(index?.config.unique).toBe(true);
    expect(columnNames(index?.config.columns ?? [])).toEqual(["chat_id"]);
    expect(index?.config.where).toBeDefined();
  });

  it("stores only a unique token hash, never the token", () => {
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("token_hash");
    expect(names).not.toContain("token");
    const index = config.indexes.find(
      (i) => i.config.name === "handoff_requests_token_hash_uidx",
    );
    expect(index?.config.unique).toBe(true);
  });

  it("carries the tenant on every row", () => {
    expect(config.columns.find((c) => c.name === "company_id")?.notNull).toBe(
      true,
    );
  });

  it("tracks the staff notification's delivery status (nullable)", () => {
    for (const name of [
      "notification_message_id",
      "notification_status",
      "notification_status_at",
      "notification_error",
    ]) {
      const column = config.columns.find((c) => c.name === name);
      expect(column, name).toBeDefined();
      expect(column?.notNull, name).toBe(false);
    }
    expect(
      config.indexes.find(
        (i) => i.config.name === "handoff_requests_notification_message_id_idx",
      ),
    ).toBeDefined();
    expect(config.checks.map((c) => c.name)).toContain(
      "handoff_requests_notification_status_chk",
    );
  });

  it("bounds confidence and requires a token outside Team chat", () => {
    expect(config.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "handoff_requests_confidence_chk",
        "handoff_requests_token_chk",
      ]),
    );
  });
});

describe("agent_handoff_settings table", () => {
  const config = getTableConfig(agentHandoffSettings);

  it("is one row per agent with the spec defaults", () => {
    const col = (name: string) => config.columns.find((c) => c.name === name);
    expect(col("agent_id")?.primary).toBe(true);
    expect(col("mode")?.default).toBe("quick_answer");
    expect(col("expiry_minutes")?.default).toBe(120);
    expect(col("recipient_confirmed")?.default).toBe(false);
    expect(col("if_nobody_answers")?.default).toBe("reply_here");
    expect(config.checks.map((c) => c.name)).toContain(
      "agent_handoff_settings_expiry_chk",
    );
  });
});

describe("messages human author", () => {
  it("requires a display name on human messages", () => {
    const config = getTableConfig(messages);
    expect(config.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["author", "author_display_name"]),
    );
    expect(config.checks.map((c) => c.name)).toContain(
      "messages_human_display_name_chk",
    );
  });
});

describe("handoff request transitions", () => {
  const allowed: Array<[string, string]> = [
    ["open", "answered"],
    ["open", "taken_over"],
    ["open", "expired"],
    ["answered", "taken_over"],
    ["taken_over", "handed_back"],
  ];

  it("allows exactly the spec's moves", () => {
    for (const from of HANDOFF_REQUEST_STATUSES) {
      for (const to of HANDOFF_REQUEST_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransitionHandoffRequest(from, to), `${from} -> ${to}`).toBe(
          expected,
        );
      }
    }
  });
});

describe("Team chat tables", () => {
  it("keeps one group per agent and a group id unique across agents", () => {
    const config = getTableConfig(handoffTeamChatGroups);
    expect(config.columns.find((c) => c.name === "agent_id")?.primary).toBe(true);
    expect(config.columns.find((c) => c.name === "company_id")?.notNull).toBe(true);
    const index = config.indexes.find(
      (i) => i.config.name === "handoff_team_chat_groups_group_id_uidx",
    );
    expect(index?.config.unique).toBe(true);
  });

  it("finds a posted question by its wamid or by its code within the group", () => {
    const config = getTableConfig(handoffTeamChatQuestions);
    const byMessage = config.indexes.find(
      (i) => i.config.name === "handoff_team_chat_questions_message_id_uidx",
    );
    const byCode = config.indexes.find(
      (i) => i.config.name === "handoff_team_chat_questions_group_code_uidx",
    );
    expect(byMessage?.config.unique).toBe(true);
    expect(columnNames(byCode?.config.columns ?? [])).toEqual(["group_id", "code"]);
    expect(byCode?.config.unique).toBe(true);
  });
});
