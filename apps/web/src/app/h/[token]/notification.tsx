import * as React from "react";

import { BrandGlyph } from "@/components/v2/primitives/brand-glyph";
import { Icon } from "@/components/v2/primitives/icon";
import { IconButton } from "@/components/v2/primitives/icon-button";
import { cn } from "@/lib/utils";

/**
 * The staff notification as the recipient sees it in WhatsApp (Figma 11c
 * `11/handoff/notification`). The copy is the approved utility template in
 * worker `handoff/staff-channel.ts` (`relay_handoff_request`): body
 * "Hi {{1}}, a customer of {{2}} needs you: {{3}}" and a URL button "Open"
 * to `/h/{{1}}`. Keep both in step: a test reads the worker file.
 */
export const HANDOFF_REQUEST_TEMPLATE_BODY = "Hi {{1}}, a customer of {{2}} needs you: {{3}}";
export const HANDOFF_REQUEST_TEMPLATE_BUTTON = "Open";
/** Worker `GREETING_FALLBACK` when the recipient has no name. */
export const HANDOFF_GREETING_FALLBACK = "there";

export type HandoffNotificationInput = {
  recipientName: string | null;
  companyName: string;
  question: string;
};

/** The template body with its three parameters filled, exactly as WhatsApp delivers it. */
export function handoffNotificationBody({ recipientName, companyName, question }: HandoffNotificationInput): string {
  const params = [recipientName?.trim() || HANDOFF_GREETING_FALLBACK, companyName, question];
  return HANDOFF_REQUEST_TEMPLATE_BODY.replace(/\{\{(\d)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}

type HandoffNotificationPreviewProps = HandoffNotificationInput & {
  className?: string;
  /** Sender display name: the company's own WhatsApp Business sender. */
  senderName?: string;
  /** Preformatted time, e.g. "11:46". */
  time: string;
  /** Quick-link URL behind the Open button. */
  href?: string;
};

/**
 * WhatsApp chat chrome around one template message: status bar, chat header
 * (sender, business account), date chip, the bubble with body + Open button,
 * and the message bar. A preview, not a working chat.
 */
function HandoffNotificationPreview({
  className,
  recipientName,
  companyName,
  question,
  senderName,
  time,
  href,
}: HandoffNotificationPreviewProps) {
  const body = handoffNotificationBody({ recipientName, companyName, question });
  return (
    <div
      data-slot="handoff-notification"
      className={cn("flex min-h-dvh w-full flex-col bg-background", className)}
    >
      <div className="flex items-center justify-between bg-card px-6 pt-3 pb-2">
        <span className="type-body-strong text-foreground">{time}</span>
        <span className="type-caption text-muted-foreground">WhatsApp</span>
      </div>
      <div className="flex items-center gap-2 border-b border-border bg-card pt-2 pr-3 pb-3 pl-2">
        <IconButton icon="arrow-left" label="Back" size="lg" />
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <BrandGlyph brand="whatsapp" size={24} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate type-body-strong text-foreground">{senderName ?? companyName}</p>
          <p className="flex items-center gap-1 type-caption text-muted-foreground">
            <Icon name="circle-check" size={12} className="text-status-approved-foreground" />
            Business account
          </p>
        </div>
        <IconButton icon="ellipsis" label="More" size="lg" />
      </div>
      <div className="flex flex-1 flex-col gap-3 bg-canvas px-3 py-4">
        <div className="flex justify-center">
          <span className="rounded-full bg-card px-3 py-1 type-caption text-muted-foreground">Today</span>
        </div>
        <div
          data-slot="handoff-notification-bubble"
          className="flex w-[310px] max-w-full flex-col overflow-hidden rounded-tl-sm rounded-tr-xl rounded-b-xl bg-card shadow-elevation-1"
        >
          <p className="px-3 pt-2 type-body break-words whitespace-pre-wrap text-foreground">{body}</p>
          <div className="flex justify-end px-3 pt-1 pb-2">
            <span className="type-caption text-muted-foreground">{time}</span>
          </div>
          <a
            data-slot="handoff-notification-button"
            href={href}
            className="flex min-h-11 items-center justify-center gap-2 border-t border-border type-body-strong text-primary outline-none focus-visible:shadow-focus-ring"
          >
            <Icon name="external-link" size={16} />
            {HANDOFF_REQUEST_TEMPLATE_BUTTON}
          </a>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border bg-card px-3 pt-2 pb-4">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-muted pr-1 pl-4">
          <span className="flex-1 type-body text-muted-foreground">Message</span>
          <IconButton icon="paperclip" label="Attach" size="lg" />
          <IconButton icon="camera" label="Camera" size="lg" />
        </div>
        <IconButton icon="send" label="Send" size="lg" variant="filled" />
      </div>
    </div>
  );
}

export { HandoffNotificationPreview };
export type { HandoffNotificationPreviewProps };
