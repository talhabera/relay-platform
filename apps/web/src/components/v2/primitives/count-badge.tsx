import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/** Figma `Count badge` (02 `348:594`): numeric pill for nav items, tabs and inbox counts. */
const countBadgeVariants = cva(
  "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 type-label tabular-nums",
  {
    variants: {
      tone: {
        neutral: "bg-secondary text-secondary-foreground",
        primary: "bg-primary text-primary-foreground",
        warning: "bg-warning text-warning-foreground",
        destructive: "bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type CountBadgeProps = Omit<React.ComponentProps<"span">, "children"> & {
  count: number;
  tone?: "neutral" | "primary" | "warning" | "destructive";
  /** Counts above this render as `${max}+` (default 99). */
  max?: number;
};

function CountBadge({ className, count, tone = "neutral", max = 99, ...props }: CountBadgeProps) {
  return (
    <span
      data-slot="count-badge"
      data-tone={tone}
      className={cn(countBadgeVariants({ tone }), className)}
      {...props}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

export { CountBadge, countBadgeVariants };
export type { CountBadgeProps };
