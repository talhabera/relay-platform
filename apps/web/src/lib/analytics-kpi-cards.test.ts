import { describe, expect, it } from "vitest";
import { analyticsKpiCards } from "./analytics-kpi-cards";

describe("analyticsKpiCards", () => {
  it("maps summary fields without inventing commerce metrics", () => {
    const cards = analyticsKpiCards({
      totalEvents: 120,
      totalChats: 45,
      totalMessages: 890,
      activeAgents: 6,
      eventsByType: {},
      eventsByAgent: {},
      eventsByIntegration: {},
    });
    expect(cards.map((c) => c.title)).toEqual([
      "Total events",
      "Conversations",
      "Messages",
      "Active agents",
    ]);
    expect(cards[2]?.value).toBe("890");
  });
});
