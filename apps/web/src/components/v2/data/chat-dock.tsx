import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { AgentChip } from "../primitives/agent-chip";
import { Icon } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";

type ChatDockProps = Omit<React.ComponentProps<"div">, "onSubmit"> & {
  state?: "collapsed" | "expanded";
  /** Customer agent under test, e.g. "Acme Website Assistant". */
  agentName: string;
  /** Agent chip version, e.g. "v1". */
  version?: string;
  versionStatus?: "live" | "draft" | "none";
  /** Collapsed subtitle count ("Test mode · 2 messages"). */
  messageCount?: number;
  /** Expanded transcript, usually `TranscriptMessage` elements. */
  children?: React.ReactNode;
  onExpand?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
  /** Composer value; omit for an uncontrolled input. */
  draft?: string;
  onDraftChange?: (value: string) => void;
  onSend?: (value: string) => void;
  /** Disable the composer (e.g. while streaming). */
  sending?: boolean;
};

/**
 * Figma `Chat dock` (02 `402:28450`): docked test chat for a customer agent, bottom-right.
 * collapsed: pill with agent name, message count and expand | expanded: 400x560 panel with
 * Agent chip header, test-mode notice, transcript and an Input + send composer. Replies are
 * never sent to customers.
 */
function ChatDock({
  className,
  state = "collapsed",
  agentName,
  version,
  versionStatus = "live",
  messageCount = 0,
  children,
  onExpand,
  onMinimize,
  onClose,
  draft,
  onDraftChange,
  onSend,
  sending = false,
  ...props
}: ChatDockProps) {
  if (state === "collapsed") {
    return (
      <div
        data-slot="chat-dock"
        data-state="collapsed"
        className={cn(
          "flex w-fit items-center gap-3 rounded-full border border-border bg-popover p-2 shadow-elevation-2",
          className,
        )}
        {...props}
      >
        <span className="flex shrink-0 rounded-full bg-primary-soft p-2 text-primary">
          <Icon name="message-square" size={16} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate type-body-strong text-foreground">Test {agentName}</span>
          <span className="type-caption text-muted-foreground">
            Test mode · {messageCount} {messageCount === 1 ? "message" : "messages"}
          </span>
        </span>
        <IconButton icon="maximize-2" label="Expand test chat" size="sm" onClick={onExpand} />
      </div>
    );
  }

  return (
    <div
      data-slot="chat-dock"
      data-state="expanded"
      role="dialog"
      aria-label={`Test ${agentName}`}
      className={cn(
        "flex h-140 w-100 max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-elevation-3",
        className,
      )}
      {...props}
    >
      <header className="flex w-full shrink-0 items-center gap-2 border-b border-border py-3 pr-3 pl-4">
        <AgentChip kind="customer" name={agentName} version={version} status={versionStatus} />
        <span className="min-w-0 flex-1" />
        <IconButton icon="minimize-2" label="Minimize test chat" size="sm" onClick={onMinimize} />
        <IconButton icon="x" label="Close test chat" size="sm" onClick={onClose} />
      </header>
      <div data-slot="chat-dock-notice" className="flex w-full shrink-0 items-center gap-2 bg-muted px-4 py-2">
        <Icon name="sparkles" size={16} className="text-muted-foreground" />
        <span className="type-caption text-muted-foreground">Test mode · replies are never sent to customers</span>
      </div>
      <div data-slot="chat-dock-transcript" className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto p-4">
        {children}
      </div>
      <form
        data-slot="chat-dock-composer"
        className="flex w-full shrink-0 items-center gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const field = e.currentTarget.elements.namedItem("message") as HTMLInputElement | null;
          const text = (draft ?? field?.value ?? "").trim();
          if (!text || sending) return;
          onSend?.(text);
          if (draft === undefined && field) field.value = "";
        }}
      >
        <Input
          name="message"
          aria-label="Test message"
          placeholder="Write a test message…"
          autoComplete="off"
          value={draft}
          onChange={onDraftChange ? (e) => onDraftChange(e.target.value) : undefined}
          disabled={sending}
          className="flex-1"
        />
        <IconButton icon="send" label="Send test message" variant="filled" size="md" type="submit" disabled={sending} />
      </form>
    </div>
  );
}

export { ChatDock };
export type { ChatDockProps };
