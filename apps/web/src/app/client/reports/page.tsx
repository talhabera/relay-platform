import type { Metadata } from "next";

import { NoCompanyState, SystemStateFrame } from "@/components/v2/shell";

import { ClientPortalHeader } from "../portal-header";

import { loadReportsPage, parseReportsSearch, reportsHref } from "./load-report";
import { ReportNav } from "./report-nav";
import { ReportBody, ReportEmpty } from "./report-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reports" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PERIOD_HREFS = {
  daily: reportsHref("daily"),
  weekly: reportsHref("weekly"),
  monthly: reportsHref("monthly"),
};

/**
 * Client portal Reports (S70, Figma 11a `451:61553`): closed daily / weekly
 * reports from `report_snapshots`, period Segmented and prev / next stepper.
 * Client users, and the owner / member read-only preview, pass
 * `requireClientAccess`.
 */
export default async function ClientReportsPage({ searchParams }: Props) {
  const data = await loadReportsPage(parseReportsSearch(await searchParams));

  if (data.kind === "no-company") {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={false} />
      </SystemStateFrame>
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <ClientPortalHeader active="reports" company={data.company} />
      <main className="mx-auto flex w-full max-w-360 flex-col gap-6 px-4 pb-12 sm:px-8">
        <ReportNav
          period={data.period}
          range={data.view?.rangeLabel ?? "No closed period yet"}
          periodHrefs={PERIOD_HREFS}
          previousHref={data.previousHref}
          nextHref={data.nextHref}
        />
        {data.view ? <ReportBody view={data.view} /> : <ReportEmpty period={data.period} hasSnapshot={false} />}
      </main>
    </div>
  );
}
