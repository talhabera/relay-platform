import type {
  AgentPerformanceEntry,
  AnalyticsSummary,
  MessagesOverTimeEntry,
} from "@/lib/analytics-queries";
import { analyticsKpiCards } from "@/lib/analytics-kpi-cards";
import { DateRangeSelector } from "@/components/analytics/date-range-selector";
import { MessagesChart } from "@/components/analytics/messages-chart";
import { DistributionChart } from "@/components/analytics/distribution-chart";
import { AgentPerformanceChart } from "@/components/analytics/agent-performance-chart";
import { MetricCard } from "@/components/shared/metric-card";

type AnalyticsDashboardProps = {
  summary: AnalyticsSummary;
  messagesOverTime: MessagesOverTimeEntry[];
  agentPerformance: AgentPerformanceEntry[];
  range: string;
};

export function AnalyticsDashboard({
  summary,
  messagesOverTime,
  agentPerformance,
  range,
}: AnalyticsDashboardProps) {
  const kpiCards = analyticsKpiCards(summary);
  const eventTypeData = Object.entries(summary.eventsByType).map(
    ([name, value]) => ({ name, value }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Messages, resolution, and channel mix for this company.
          </p>
        </div>
        <DateRangeSelector currentRange={range} />
      </div>

      <div className="@container/main space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 @5xl:grid-cols-4">
          {kpiCards.map((card) => (
            <MetricCard key={card.title} label={card.title} value={card.value} description={card.description} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-2">
          <MessagesChart data={messagesOverTime} />
          <DistributionChart
            title="Event Distribution"
            description="Breakdown of event types in the selected period"
            data={eventTypeData}
          />
        </div>

        <AgentPerformanceChart data={agentPerformance} />
      </div>
    </div>
  );
}
