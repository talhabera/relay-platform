import type { AnalyticsSummary } from "./analytics-queries";

export function analyticsKpiCards(summary: AnalyticsSummary) {
  return [
    {
      title: "Total events",
      value: String(summary.totalEvents),
      description: "Tracked events in range",
    },
    {
      title: "Conversations",
      value: String(summary.totalChats),
      description: "Chats started",
    },
    {
      title: "Messages",
      value: String(summary.totalMessages),
      description: "Messages sent",
    },
    {
      title: "Active agents",
      value: String(summary.activeAgents),
      description: "Customer agents with activity",
    },
  ];
}
