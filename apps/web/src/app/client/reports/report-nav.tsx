"use client";

import { useRouter } from "next/navigation";

import { ReportHeader } from "@/components/v2/client";
import type { ReportPeriod } from "@/lib/fixtures/interfaces";

const ARCHIVE_HREF = "/client/reports/archive";

type ReportNavProps = {
  period: ReportPeriod;
  range: string;
  periodHrefs: Record<ReportPeriod, string>;
  previousHref: string | null;
  nextHref: string | null;
};

/**
 * Report header wired to URLs: the period Segmented and the prev / next
 * stepper navigate between closed periods; Archive opens
 * `/client/reports/archive` (S71). PDF and Share (S89) are not built yet, so
 * they render disabled.
 */
export function ReportNav({ period, range, periodHrefs, previousHref, nextHref }: ReportNavProps) {
  const router = useRouter();
  return (
    <ReportHeader
      period={period}
      range={range}
      onPeriodChange={(next) => router.push(periodHrefs[next])}
      onPrev={previousHref ? () => router.push(previousHref) : undefined}
      onNext={nextHref ? () => router.push(nextHref) : undefined}
      prevDisabled={!previousHref}
      nextDisabled={!nextHref}
      archiveHref={ARCHIVE_HREF}
    />
  );
}
