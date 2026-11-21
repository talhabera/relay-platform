import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";
import { Segmented } from "../primitives/segmented";

type ReportPeriod = "daily" | "weekly" | "monthly";

const REPORT_TITLES: Record<ReportPeriod, string> = {
  daily: "Daily report",
  weekly: "Weekly report",
  monthly: "Monthly report",
};

const PERIOD_ITEMS: { value: ReportPeriod; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

type ReportHeaderProps = {
  className?: string;
  /** Figma `period`; drives the fixed title and the Segmented selection. */
  period: ReportPeriod;
  /** TEXT `range`, e.g. "Thu 24 Sep 2026". */
  range: string;
  /** TEXT `delivery` (set by the agency, read-only), e.g. "Emailed to Markus Albrecht · Fri 25 Sep, 08:00". */
  delivery?: string;
  onPeriodChange?: (period: ReportPeriod) => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Disable a step when there is no earlier / later closed period. */
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** Archive (ghost) target; `null` hides it. */
  archiveHref?: string | null;
  /** Download PDF (outline) target. Omitted renders it disabled (no PDF yet); `null` hides it. */
  pdfHref?: string | null;
  /** Share link (ghost). Omitted renders it disabled; `null` hides it. */
  onShare?: (() => void) | null;
};

function ActionLink({ href, icon, label, variant }: { href: string; icon: IconName; label: string; variant: "ghost" | "outline" }) {
  return (
    <Button asChild variant={variant} data-action={label}>
      <Link href={href}>
        <Icon name={icon} size={16} />
        {label}
      </Link>
    </Button>
  );
}

/**
 * Figma `Report header` (02 `455:6915`): period=daily|weekly|monthly. Left: h1 title, prev/next
 * range stepper, mail delivery line. Right: Daily · Weekly · Monthly Segmented, Archive (ghost),
 * Download PDF (outline), Share link (ghost).
 */
function ReportHeader({
  className,
  period,
  range,
  delivery,
  onPeriodChange,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  archiveHref = "/client/reports/archive",
  pdfHref,
  onShare,
}: ReportHeaderProps) {
  return (
    <div
      data-slot="report-header"
      data-period={period}
      className={cn("flex w-full flex-wrap items-center justify-between gap-6 py-6", className)}
    >
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h1 className="type-h1 text-foreground">{REPORT_TITLES[period]}</h1>
        <div data-slot="report-header-range" className="flex items-center gap-2">
          <IconButton icon="chevron-left" label="Previous period" size="sm" variant="outline" onClick={onPrev} disabled={prevDisabled} />
          <span className="type-body-strong whitespace-nowrap text-foreground">{range}</span>
          <IconButton icon="chevron-right" label="Next period" size="sm" variant="outline" onClick={onNext} disabled={nextDisabled} />
        </div>
        {delivery ? (
          <p data-slot="report-header-delivery" className="flex items-center gap-2 type-small text-muted-foreground">
            <Icon name="mail" size={16} />
            {delivery}
          </p>
        ) : null}
      </div>
      <div data-slot="report-header-actions" className="flex flex-wrap items-center gap-3">
        <Segmented
          aria-label="Report period"
          items={PERIOD_ITEMS}
          value={period}
          onValueChange={onPeriodChange ? (value) => onPeriodChange(value as ReportPeriod) : undefined}
        />
        {archiveHref ? <ActionLink href={archiveHref} icon="archive" label="Archive" variant="ghost" /> : null}
        {pdfHref ? (
          <ActionLink href={pdfHref} icon="download" label="Download PDF" variant="outline" />
        ) : pdfHref === undefined ? (
          <Button variant="outline" disabled data-action="Download PDF">
            <Icon name="download" size={16} />
            Download PDF
          </Button>
        ) : null}
        {onShare !== null ? (
          <Button variant="ghost" onClick={onShare} disabled={!onShare} data-action="Share link">
            <Icon name="share-2" size={16} />
            Share link
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export { REPORT_TITLES, ReportHeader };
export type { ReportHeaderProps, ReportPeriod };
