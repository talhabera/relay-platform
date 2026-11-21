import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon } from "../primitives/icon";
import { ToolChip, type ToolChipProps } from "./tool-chip";

type ConversationMessageProps = Omit<React.ComponentProps<"div">, "role"> & {
  /** agent: left, bot avatar, version, Tool chips. operator: right, initials avatar. */
  role: "agent" | "operator";
  /** Agent name or operator display name. */
  author: string;
  /** Agent version pill, e.g. "v1 Live". Agent only. */
  version?: string;
  /** Operator initials for the avatar, e.g. "TB". */
  initials?: string;
  /** Preformatted time, e.g. "11:39". Hidden while streaming. */
  time?: string;
  state?: "default" | "streaming" | "error";
  /** Tool calls under the bubble. Agent only. */
  tools?: ToolChipProps[];
  /** Error reason; defaults to "Not delivered to the agent" for operator messages. */
  errorReason?: string;
  onRetry?: () => void;
};

/**
 * Figma `Conversation message` (02 `375:24041`): session conversation pane message.
 * state default | streaming (typing…, caret) | error (destructive border, reason, Retry).
 */
function ConversationMessage({
  className,
  role,
  author,
  version,
  initials,
  time,
  state = "default",
  tools = [],
  errorReason,
  onRetry,
  children,
  ...props
}: ConversationMessageProps) {
  const isAgent = role === "agent";
  const streaming = isAgent && state === "streaming";
  const error = state === "error";
  const reason = errorReason ?? (isAgent ? undefined : "Not delivered to the agent");
  const toolChips =
    isAgent && tools.length > 0 ? (
      <div data-slot="message-tools" className="flex flex-wrap items-start gap-2">
        {tools.map((t, i) => (
          <ToolChip key={`${t.label}-${i}`} {...t} />
        ))}
      </div>
    ) : null;

  return (
    <div
      data-slot="conversation-message"
      data-role={role}
      data-state={state}
      aria-busy={streaming ? true : undefined}
      className={cn("flex w-full min-w-0 items-start gap-3", !isAgent && "justify-end", className)}
      {...props}
    >
      {isAgent ? (
        <span className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-primary">
          <Icon name="bot" size={18} />
        </span>
      ) : null}
      <div className={cn("flex min-w-0 flex-col gap-2", isAgent ? "flex-1 items-start" : "items-end")}>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="type-body-strong text-foreground">{author}</span>
          {isAgent && version ? (
            <span className="rounded-sm bg-primary-soft px-2 type-caption text-primary-soft-foreground">{version}</span>
          ) : null}
          {streaming ? (
            <span className="type-caption text-primary">typing…</span>
          ) : time ? (
            <span className="type-caption text-muted-foreground">{time}</span>
          ) : null}
        </div>
        <div
          data-slot="message-bubble"
          className={cn(
            "flex max-w-full items-end overflow-hidden rounded-xl px-4 py-3",
            isAgent ? "bg-surface-raised" : "bg-secondary",
            error ? "border border-destructive" : isAgent ? "border border-border" : "",
          )}
        >
          <div className={cn("min-w-0 type-body break-words whitespace-pre-wrap text-foreground", isAgent ? "max-w-[360px]" : "max-w-[340px]")}>
            {children}
          </div>
          {streaming ? (
            <span data-slot="message-caret" aria-hidden className="ml-1 h-[18px] w-0.5 shrink-0 animate-pulse bg-primary" />
          ) : null}
        </div>
        {error ? (
          <div data-slot="message-error" className="flex items-center gap-2">
            <Icon name="circle-alert" size={16} className="text-destructive" />
            {reason ? <span className="type-caption text-destructive">{reason}</span> : null}
            <Button variant="ghost" size="md" onClick={onRetry}>
              <Icon name="refresh-cw" size={16} />
              Retry
            </Button>
          </div>
        ) : null}
        {toolChips}
      </div>
      {!isAgent ? (
        <Avatar size="md">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      ) : null}
    </div>
  );
}

export { ConversationMessage };
export type { ConversationMessageProps };
