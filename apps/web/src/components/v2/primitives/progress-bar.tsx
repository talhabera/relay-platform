import * as React from "react";

import { cn } from "@/lib/utils";

type ProgressBarProps = Omit<React.ComponentProps<"div">, "children"> & {
  value: number;
  /** Defaults to 100; pass e.g. max=10 with value=6 for step progress. */
  max?: number;
  /** warning when a quota is near its limit. */
  tone?: "primary" | "warning";
};

/** Figma `Progress bar` (02 `353:650`): 8px secondary track, radius/full; width follows the parent. */
function ProgressBar({ className, value, max = 100, tone = "primary", ...props }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const pct = Math.round((clamped / safeMax) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      data-slot="progress-bar"
      data-tone={tone}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    >
      <div
        data-slot="progress-fill"
        className={cn("h-full rounded-full transition-[width]", tone === "warning" ? "bg-warning" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export { ProgressBar };
export type { ProgressBarProps };
