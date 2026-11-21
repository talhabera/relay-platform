"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useCompany } from "@/components/shared/company-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconButton } from "@/components/v2/primitives/icon-button";
import { NeedsYouPanel } from "@/components/v2/work";
import type { NeedsYouList } from "@/lib/operator/needs-you";
import {
  NEEDS_YOU_PATH,
  toNeedsYouRow,
  type NeedsYouItemLike,
} from "@/lib/operator/needs-you-view";

/** Re-read the bell while the tab is open; the list is cheap and viewer-filtered. */
const POLL_MS = 60_000;

type BellList = { items: NeedsYouItemLike[]; total: number };

/** Accessible name of the bell; carries the count the dot stands for. */
export function needsYouBellLabel(total: number): string {
  if (total <= 0) return "Needs you: nothing open";
  return `Needs you: ${total} open`;
}

/**
 * App header bell (Figma 06 `06/needs-you/panel-open`, entry-points 3): a dot while anything
 * is open; opens the Needs you panel with the top 5 from any tab. Count = the viewer's list length.
 */
export function NeedsYouBell() {
  const { activeCompanyId } = useCompany();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [list, setList] = React.useState<BellList>({ items: [], total: 0 });

  React.useEffect(() => {
    if (!activeCompanyId) {
      setList({ items: [], total: 0 });
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/operator/needs-you?companyId=${encodeURIComponent(activeCompanyId)}&view=top`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as NeedsYouList;
        if (!cancelled) setList({ items: data.items, total: data.total });
      } catch {
        // Offline or aborted: keep the last list.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
    // Re-read on navigation too: approving on a page changes the list.
  }, [activeCompanyId, pathname]);

  const now = new Date();
  const rows = list.items.map((item) => toNeedsYouRow(item, now));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon="bell"
          label={needsYouBellLabel(list.total)}
          dot={list.total > 0}
          data-count={list.total}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-100 max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none"
        onClick={(e) => {
          // Close after following any link inside the panel.
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        <NeedsYouPanel
          items={rows}
          total={list.total}
          viewAllHref={NEEDS_YOU_PATH}
          operatorHref="/operator"
          className="max-h-[calc(100svh-6rem)] overflow-y-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
