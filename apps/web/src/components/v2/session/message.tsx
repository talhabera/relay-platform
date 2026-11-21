import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { Icon } from "../primitives/icon";

type MessageRole = "user" | "assistant";
type MessageView = "widget" | "transcript";
type MessageState = "default" | "streaming" | "error";

/** Figma default status / error copy per view and role. */
const statusCopy: Record<MessageView, Record<MessageRole, { streaming: string; error: string }>> = {
  widget: {
    user: { streaming: "Sending…", error: "Not delivered. Tap to retry." },
    assistant: { streaming: "Typing…", error: "Reply interrupted. Tap to retry." },
  },
  transcript: {
    user: { streaming: "Customer is typing…", error: "Not delivered to the agent." },
    assistant: { streaming: "Agent is replying…", error: "Delivery failed. Retrying in 30 s." },
  },
};

type MessageProps = Omit<React.ComponentProps<"div">, "role"> & {
  /** user = customer, assistant = customer agent. */
  role: MessageRole;
  /** widget: customer perspective (widget, test chat). transcript: read-only Inbox transcript. */
  view?: MessageView;
  state?: MessageState;
  /** transcript: name above the bubble (customer name or agent name). */
  author?: string;
  /** transcript: preformatted time, e.g. "11:40". */
  time?: string;
  /** transcript, user: initials for the avatar, e.g. "KV". */
  initials?: string;
  /** transcript, assistant: source channel glyph. */
  source?: BrandName;
  /** Overrides the streaming status line. */
  statusText?: string;
  /** Overrides the error line. */
  errorText?: string;
  /** Makes the error line a retry button. */
  onRetry?: () => void;
};

/**
 * Figma `Message` (02 `14:149`, restyled 2026-09-25): customer-conversation message.
 * view widget: customer right in a teal bubble, agent left. view transcript: customer left
 * with initials avatar, agent right with source glyph, name and time above each bubble.
 */
function Message({
  className,
  role,
  view = "widget",
  state = "default",
  author,
  time,
  initials,
  source = "website",
  statusText,
  errorText,
  onRetry,
  children,
  ...props
}: MessageProps) {
  const isUser = role === "user";
  const transcript = view === "transcript";
  const copy = statusCopy[view][role];

  const status =
    state === "streaming" ? (
      <div data-slot="message-status" className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", isUser ? "bg-muted-foreground" : "bg-primary")}
        />
        <span className="whitespace-nowrap type-caption text-muted-foreground">{statusText ?? copy.streaming}</span>
      </div>
    ) : null;

  const errorLabel = errorText ?? copy.error;
  const error =
    state === "error" ? (
      onRetry ? (
        <button
          type="button"
          data-slot="message-error"
          onClick={onRetry}
          className="flex items-center gap-1 rounded-sm text-destructive outline-none hover:underline focus-visible:shadow-focus-ring"
        >
          <Icon name="circle-alert" size={14} />
          <span className="whitespace-nowrap type-caption">{errorLabel}</span>
        </button>
      ) : (
        <div data-slot="message-error" className="flex items-center gap-1 text-destructive">
          <Icon name="circle-alert" size={14} />
          <span className="whitespace-nowrap type-caption">{errorLabel}</span>
        </div>
      )
    ) : null;

  const text = (
    <div className="max-w-[300px] min-w-0 type-body break-words whitespace-pre-wrap">{children}</div>
  );

  if (!transcript) {
    return (
      <div
        data-slot="message"
        data-role={role}
        data-view={view}
        data-state={state}
        aria-busy={state === "streaming" || undefined}
        className={cn("flex w-full min-w-0 flex-col gap-1", isUser ? "items-end" : "items-start", className)}
        {...props}
      >
        <div
          data-slot="message-bubble"
          className={cn(
            "flex max-w-full flex-col overflow-hidden rounded-t-xl px-3 py-2",
            isUser
              ? "rounded-br-sm rounded-bl-xl bg-primary text-primary-foreground"
              : "rounded-br-xl rounded-bl-sm border border-border bg-surface-raised text-foreground",
          )}
        >
          {text}
        </div>
        {status}
        {error}
      </div>
    );
  }

  return (
    <div
      data-slot="message"
      data-role={role}
      data-view={view}
      data-state={state}
      aria-busy={state === "streaming" || undefined}
      className={cn("flex w-full min-w-0 items-start gap-2", !isUser && "justify-end", className)}
      {...props}
    >
      {isUser ? (
        <Avatar size="sm">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      ) : null}
      <div className={cn("flex min-w-0 flex-col gap-1", isUser ? "items-start" : "items-end")}>
        {author || time ? (
          <div data-slot="message-meta" className="flex items-center gap-2 whitespace-nowrap type-caption">
            {author ? <span className="text-foreground">{author}</span> : null}
            {time ? <span className="text-muted-foreground">{time}</span> : null}
          </div>
        ) : null}
        <div
          data-slot="message-bubble"
          className={cn(
            "flex max-w-full flex-col overflow-hidden rounded-b-xl border border-border px-3 py-2 text-foreground",
            isUser ? "rounded-tl-sm rounded-tr-xl bg-card" : "rounded-tl-xl rounded-tr-sm bg-primary-soft",
          )}
        >
          {text}
        </div>
        {status}
        {error}
      </div>
      {!isUser ? <BrandGlyph brand={source} size={24} /> : null}
    </div>
  );
}

export { Message };
export type { MessageProps, MessageRole, MessageState, MessageView };
