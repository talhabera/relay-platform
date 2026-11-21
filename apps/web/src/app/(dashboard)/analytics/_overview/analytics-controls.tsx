"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon, Segmented } from "@/components/v2/primitives";

import {
  ANALYTICS_VIEW_LABELS,
  ANALYTICS_VIEWS,
  ENABLED_VIEWS,
  type AnalyticsView,
  type WeekChoice,
} from "./overview-model";

type AnalyticsControlsProps = {
  view: AnalyticsView;
  week: WeekChoice;
  /** Label per week choice, e.g. "This week · 21–27 Sep"; null hides the picker. */
  weekOptions: { value: WeekChoice; label: string }[] | null;
  /** CSV export of the view and week; null disables Export (no data, or a view it does not cover). */
  exportHref: string | null;
};

/** Title-row controls (08b `411:38344`): view segments, week picker, export. */
export function AnalyticsControls({ view, week, weekOptions, exportHref }: AnalyticsControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string, fallback: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === fallback) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <>
      <Segmented
        aria-label="Analytics view"
        items={ANALYTICS_VIEWS.map((v) => ({
          value: v,
          label: ANALYTICS_VIEW_LABELS[v],
          disabled: !ENABLED_VIEWS.has(v),
        }))}
        value={view}
        onValueChange={(v) => setParam("view", v, "overview")}
      />
      {weekOptions ? (
        <Select value={week} onValueChange={(v) => setParam("week", v, "this")}>
          <SelectTrigger aria-label="Week" className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {weekOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button asChild variant="outline">
        <Link href="/analytics/spend">
          <Icon name="table" />
          Harcama girişi
        </Link>
      </Button>
      {exportHref ? (
        <Button asChild>
          <a href={exportHref} download>
            <Icon name="download" />
            Export report
          </a>
        </Button>
      ) : (
        <Button
          disabled
          title={view === "agents" ? "Export covers Overview and Lead quality" : "No data to export for this week"}
        >
          <Icon name="download" />
          Export report
        </Button>
      )}
    </>
  );
}
