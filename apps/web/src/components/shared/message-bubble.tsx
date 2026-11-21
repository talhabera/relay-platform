"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";
import { Bot, User, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import type { MessageRole } from "@/types";
import type { MessageMetadata } from "@/db/schema";

type MessageBubbleProps = {
  content: string;
  role: MessageRole;
  timestamp?: Date | string;
  metadata?: MessageMetadata | null;
  isStreaming?: boolean;
};

export function MessageBubble({
  content,
  role,
  timestamp,
  metadata,
  isStreaming = false,
}: MessageBubbleProps) {
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const isTool = role === "tool";

  return (
    <div
      className={cn("flex gap-3 max-w-[85%]", {
        "ml-auto flex-row-reverse": isUser,
        "mr-auto": isAssistant || isTool,
      })}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          {
            "bg-primary text-primary-foreground": isUser,
            "bg-muted text-muted-foreground": isAssistant || isTool,
          }
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Message content */}
      <div className="flex flex-col gap-1">
        <div
          className={cn("rounded-2xl px-4 py-2.5 text-sm", {
            "bg-primary text-primary-foreground": isUser,
            "bg-muted": isAssistant || isTool,
          })}
        >
          {content ? (
            <p className="whitespace-pre-wrap break-words">{content}</p>
          ) : isStreaming ? (
            <StreamingIndicator />
          ) : null}
        </div>

        {/* Tool calls */}
        {metadata?.toolCalls && metadata.toolCalls.length > 0 && (
          <div className="space-y-1">
            {metadata.toolCalls.map((toolCall, index) => (
              <ToolCallDisplay
                key={index}
                tool={toolCall.tool}
                data={toolCall.data}
              />
            ))}
          </div>
        )}

        {/* Timestamp */}
        {timestamp && (
          <span
            className={cn("text-xs text-muted-foreground", {
              "text-right": isUser,
            })}
          >
            {formatRelativeTime(timestamp)}
          </span>
        )}
      </div>
    </div>
  );
}

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1">
      <div className="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:0ms]" />
      <div className="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:150ms]" />
      <div className="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

function ToolCallDisplay({ tool, data }: { tool: string; data: unknown }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-muted/50 text-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground transition-colors"
      >
        <Wrench className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium truncate">{tool}</span>
        {isOpen ? (
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
        )}
      </button>
      {isOpen && data != null && (
        <div className="border-t px-3 py-2">
          <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">
            {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
