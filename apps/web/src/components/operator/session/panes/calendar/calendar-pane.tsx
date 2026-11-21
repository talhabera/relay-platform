"use client";

import { useState } from "react";
import { CalendarDays, CalendarPlus } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessionSteer } from "@/components/operator/session-steer";
import { Icon } from "@/components/v2/primitives/icon";
import { IconButton } from "@/components/v2/primitives/icon-button";
import { StatusChip } from "@/components/v2/primitives/status-chip";
import { WorkPaneHeader } from "@/components/v2/session/work-pane-header";
import { CalendarPost } from "@/components/v2/work/calendar-post";
import { cn } from "@/lib/utils";

import {
  calendarCsv,
  calendarPaneMeta,
  calendarPaneState,
  monthCounts,
  monthGrid,
  monthLabel,
  parseMonth,
  postsByDate,
  shiftMonth,
  shortDate,
  WEEKDAYS,
  type CalendarMonth,
  type CalendarPostItem,
  type ContentCalendar,
} from "./calendar-pane-model";

export type CalendarPaneProps = {
  /** A social connector (Meta or LinkedIn) is connected for the company. */
  socialConnected: boolean;
  /** Null until the content calendar model lands (phase 2); fixtures fill it in dev. */
  calendar: ContentCalendar | null;
  /** ISO "now" from the server; the fallback month when the calendar has none. */
  now: string;
  /** Viewer may steer the session (Add post, open a post). */
  canAct: boolean;
  /** Where "Connect Meta" goes. */
  connectHref?: string;
};

/**
 * Calendar work pane (05 session-calendar/default): Work pane header, month
 * nav with scheduled / need-review counts, and a Monday-first month grid of
 * Calendar posts. Without a social connector it is a Connect empty state.
 */
export function CalendarPane({
  socialConnected,
  calendar,
  now,
  canAct,
  connectHref = "/settings/connectors",
}: CalendarPaneProps) {
  const state = calendarPaneState({ socialConnected, calendar });

  return (
    <section
      aria-label="Content calendar"
      data-slot="calendar-pane"
      data-state={state}
      className="flex min-h-0 w-full flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-elevation-1"
    >
      {state === "connect" ? (
        <EmptyState
          icon={CalendarDays}
          className="my-auto py-12"
          title="Connect Meta to plan posts"
          description="The Social Media Manager plans posts here and publishes them to Instagram and Facebook once you approve. Connect Meta or LinkedIn to see the calendar."
          action={{ label: "Connect Meta", href: connectHref }}
        />
      ) : state === "empty" || !calendar ? (
        <EmptyState
          icon={CalendarPlus}
          className="my-auto py-12"
          title="No posts planned yet"
          description="The Social Media Manager plans the month in this session. Posts show up here once the first one is drafted."
        />
      ) : (
        <Calendar calendar={calendar} now={now} canAct={canAct} />
      )}
    </section>
  );
}

function fallbackMonth(now: string): CalendarMonth {
  const d = new Date(now);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function Calendar({ calendar, now, canAct }: { calendar: ContentCalendar; now: string; canAct: boolean }) {
  const steer = useSessionSteer();
  const [month, setMonth] = useState<CalendarMonth>(() => parseMonth(calendar.month) ?? fallbackMonth(now));

  const counts = monthCounts(calendar.posts, month);
  const byDate = postsByDate(calendar.posts);
  const weeks = monthGrid(month);
  const canSteer = canAct && steer.send !== null;

  function openPost(post: CalendarPostItem) {
    steer.send?.(`Open the post "${post.title}" planned for ${shortDate(post.date)}`);
  }

  function exportCsv() {
    const blob = new Blob([calendarCsv(calendar.posts, month)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `content-calendar-${month.year}-${String(month.month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(calendarPaneMeta(counts, month));
      toast.success("Summary copied");
    } catch {
      toast.error("Could not copy the summary");
    }
  }

  return (
    <>
      <WorkPaneHeader
        icon="calendar"
        title="Content calendar"
        meta={calendarPaneMeta(counts, month)}
        actions={
          <>
            {canSteer ? (
              <Button
                variant="outline"
                size="md"
                disabled={steer.isStreaming}
                onClick={() => steer.send?.(`Add a post to the ${monthLabel(month)} content calendar`)}
              >
                <Icon name="plus" size={16} />
                Add post
              </Button>
            ) : null}
            <Button variant="outline" size="md" disabled={counts.total === 0} onClick={exportCsv}>
              <Icon name="download" size={16} />
              Export
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon="ellipsis" variant="outline" label="More" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void copySummary()}>Copy month summary</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMonth(parseMonth(calendar.month) ?? fallbackMonth(now))}>
                  Back to planned month
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div data-slot="calendar-nav" className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconButton
            icon="chevron-left"
            variant="outline"
            label="Previous month"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          />
          <h3 aria-live="polite" className="min-w-32 text-center type-body-strong text-foreground">
            {monthLabel(month)}
          </h3>
          <IconButton
            icon="chevron-right"
            variant="outline"
            label="Next month"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          />
        </div>
        <div className="flex items-center gap-2">
          <StatusChip tone="success" className="uppercase">
            {`${counts.scheduled} scheduled`}
          </StatusChip>
          {counts.needsReview > 0 ? (
            <StatusChip tone="needs-you" className="uppercase">
              {`${counts.needsReview} ${counts.needsReview === 1 ? "needs" : "need"} review`}
            </StatusChip>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 overflow-auto">
        <div
          role="grid"
          aria-label={monthLabel(month)}
          data-slot="calendar-grid"
          className="grid min-w-[560px] grid-cols-7 overflow-hidden rounded-lg border border-border"
        >
          <div role="row" className="contents">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                role="columnheader"
                className="border-b border-border bg-muted px-2 py-1 type-caption text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>
          {weeks.map((week) => (
            <div role="row" key={week[0].date} className="contents">
              {week.map((day, i) => {
                const posts = day.inMonth ? (byDate.get(day.date) ?? []) : [];
                return (
                  <div
                    role="gridcell"
                    key={day.date}
                    data-slot="calendar-day"
                    data-in-month={day.inMonth}
                    className={cn(
                      "flex min-h-24 min-w-0 flex-col gap-1 border-b border-border p-1.5 [&:nth-last-child(-n+7)]:border-b-0",
                      i < 6 && "border-r",
                      day.inMonth ? "bg-card" : "bg-muted/60",
                    )}
                  >
                    <span
                      className={cn("type-caption", day.inMonth ? "text-foreground" : "text-muted-foreground")}
                    >
                      {day.day}
                    </span>
                    {posts.map((post) => (
                      <CalendarPost
                        key={post.id}
                        title={post.title}
                        platform={post.platform}
                        status={post.status}
                        disabled={!canSteer || steer.isStreaming}
                        onClick={() => openPost(post)}
                        className="w-full max-w-30 disabled:cursor-default disabled:hover:bg-surface-raised [&_[data-slot=calendar-post-thumbnail]]:hidden [&>span:nth-child(2)]:truncate"
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
