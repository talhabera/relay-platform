import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth-server";
import {
  getAnalyticsSummary,
  getMessagesOverTime,
  getAgentPerformance,
} from "@/lib/analytics-queries";
import { analyticsKpiCards } from "@/lib/analytics-kpi-cards";
import { PageHeader } from "@/components/shared/page-header";
import { MetricCard } from "@/components/shared/metric-card";
import { NoCompanyState, PageRestricted, SystemStateFrame } from "@/components/v2/shell";
import { DateRangeSelector } from "@/components/analytics/date-range-selector";
import { MessagesChart } from "@/components/analytics/messages-chart";
import { DistributionChart } from "@/components/analytics/distribution-chart";
import { AgentPerformanceChart } from "@/components/analytics/agent-performance-chart";
import { resolveAnalyticsAccess } from "./_overview/analytics-access";
import { AnalyticsControls } from "./_overview/analytics-controls";
import { EmptyRangeView } from "./_overview/empty-range-view";
import { LeadQualityView } from "./_overview/lead-quality-view";
import { loadLeadQuality, loadOverview } from "./_overview/load-overview";
import {
  emptyRangeCopy,
  LEAD_QUALITY_KPI_LABELS,
  OVERVIEW_KPI_LABELS,
  parseAnalyticsView,
  parseWeekChoice,
  type AnalyticsView,
} from "./_overview/overview-model";
import { OverviewView } from "./_overview/overview-view";
import { reportExportHref } from "./_overview/report-csv";

type AnalyticsPageProps = {
  searchParams: Promise<{ range?: string; view?: string; week?: string }>;
};

function getDateRange(range: string): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date();

  switch (range) {
    case "today":
      startDate.setHours(0, 0, 0, 0);
      break;
    case "7d":
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "90d":
      startDate.setDate(startDate.getDate() - 90);
      break;
    case "30d":
    default:
      startDate.setDate(startDate.getDate() - 30);
      break;
  }

  return { startDate, endDate };
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const session = await requireSession();
  const resolvedParams = await searchParams;
  const view = parseAnalyticsView(resolvedParams.view);
  const week = parseWeekChoice(resolvedParams.week);

  const access = await resolveAnalyticsAccess(session.user.id);
  if (access.kind === "no-company") {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={access.isOwner} />
      </SystemStateFrame>
    );
  }
  const activeCompany = access.company;
  const activeCompanyId = activeCompany.id;
  const isOwner = access.isOwner;
  if (access.kind === "restricted") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Analytics"
          description={`Reports, overall status and marketing performance for ${activeCompany.name}`}
        />
        <div className="flex justify-center">
          <PageRestricted
            title="Analytics isn't available"
            description="Ask an owner to grant you Analytics access for this company."
          />
        </div>
      </div>
    );
  }

  const header = (controls: ReactNode) => (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="type-h1 text-foreground">Analytics</h1>
        <p className="truncate type-small text-muted-foreground">
          Reports, overall status and marketing performance for {activeCompany.name}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">{controls}</div>
    </div>
  );

  if (view === "agents") {
    const range = resolvedParams.range ?? "30d";
    const { startDate, endDate } = getDateRange(range);
    const [summary, messagesOverTime, agentPerformance] = await Promise.all([
      getAnalyticsSummary(activeCompanyId, startDate, endDate),
      getMessagesOverTime(activeCompanyId, startDate, endDate, "day"),
      getAgentPerformance(activeCompanyId, startDate, endDate),
    ]);
    const eventTypeData = Object.entries(summary.eventsByType).map(([name, value]) => ({ name, value }));
    return (
      <div className="flex flex-col gap-4">
        {header(
          <>
            <AnalyticsControls view={view} week={week} weekOptions={null} exportHref={null} />
            <DateRangeSelector currentRange={range} />
          </>,
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {analyticsKpiCards(summary).map((card) => (
            <MetricCard key={card.title} label={card.title} value={card.value} description={card.description} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MessagesChart data={messagesOverTime} />
          <DistributionChart
            title="Event Distribution"
            description="Breakdown of event types in the selected period"
            data={eventTypeData}
          />
        </div>
        <AgentPerformanceChart data={agentPerformance} />
      </div>
    );
  }

  const data =
    view === "lead-quality"
      ? await loadLeadQuality(activeCompanyId, week)
      : await loadOverview(activeCompanyId, week);
  if (!data) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={isOwner} />
      </SystemStateFrame>
    );
  }

  const controls = (
    <AnalyticsControls
      view={view}
      week={week}
      weekOptions={data.weekOptions}
      exportHref={data.empty ? null : reportExportHref(view, week)}
    />
  );

  if (data.empty) {
    const copy = emptyRangeCopy({
      companyName: activeCompany.name,
      companyCreatedAt: activeCompany.createdAt,
      week: data.week,
      timeZone: data.timeZone,
    });
    return (
      <div className="flex flex-col gap-4">
        {header(controls)}
        <EmptyRangeView
          kpiLabels={view === "lead-quality" ? LEAD_QUALITY_KPI_LABELS : OVERVIEW_KPI_LABELS}
          title={copy.title}
          description={copy.description}
          backHref={week === "last" ? thisWeekHref(view) : null}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header(controls)}
      {"rows" in data.model ? (
        <LeadQualityView model={data.model} />
      ) : (
        <OverviewView model={data.model} weekTitle={week === "this" ? "this week" : "last week"} />
      )}
    </div>
  );
}

function thisWeekHref(view: AnalyticsView): string {
  return view === "overview" ? "/analytics" : `/analytics?view=${view}`;
}
