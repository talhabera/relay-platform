"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import { addBriefItemAsTask, markBriefRead, setBriefItemStatus } from "../actions";
import { BRIEF_KIND, type BriefTileItem, type BriefTileModel } from "./home-model";
import { HomeTile } from "./home-view";

function BriefItemRow({
  item,
  pending,
  onDone,
  onAddAsTask,
  onDismiss,
}: {
  item: BriefTileItem;
  pending: boolean;
  onDone: (item: BriefTileItem) => void;
  onAddAsTask: (item: BriefTileItem) => void;
  onDismiss: (item: BriefTileItem) => void;
}) {
  const done = item.status === "done";
  return (
    <li
      data-kind={item.kind}
      data-status={item.status}
      className="flex items-start gap-3 border-b border-border py-2 last:border-b-0"
    >
      <span className="w-5 shrink-0 pt-0.5 font-mono type-small text-muted-foreground">{item.rank}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {item.href ? (
          <Link
            href={item.href}
            className={cn(
              "rounded-sm type-body-strong text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
              done && "line-through",
            )}
          >
            {item.title}
          </Link>
        ) : (
          <span className={cn("type-body-strong text-foreground", done && "line-through")}>{item.title}</span>
        )}
        <span className="type-caption text-muted-foreground">{item.why}</span>
        <span className="flex flex-wrap gap-1 pt-1">
          <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => onDone(item)}>
            Done
          </Button>
          {!item.taskId ? (
            <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => onAddAsTask(item)}>
              Add as task
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => onDismiss(item)}>
            Dismiss
          </Button>
        </span>
      </span>
      <StatusChip tone={BRIEF_KIND[item.kind].tone} className="shrink-0 uppercase">
        {item.kindLabel}
      </StatusChip>
    </li>
  );
}

/** Daily brief tile (`/home#brief`). Opening Home with an unread brief marks it read once. */
export function BriefTile({ companyId, model }: { companyId: string; model: BriefTileModel }) {
  const briefId = model.state === "brief" && model.unread ? model.id : null;
  const [showDismissed, setShowDismissed] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (!briefId) return;
    markBriefRead({ companyId, briefId }).catch((error) => {
      console.error("[home] mark brief read failed", error);
    });
  }, [companyId, briefId]);

  if (model.state === "empty") {
    return (
      <div id="brief" className="scroll-mt-4">
        <HomeTile slot="brief" title={model.title} link={model.action ?? undefined}>
          <p className="type-small text-muted-foreground">{model.copy}</p>
        </HomeTile>
      </div>
    );
  }

  const currentBriefId = model.id;
  function run(action: () => Promise<unknown>) {
    startTransition(async () => {
      try {
        await action();
      } catch (error) {
        console.error("[home] brief item action failed", error);
      }
    });
  }
  function onDone(item: BriefTileItem) {
    run(() => setBriefItemStatus({ companyId, briefId: currentBriefId, rank: item.rank, status: "done" }));
  }
  function onAddAsTask(item: BriefTileItem) {
    run(() => addBriefItemAsTask({ companyId, briefId: currentBriefId, rank: item.rank }));
  }
  function onDismiss(item: BriefTileItem) {
    run(() => setBriefItemStatus({ companyId, briefId: currentBriefId, rank: item.rank, status: "dismissed" }));
  }

  return (
    <div id="brief" className="scroll-mt-4">
      <HomeTile
        slot="brief"
        title={model.title}
        titleExtra={model.unread ? <StatusChip tone="needs-you">New</StatusChip> : null}
      >
        <p className="type-body text-foreground">{model.summary}</p>
        {model.items.length > 0 ? (
          <ol className="flex flex-col">
            {model.items.map((item) => (
              <BriefItemRow
                key={item.rank}
                item={item}
                pending={pending}
                onDone={onDone}
                onAddAsTask={onAddAsTask}
                onDismiss={onDismiss}
              />
            ))}
          </ol>
        ) : null}
        {model.dismissedCount > 0 ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={showDismissed}
              onClick={() => setShowDismissed((shown) => !shown)}
              className="self-start text-muted-foreground"
            >
              {model.dismissedCount} dismissed
            </Button>
            {showDismissed ? (
              <ol className="flex flex-col">
                {model.dismissedItems.map((item) => (
                  <BriefItemRow
                    key={item.rank}
                    item={item}
                    pending={pending}
                    onDone={onDone}
                    onAddAsTask={onAddAsTask}
                    onDismiss={onDismiss}
                  />
                ))}
              </ol>
            ) : null}
          </>
        ) : null}
      </HomeTile>
    </div>
  );
}
