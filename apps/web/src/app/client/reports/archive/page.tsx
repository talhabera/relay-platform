import type { Metadata } from "next";
import Link from "next/link";

import { ClientHeader } from "@/components/v2/client";
import { Icon } from "@/components/v2/primitives";
import { NoCompanyState, SystemStateFrame } from "@/components/v2/shell";
import { archiveHref, parseArchiveFilter } from "@/lib/reports/archive";

import { ArchiveFilterControl } from "./archive-filter";
import { ArchiveBody } from "./archive-view";
import { loadArchivePage } from "./load-archive";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Report archive" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const FILTER_HREFS = {
  all: archiveHref(null),
  daily: archiveHref("daily"),
  weekly: archiveHref("weekly"),
  monthly: archiveHref("monthly"),
};

/**
 * Client portal report archive (S71, Figma 11a `11/reports/archive`): every
 * closed report, the open periods, and the agency-set schedule. Same access
 * as Reports (`requireClientAccess`).
 */
export default async function ClientReportArchivePage({ searchParams }: Props) {
  const data = await loadArchivePage(parseArchiveFilter(await searchParams));

  if (data.kind === "no-company") {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={false} />
      </SystemStateFrame>
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <ClientHeader active="reports" company={data.company} />
      <main className="mx-auto flex w-full max-w-360 flex-col gap-6 px-4 pb-12 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6 pt-6">
          <div className="flex min-w-0 flex-col items-start gap-2">
            <Link
              href="/client/reports"
              data-slot="archive-back"
              className="flex items-center gap-2 rounded-md py-1 type-body-strong text-foreground hover:text-primary"
            >
              <Icon name="arrow-left" size={16} />
              Back to reports
            </Link>
            <h1 className="type-h1 text-foreground">Report archive</h1>
            <p className="type-body text-muted-foreground">
              Every closed report for {data.company.name}, and the next ones on the schedule.
            </p>
          </div>
          <ArchiveFilterControl value={data.view.filter ?? "all"} hrefs={FILTER_HREFS} />
        </div>
        <ArchiveBody view={data.view} />
      </main>
    </div>
  );
}
