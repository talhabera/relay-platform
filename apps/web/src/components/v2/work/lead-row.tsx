import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { Chip } from "../primitives/chip";
import { IconButton } from "../primitives/icon-button";
import { ScoreRing, type ScoreTone } from "../primitives/score-ring";
import { StatusChip } from "../primitives/status-chip";

/** Lead-row fit tone (Figma `Lead row` description): high >= 85, mid 70-84, low < 70. */
function leadFitTone(score: number): ScoreTone {
  if (score >= 85) return "high";
  if (score >= 70) return "mid";
  return "low";
}

/** Two-letter avatar initials: "Brandt Logistik GmbH" -> "BL", "AlphaLog" -> "AL". */
function leadInitials(company: string): string {
  const words = company.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const columns = {
  select: "flex w-6 shrink-0 items-center px-1 py-2",
  company: "flex h-9 min-w-60 flex-1 items-center gap-2 overflow-hidden",
  contact: "flex w-32 shrink-0 flex-col overflow-hidden",
  fit: "flex h-10 w-11 shrink-0 items-center overflow-hidden",
  why: "flex w-63 shrink-0 items-center gap-2 overflow-hidden",
  menu: "size-8 shrink-0",
} as const;

const rowClass = "flex items-center gap-3 border-b border-border px-3 py-2";
const headerCell = "truncate type-label text-muted-foreground";

type LeadRowHeaderProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Header checkbox: true, false or "indeterminate" (some rows selected). */
  allSelected?: boolean | "indeterminate";
  onAllSelectedChange?: (selected: boolean) => void;
};

/** Figma `Lead row` variant=header (02 `376:23949`). */
function LeadRowHeader({ className, allSelected = false, onAllSelectedChange, ...props }: LeadRowHeaderProps) {
  return (
    <div role="row" data-slot="lead-row" data-variant="header" className={cn(rowClass, className)} {...props}>
      <div role="columnheader" className={columns.select}>
        <Checkbox
          aria-label="Select all leads"
          checked={allSelected}
          onCheckedChange={(v) => onAllSelectedChange?.(v === true)}
        />
      </div>
      <div role="columnheader" className={cn(columns.company, headerCell)}>
        Company
      </div>
      <div role="columnheader" className={cn(columns.contact, headerCell)}>
        Contact
      </div>
      <div role="columnheader" className={cn(columns.fit, headerCell)}>
        Fit
      </div>
      <div role="columnheader" className={cn(columns.why, headerCell)}>
        Why
      </div>
      <div aria-hidden className={columns.menu} />
    </div>
  );
}

type LeadRowProps = Omit<React.ComponentProps<"div">, "children"> & {
  company: string;
  /** Second company line, e.g. "Munich · 180 employees". */
  companyMeta?: string;
  /** Decision maker; null renders the "Not found" state. */
  contactName: string | null;
  /** Contact role, or the reason when no contact was found. */
  contactMeta?: string;
  /** Fit score 0-100; null until scored. */
  fitScore: number | null;
  /** 1-3 short fit reasons (Chip sm). */
  reasons: string[];
  /** Borderline leads add a needs-you "Borderline" Status chip. */
  borderline?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onMenu?: () => void;
  /** Avatar initials override. */
  initials?: string;
};

/** Figma `Lead row` (02 `376:23980`): variant qualified | borderline x selected. */
function LeadRow({
  className,
  company,
  companyMeta,
  contactName,
  contactMeta,
  fitScore,
  reasons,
  borderline = false,
  selected = false,
  onSelectedChange,
  onMenu,
  initials,
  ...props
}: LeadRowProps) {
  return (
    <div
      role="row"
      aria-selected={selected}
      data-slot="lead-row"
      data-variant={borderline ? "borderline" : "qualified"}
      data-selected={selected}
      className={cn(rowClass, selected && "bg-primary-soft", className)}
      {...props}
    >
      <div role="cell" className={columns.select}>
        <Checkbox
          aria-label={`Select ${company}`}
          checked={selected}
          onCheckedChange={(v) => onSelectedChange?.(v === true)}
        />
      </div>
      <div role="cell" className={columns.company}>
        <span
          data-slot="lead-row-avatar"
          aria-hidden
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft type-caption text-primary-soft-foreground"
        >
          {initials ?? leadInitials(company)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden whitespace-nowrap">
          <span className="truncate type-body-strong text-foreground">{company}</span>
          {companyMeta ? <span className="truncate type-caption text-muted-foreground">{companyMeta}</span> : null}
        </div>
      </div>
      <div role="cell" data-slot="lead-row-contact" className={cn(columns.contact, "whitespace-nowrap")}>
        <span className={cn("truncate type-small", contactName ? "text-foreground" : "text-muted-foreground")}>
          {contactName ?? "Not found"}
        </span>
        {contactMeta ? <span className="truncate type-caption text-muted-foreground">{contactMeta}</span> : null}
      </div>
      <div role="cell" className={columns.fit}>
        {fitScore !== null ? (
          <ScoreRing value={fitScore} tone={leadFitTone(fitScore)} aria-label={`Fit score ${fitScore}`} />
        ) : (
          <span className="type-caption text-muted-foreground">-</span>
        )}
      </div>
      <div role="cell" className={columns.why}>
        {borderline ? <StatusChip tone="needs-you">Borderline</StatusChip> : null}
        {reasons.map((reason) => (
          <Chip key={reason} asStatic>
            {reason}
          </Chip>
        ))}
      </div>
      <div role="cell" className={columns.menu}>
        <IconButton icon="ellipsis" size="sm" label={`More actions for ${company}`} onClick={onMenu} />
      </div>
    </div>
  );
}

export { LeadRow, LeadRowHeader, leadFitTone, leadInitials };
export type { LeadRowProps, LeadRowHeaderProps };
