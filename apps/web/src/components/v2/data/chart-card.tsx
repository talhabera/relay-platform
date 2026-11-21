"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";

import { Icon } from "../primitives/icon";
import { chartColor, chartTheme } from "./chart-theme";

type ChartPoint = { label: string; value: number | null };
type FunnelStage = { label: string; value: number; note?: string };
type DonutSegment = { label: string; value: number };

type ChartCardData =
  /** Weekly trend: area under a chart-1 line, dot on the latest point. */
  | { type: "line"; points: ChartPoint[] }
  /** Per day: chart-1 bars at 55%, `highlightIndex` (default: last non-null) at full; null = future stub. */
  | { type: "bar"; points: ChartPoint[]; highlightIndex?: number }
  /** Lead engine stages: horizontal bars scaled to the first stage, fading per stage. */
  | { type: "funnel"; stages: FunnelStage[] }
  /** Share with legend: chart-1..5 arcs on a muted track, total in the middle. */
  | { type: "donut"; segments: DonutSegment[]; centerLabel?: string; centerValue?: string };

type ChartCardProps = Omit<React.ComponentProps<"section">, "title"> & {
  title: string;
  /** Tooltip text for the info icon next to the title. */
  info?: string;
  value: string;
  /** e.g. "+1". Sign picks trending-up (success) or trending-down (destructive). */
  delta?: string;
  /** e.g. "vs last week". */
  comparison?: string;
  data: ChartCardData;
};

const PLOT_HEIGHT = 140;
/** Figma funnel bar width for the largest stage. */
const FUNNEL_MAX = 180;
/** Smallest stage stays visible (Figma Delivered = 8). */
const FUNNEL_MIN = 8;
const FUNNEL_OPACITY = [1, 0.8, 0.65, 0.5];
const DONUT_SIZE = 128;

function lastIndex(points: ChartPoint[]) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value != null) return i;
  return -1;
}

function XLabels({ points, inset }: { points: ChartPoint[]; inset?: boolean }) {
  return (
    <div
      data-slot="chart-card-x-axis"
      className={cn("flex w-full items-start justify-between type-caption text-muted-foreground", inset && "px-2")}
    >
      {points.map((p) => (
        <span key={p.label}>{p.label}</span>
      ))}
    </div>
  );
}

function LinePlot({ points }: { points: ChartPoint[] }) {
  const last = lastIndex(points);
  const gradientId = React.useId();
  return (
    <>
      <div data-slot="chart-card-plot" className="h-35 w-full">
        <ResponsiveContainer width="100%" height={PLOT_HEIGHT} initialDimension={{ width: 360, height: PLOT_HEIGHT }}>
          <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor(0)} stopOpacity={chartTheme.areaOpacity} />
                <stop offset="100%" stopColor={chartColor(0)} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={chartTheme.grid} />
            <XAxis dataKey="label" hide />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip {...chartTheme.tooltip} cursor={{ stroke: chartTheme.grid }} />
            <Area
              type="linear"
              dataKey="value"
              stroke={chartColor(0)}
              strokeWidth={chartTheme.strokeWidth}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number }) =>
                props.index === last && props.cx != null && props.cy != null ? (
                  <circle key="last" cx={props.cx} cy={props.cy} r={4} fill={chartColor(0)} />
                ) : (
                  <g key={props.index} />
                )
              }
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <XLabels points={points} />
    </>
  );
}

function BarPlot({ points, highlightIndex }: { points: ChartPoint[]; highlightIndex?: number }) {
  const highlight = highlightIndex ?? lastIndex(points);
  const data = points.map((p) => ({ label: p.label, value: p.value ?? 0, empty: p.value == null || p.value === 0 }));
  return (
    <>
      <div data-slot="chart-card-plot" className="h-35 w-full">
        <ResponsiveContainer width="100%" height={PLOT_HEIGHT} initialDimension={{ width: 360, height: PLOT_HEIGHT }}>
          <BarChart data={data} margin={{ top: 0, right: 4, bottom: 0, left: 4 }} barSize={32}>
            <CartesianGrid vertical={false} stroke={chartTheme.grid} />
            <XAxis dataKey="label" hide />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip {...chartTheme.tooltip} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} minPointSize={2} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell
                  key={d.label}
                  fill={d.empty ? chartTheme.grid : chartColor(0)}
                  fillOpacity={d.empty || i === highlight ? 1 : chartTheme.barOpacity}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <XLabels points={points} inset />
    </>
  );
}

function FunnelPlot({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div data-slot="chart-card-plot" className="flex w-full flex-col items-start gap-3">
      {stages.map((s, i) => (
        <div key={s.label} data-slot="chart-card-stage" className="flex w-full items-center gap-3 overflow-hidden">
          <span className="w-19 shrink-0 type-small text-muted-foreground">{s.label}</span>
          <span
            aria-hidden
            data-slot="chart-card-funnel-bar"
            className="h-5 shrink-0 rounded-sm bg-chart-1"
            style={{
              width: Math.max(FUNNEL_MIN, Math.round((s.value / max) * FUNNEL_MAX)),
              opacity: FUNNEL_OPACITY[Math.min(i, FUNNEL_OPACITY.length - 1)],
            }}
          />
          <span className="shrink-0 type-body-strong text-foreground">{s.value}</span>
          {s.note ? <span className="truncate type-caption text-muted-foreground">{s.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

function DonutPlot({ segments, centerLabel, centerValue }: { segments: DonutSegment[]; centerLabel?: string; centerValue?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div data-slot="chart-card-plot" className="flex w-full items-center gap-6">
      <div className="relative size-32 shrink-0">
        <PieChart width={DONUT_SIZE} height={DONUT_SIZE}>
          <Pie
            data={[{ value: 1 }]}
            dataKey="value"
            innerRadius={50}
            outerRadius={64}
            stroke="none"
            fill={chartTheme.track}
            isAnimationActive={false}
          />
          <Pie
            data={segments}
            dataKey="value"
            nameKey="label"
            innerRadius={50}
            outerRadius={64}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
          >
            {segments.map((s, i) => (
              <Cell key={s.label} fill={chartColor(i)} />
            ))}
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="type-body-strong text-foreground">{centerValue ?? total}</span>
          {centerLabel ? <span className="type-caption text-muted-foreground">{centerLabel}</span> : null}
        </div>
      </div>
      <ul data-slot="chart-card-legend" className="flex min-w-0 flex-1 flex-col gap-3">
        {segments.map((s, i) => (
          <li key={s.label} className="flex w-full items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: chartColor(i) }} />
            <span className="min-w-0 flex-1 type-small text-foreground">{s.label}</span>
            <span className="shrink-0 type-body-strong text-foreground">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Figma `Chart card` (02 `380:28558`): analytics card with title + info, metric value, delta and
 * a plot. type line (weekly trend) | bar (per day) | funnel (Lead engine stages) | donut (share).
 * Recharts marks use `chartTheme` (semantic chart-1..5).
 */
function ChartCard({ className, title, info, value, delta, comparison, data, ...props }: ChartCardProps) {
  const down = delta?.trim().startsWith("-") || delta?.trim().startsWith("−");
  return (
    <section
      data-slot="chart-card"
      data-type={data.type}
      className={cn("flex w-full flex-col items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-elevation-1", className)}
      {...props}
    >
      <header className="flex w-full items-center gap-2 overflow-hidden">
        <h3 className="truncate type-body-strong text-foreground">{title}</h3>
        <Icon name="info" size={14} className="text-muted-foreground" aria-label={info} />
      </header>
      <div className="flex items-baseline gap-3 overflow-hidden">
        <span data-slot="chart-card-value" className="type-metric text-foreground">
          {value}
        </span>
        {delta || comparison ? (
          <span className="flex items-center gap-1">
            {delta ? (
              <>
                <Icon
                  name={down ? "trending-down" : "trending-up"}
                  size={14}
                  className={down ? "text-destructive" : "text-success"}
                />
                <span data-slot="chart-card-delta" className={cn("type-caption", down ? "text-destructive" : "text-success")}>
                  {delta}
                </span>
              </>
            ) : null}
            {comparison ? <span className="type-caption text-muted-foreground">{comparison}</span> : null}
          </span>
        ) : null}
      </div>
      {data.type === "line" ? <LinePlot points={data.points} /> : null}
      {data.type === "bar" ? <BarPlot points={data.points} highlightIndex={data.highlightIndex} /> : null}
      {data.type === "funnel" ? <FunnelPlot stages={data.stages} /> : null}
      {data.type === "donut" ? (
        <DonutPlot segments={data.segments} centerLabel={data.centerLabel} centerValue={data.centerValue} />
      ) : null}
    </section>
  );
}

export { ChartCard };
export type { ChartCardData, ChartCardProps, ChartPoint, DonutSegment, FunnelStage };
