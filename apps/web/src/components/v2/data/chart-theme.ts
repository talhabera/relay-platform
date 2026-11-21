import type { CSSProperties } from "react";

/**
 * Recharts theme for v2 charts. Every value is a CSS var from globals.css so dark/light swap
 * without re-render. Marks use semantic/chart-1..5 (Figma `Chart card` 02 `380:28558`).
 */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

const chartTheme = {
  colors: CHART_COLORS,
  /** Gridlines and empty (future) bars. */
  grid: "var(--border)",
  /** Donut track. */
  track: "var(--muted)",
  axisTick: { fill: "var(--muted-foreground)", fontSize: 12 } satisfies CSSProperties,
  /** Inactive bars (Figma opacity 55%); the highlighted bar is full. */
  barOpacity: 0.55,
  /** Line area fill: chart-1 gradient from this opacity to 0. */
  areaOpacity: 0.35,
  strokeWidth: 2,
  tooltip: {
    contentStyle: {
      background: "var(--popover)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg, 10px)",
      color: "var(--popover-foreground)",
      fontSize: 12,
      boxShadow: "var(--shadow-elevation-1)",
    } satisfies CSSProperties,
    labelStyle: { color: "var(--muted-foreground)" } satisfies CSSProperties,
    cursor: { fill: "var(--accent)", opacity: 0.5 },
  },
} as const;

/** Colour for series/segment `i` (wraps after chart-5). */
function chartColor(i: number): string {
  return CHART_COLORS[((i % CHART_COLORS.length) + CHART_COLORS.length) % CHART_COLORS.length];
}

export { CHART_COLORS, chartColor, chartTheme };
