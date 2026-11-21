import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TranscriptMessage } from "@/components/v2/data/transcript-message";
import { BrandGlyph } from "@/components/v2/primitives/brand-glyph";
import { Icon } from "@/components/v2/primitives/icon";
import { StatusChip } from "@/components/v2/primitives/status-chip";
import { initials } from "@/components/v2/shell/initials";

import type { ConversationView } from "./conversation-model";

/**
 * Body of the Figma 11b conversation-open sheet: header, waiting banner (with
 * the `action` slot: Answer now for a client user, Open in Inbox in preview),
 * read-only live transcript and footer. `close` is the header close button.
 */
export function ConversationBody({
  view,
  action,
  actionNote,
  close,
  error,
}: {
  view: ConversationView;
  action: React.ReactNode;
  /** Beside the action, e.g. "Customer waiting 6 min" or "Preview · staff answer from the Inbox". */
  actionNote: { text: string; tone: "warning" | "muted" };
  close?: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div data-slot="live-conversation" className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar size="md">
          <AvatarFallback>{initials(view.customer)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate type-h3 text-foreground">{view.customer}</h2>
          <div className="flex items-center gap-2">
            <BrandGlyph brand={view.brand} size={16} />
            <span className="truncate type-caption text-muted-foreground">{view.meta}</span>
          </div>
        </div>
        <StatusChip tone={view.chip.tone}>{view.chip.label}</StatusChip>
        {close}
      </div>

      {view.banner ? (
        <div
          data-slot="live-conversation-banner"
          className="flex items-start gap-3 rounded-xl border border-status-needs-you bg-surface-raised p-4"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-status-needs-you text-status-needs-you-foreground">
            <Icon name="hand-helping" size={18} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="type-body-strong text-foreground">{view.banner.title}</p>
            {view.banner.question ? (
              <p className="type-small text-foreground">&ldquo;{view.banner.question}&rdquo;</p>
            ) : null}
            <p className="type-small text-muted-foreground">{view.banner.narrative}</p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {action}
              <span
                className={
                  actionNote.tone === "warning"
                    ? "type-caption text-status-needs-you-foreground"
                    : "type-caption text-muted-foreground"
                }
              >
                {actionNote.text}
              </span>
            </div>
            {error ? (
              <p role="alert" className="type-caption text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-2 type-label text-muted-foreground">
        <Icon name="eye" size={14} />
        Live transcript · read-only
      </div>

      <div data-slot="live-conversation-transcript" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {view.started ? (
          <p className="text-center type-caption text-muted-foreground">{view.started}</p>
        ) : null}
        {view.transcript.length === 0 ? (
          <p className="text-center type-small text-muted-foreground">No messages yet.</p>
        ) : null}
        {view.transcript.map((item) =>
          item.kind === "event" ? (
            <p
              key={item.id}
              className="flex items-center justify-center gap-2 type-caption text-muted-foreground"
            >
              <Icon name={item.icon} size={14} />
              {item.text}
            </p>
          ) : (
            <TranscriptMessage
              key={item.id}
              role={item.role}
              author={item.author}
              time={item.time}
              source={view.brand}
              text={item.text}
            />
          ),
        )}
      </div>

      <p className="flex items-center gap-2 type-caption text-muted-foreground">
        <Icon name="lock" size={14} />
        Read-only. The agent keeps the chat going until you answer.
      </p>
    </div>
  );
}
