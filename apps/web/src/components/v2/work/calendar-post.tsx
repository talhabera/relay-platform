import * as React from "react";

import { cn } from "@/lib/utils";

import { BrandGlyph } from "../primitives/brand-glyph";
import { Icon } from "../primitives/icon";

type CalendarPostStatus = "scheduled" | "needs-review" | "draft";
type CalendarPostPlatform = "instagram" | "facebook" | "linkedin";

const statusStyle: Record<CalendarPostStatus, { label: string; dot: string; border: string }> = {
  scheduled: { label: "Scheduled", dot: "bg-success", border: "border-border" },
  "needs-review": { label: "Needs review", dot: "bg-warning", border: "border-status-needs-you-foreground" },
  draft: { label: "Draft", dot: "bg-muted-foreground", border: "border-border" },
};

const platformLabel: Record<CalendarPostPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

type CalendarPostProps = Omit<React.ComponentProps<"button">, "children"> & {
  title: string;
  status?: CalendarPostStatus;
  platform: CalendarPostPlatform;
};

/**
 * Figma `Calendar post` (02 `376:24588`): post in the Content calendar month grid.
 * Brand glyph 16 on a token-gradient placeholder tile (no photo); needs-review adds an amber border.
 */
function CalendarPost({ className, title, status = "scheduled", platform, ...props }: CalendarPostProps) {
  const s = statusStyle[status];
  return (
    <button
      type="button"
      data-slot="calendar-post"
      data-status={status}
      data-platform={platform}
      aria-label={`${title}, ${platformLabel[platform]}, ${s.label}`}
      className={cn(
        "flex w-30 flex-col items-start gap-2 rounded-lg border bg-surface-raised p-2 text-left outline-none transition-[background-color,box-shadow] hover:bg-accent focus-visible:shadow-focus-ring",
        s.border,
        className,
      )}
      {...props}
    >
      <span
        data-slot="calendar-post-thumbnail"
        className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-md bg-linear-to-r from-accent to-primary-soft"
      >
        <Icon name="image" size={18} className="text-muted-foreground" />
        <BrandGlyph brand={platform} size={16} className="absolute top-1 left-1" />
      </span>
      <span className="w-full type-caption text-foreground">{title}</span>
      <span className="flex w-full items-center gap-1">
        <span aria-hidden data-slot="calendar-post-dot" className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
        <span className="whitespace-nowrap type-caption text-muted-foreground">{s.label}</span>
      </span>
    </button>
  );
}

export { CalendarPost };
export type { CalendarPostPlatform, CalendarPostProps, CalendarPostStatus };
