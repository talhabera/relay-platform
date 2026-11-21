import Link from "next/link";
import * as React from "react";

import { Icon, StatusChip } from "@/components/v2/primitives";
import type { ArchiveView } from "@/lib/reports/archive";
import { cn } from "@/lib/utils";

function Panel({ slot, className, children }: { slot: string; className?: string; children: React.ReactNode }) {
  return (
    <section
      data-slot={slot}
      className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevation-1", className)}
    >
      {children}
    </section>
  );
}

function PanelHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
      <h2 className="type-h3 text-foreground">{title}</h2>
      <span className="type-small text-muted-foreground">
        {count} {count === 1 ? "report" : "reports"}
      </span>
    </div>
  );
}

function ColumnHeads({ when }: { when: string }) {
  return (
    <div className="hidden grid-cols-[minmax(0,1fr)_12rem_8rem_2rem] gap-4 border-b border-border px-5 py-2 type-label text-muted-foreground sm:grid">
      <span>Report</span>
      <span>{when}</span>
      <span>Status</span>
      <span aria-hidden />
    </div>
  );
}

function ReportCell({ icon, title, range }: { icon: "file-text" | "calendar-clock"; title: string; range: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
        <Icon name={icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="type-body-strong text-foreground">{title}</span>
        <span className="type-small text-muted-foreground">{range}</span>
      </span>
    </span>
  );
}

const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_12rem_8rem_2rem]";

/**
 * Report archive body (S71, Figma 11a `11/reports/archive`): Delivered and
 * Scheduled tables beside the read-only Delivery card. Download PDF (S89) is
 * not built, so rows carry only the open-report link.
 */
export function ArchiveBody({ view }: { view: ArchiveView }) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel slot="archive-delivered">
          <PanelHeader title="Delivered" count={view.delivered.length} />
          {view.delivered.length === 0 ? (
            <p data-slot="archive-empty" className="px-5 py-8 text-center type-small text-muted-foreground">
              No closed reports yet. A report appears here once its period closes.
            </p>
          ) : (
            <>
              <ColumnHeads when="Ready" />
              <ul className="flex flex-col divide-y divide-border">
                {view.delivered.map((row) => (
                  <li key={row.id} data-slot="archive-row" data-period={row.period}>
                    <Link href={row.href} className={cn(ROW, "transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none")}>
                      <ReportCell icon="file-text" title={row.title} range={row.rangeLabel} />
                      <span className="flex items-center gap-2 type-small text-foreground max-sm:col-start-1">
                        <Icon name="clock" size={16} className="text-muted-foreground" />
                        {row.readyLabel}
                      </span>
                      <StatusChip tone="success" className="max-sm:col-start-1">
                        Ready
                      </StatusChip>
                      <Icon name="chevron-right" size={16} className="justify-self-end text-muted-foreground max-sm:col-start-2 max-sm:row-start-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel slot="archive-scheduled">
          <PanelHeader title="Scheduled" count={view.scheduled.length} />
          <ColumnHeads when="Closes" />
          <ul className="flex flex-col divide-y divide-border">
            {view.scheduled.map((row) => (
              <li key={row.period} data-slot="archive-scheduled-row" data-period={row.period} className={ROW}>
                <ReportCell icon="calendar-clock" title={row.title} range={row.rangeLabel} />
                <span className="flex items-center gap-2 type-small text-foreground max-sm:col-start-1">
                  <Icon name="clock" size={16} className="text-muted-foreground" />
                  {row.closesLabel}
                </span>
                <StatusChip tone="pending" className="max-sm:col-start-1">
                  Scheduled
                </StatusChip>
                <span aria-hidden className="max-sm:hidden" />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel slot="archive-delivery" className="gap-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="type-h3 text-foreground">Delivery</h2>
          <span className="flex items-center gap-1 type-small text-muted-foreground">
            <Icon name="lock" size={14} />
            Set by your agency
          </span>
        </div>
        <span className="type-label text-muted-foreground">Schedule</span>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {view.schedule.map((s) => (
            <li key={s.period} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="type-body text-foreground">{s.title}</span>
              <span className="type-small text-muted-foreground">{s.cadence}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 rounded-lg bg-muted px-4 py-3 type-small text-muted-foreground">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          Your agency manages delivery. Ask them to change the recipients or the times.
        </p>
      </Panel>
    </div>
  );
}
