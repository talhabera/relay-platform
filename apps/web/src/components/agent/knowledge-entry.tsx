import * as React from "react";

import { Button } from "@/components/ui/button";
import { Icon, ProgressBar, StatusChip } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import type { KnowledgeEntryView } from "./knowledge-model";

type KnowledgeEntryProps = Omit<React.ComponentProps<"div">, "children"> & {
  name: string;
  view: KnowledgeEntryView;
  /** Row menu (Icon button ghost sm + dropdown); omitted for read-only viewers. */
  menu?: React.ReactNode;
  /** Error line Retry; omitted hides the button. */
  onRetry?: () => void;
  retrying?: boolean;
};

/**
 * Figma `Knowledge entry` (07 `_local` 534:74441): a Binding-row header (type icon, name, row menu),
 * a meta line (source, updated, Status chip Ready / Processing / Error), and an optional progress
 * bar (processing website) or error line with Retry.
 */
export function KnowledgeEntry({ className, name, view, menu, onRetry, retrying, ...props }: KnowledgeEntryProps) {
  return (
    <div
      data-slot="knowledge-entry"
      data-kind={view.kind}
      data-status={view.status.tone}
      className={cn("flex w-full flex-col rounded-lg border border-border bg-card pb-2", className)}
      {...props}
    >
      <div className="flex h-12 w-full items-center gap-2 px-3 py-1">
        <Icon name={view.icon} size={24} className="shrink-0 text-foreground" />
        <p className="min-w-0 flex-1 truncate type-body-strong text-foreground" title={name}>
          {name}
        </p>
        {menu ? <div className="shrink-0">{menu}</div> : <span className="size-8 shrink-0" aria-hidden />}
      </div>
      <div className="flex w-full items-center gap-3 pl-11 pr-3">
        <span className="min-w-0 flex-1 truncate type-caption text-muted-foreground">{view.source}</span>
        <span className="shrink-0 type-caption text-muted-foreground" suppressHydrationWarning>
          {view.updated}
        </span>
        <StatusChip tone={view.status.tone} className="shrink-0">
          {view.status.label}
        </StatusChip>
      </div>
      {view.progress ? (
        <div data-slot="knowledge-entry-progress" className="flex w-full items-center gap-2 pl-11 pr-3 pt-2">
          <ProgressBar
            value={view.progress.value}
            max={view.progress.max}
            aria-label={`${name} reading progress`}
            className="min-w-0 flex-1"
          />
          <span className="shrink-0 type-caption text-muted-foreground">{view.progress.label}</span>
        </div>
      ) : null}
      {view.error ? (
        <div data-slot="knowledge-entry-error" className="flex w-full items-center gap-2 pl-11 pr-3 pt-2">
          <Icon name="circle-alert" size={14} className="shrink-0 text-destructive" />
          <p role="alert" className="min-w-0 flex-1 type-small text-destructive">
            {view.error}
          </p>
          {onRetry ? (
            <Button variant="outline" size="sm" className="shrink-0" onClick={onRetry} disabled={retrying}>
              <Icon name="refresh-cw" size={16} className={retrying ? "animate-spin" : undefined} />
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
