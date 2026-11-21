import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Figma `Status chip` (02 `349:607`): lifecycle and run status pill with a 6px dot.
 * live/draft for versions, pending/needs-you for checkpoints, success/error for runs,
 * neutral for anything else. Replaces `ui/badge` and `shared/status-badge`.
 */
const statusChipVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 type-label",
  {
    variants: {
      tone: {
        live: "bg-status-live text-status-live-foreground",
        draft: "bg-status-draft text-status-draft-foreground",
        pending: "bg-status-pending text-status-pending-foreground",
        "needs-you": "border border-warning bg-status-needs-you text-status-needs-you-foreground",
        success: "bg-status-approved text-status-approved-foreground",
        error: "bg-status-rejected text-status-rejected-foreground",
        neutral: "border border-border bg-secondary text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type StatusTone = "live" | "draft" | "pending" | "needs-you" | "success" | "error" | "neutral";

const defaultLabel: Record<StatusTone, string> = {
  live: "Live",
  draft: "Draft",
  pending: "Pending",
  "needs-you": "Needs you",
  success: "Success",
  error: "Error",
  neutral: "Neutral",
};

type StatusChipProps = React.ComponentProps<"span"> & {
  tone?: StatusTone;
  /** Show the 6px leading dot (Figma `dot`, default on). */
  dot?: boolean;
};

function StatusChip({ className, tone = "neutral", dot = true, children, ...props }: StatusChipProps) {
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      className={cn(statusChipVariants({ tone }), className)}
      {...props}
    >
      {dot ? <span data-slot="status-chip-dot" aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children ?? defaultLabel[tone]}
    </span>
  );
}

export { StatusChip, statusChipVariants };
export type { StatusChipProps, StatusTone };
