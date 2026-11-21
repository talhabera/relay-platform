import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";
import { initials } from "../shell/initials";

type HandoffHeaderProps = {
  className?: string;
  /** Figma `size`: mobile (44px touch targets, overflow menu) | desktop (Take over chat). */
  size?: "mobile" | "desktop";
  /** Company the request comes from, e.g. "Acme GmbH". */
  company: string;
  /** Lock line, e.g. "Secure link for Markus Albrecht · expires 13:46". */
  linkText: string;
  /** Figma BOOLEAN `back`: leading back button for an in-app consumer; link-opened pages leave it off. */
  onBack?: () => void;
  /** Mobile overflow (ellipsis) button. */
  onMore?: () => void;
  /** Desktop "Take over chat" ghost button; omit to hide it (e.g. once taken over). */
  onTakeOver?: () => void;
};

/**
 * Figma `Handoff header` (02 `461:6951`): top bar of the public quick-link page (`/h/[token]`).
 * Initials tile + company name + lock line. Mobile: ghost lg (44) back / more. Desktop: ghost md (40)
 * back and a ghost "Take over chat" button.
 */
function HandoffHeader({ className, size = "mobile", company, linkText, onBack, onMore, onTakeOver }: HandoffHeaderProps) {
  const mobile = size === "mobile";
  const buttonSize = mobile ? "lg" : "md";
  return (
    <header
      data-slot="handoff-header"
      data-size={size}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border bg-background py-3",
        mobile ? "px-4" : "px-8",
        className,
      )}
    >
      {onBack ? <IconButton icon="arrow-left" label="Back" size={buttonSize} onClick={onBack} /> : null}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          data-slot="handoff-header-tile"
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft type-body-strong text-primary-soft-foreground"
        >
          {initials(company)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate type-body-strong text-foreground">{company}</p>
          <p data-slot="handoff-header-link" className="flex min-w-0 items-center gap-1 type-caption text-muted-foreground">
            <Icon name="lock" size={12} />
            <span className="truncate">{linkText}</span>
          </p>
        </div>
      </div>
      {mobile && onMore ? <IconButton icon="ellipsis" label="More" size="lg" onClick={onMore} /> : null}
      {!mobile && onTakeOver ? (
        <Button variant="ghost" onClick={onTakeOver}>
          <Icon name="messages-square" size={16} />
          Take over chat
        </Button>
      ) : null}
    </header>
  );
}

export { HandoffHeader };
export type { HandoffHeaderProps };
