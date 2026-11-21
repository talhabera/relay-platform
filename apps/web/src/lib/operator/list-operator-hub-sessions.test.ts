import { describe, expect, it } from "vitest";
import { filterOperatorHubSessions } from "./list-operator-hub-sessions";

describe("filterOperatorHubSessions", () => {
  it("keeps only operator channel sessions", () => {
    const sessions = [
      { id: "s1", channelType: "operator" as const, title: "Hub session" },
      { id: "s2", channelType: "widget" as const, title: "Widget chat" },
      { id: "s3", channelType: "operator" as const, title: "Another hub" },
    ];

    const result = filterOperatorHubSessions(sessions);

    expect(result.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("excludes non-operator rows such as cron-related chats", () => {
    const sessions = [
      { id: "cron-like", channelType: "web" as const, title: "Cron run transcript" },
      { id: "operator", channelType: "operator" as const, title: "Real session" },
    ];

    expect(filterOperatorHubSessions(sessions)).toHaveLength(1);
    expect(filterOperatorHubSessions(sessions)[0]?.id).toBe("operator");
  });
});
