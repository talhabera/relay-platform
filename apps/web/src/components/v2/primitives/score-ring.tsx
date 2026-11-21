import * as React from "react";

import { cn } from "@/lib/utils";

type ScoreTone = "high" | "mid" | "low";

/** high >= 75 (success), mid 50-74 (warning), low < 50 (destructive). */
function scoreTone(value: number): ScoreTone {
  if (value >= 75) return "high";
  if (value >= 50) return "mid";
  return "low";
}

const arcClass: Record<ScoreTone, string> = {
  high: "stroke-success",
  mid: "stroke-warning",
  low: "stroke-destructive",
};

type ScoreRingProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Score 0-100. */
  value: number;
  /** Override the derived tone. */
  tone?: ScoreTone;
};

const SIZE = 40;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Figma `Score ring` (02 `354:610`): 40x40 gauge, 3px secondary track, arc from 12 o'clock. */
function ScoreRing({ className, value, tone, ...props }: ScoreRingProps) {
  const score = Math.round(Math.min(Math.max(value, 0), 100));
  const t = tone ?? scoreTone(score);
  const offset = CIRCUMFERENCE * (1 - score / 100);
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      data-slot="score-ring"
      data-tone={t}
      className={cn("relative inline-flex size-10 shrink-0 items-center justify-center", className)}
      {...props}
    >
      <svg aria-hidden width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-secondary" />
        <circle
          data-slot="score-ring-arc"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className={arcClass[t]}
        />
      </svg>
      <span className="relative type-label text-foreground tabular-nums">{score}</span>
    </div>
  );
}

export { ScoreRing, scoreTone };
export type { ScoreRingProps, ScoreTone };
