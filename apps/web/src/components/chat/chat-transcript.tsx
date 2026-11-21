"use client";

import type { UIMessage } from "ai";
import {
  CheckpointBlock,
  type CheckpointCards,
} from "@/components/operator/checkpoint-block";
import { ToolCallTree } from "@/components/chat/tool-call-tree";
import { showWaitPulse } from "@/components/chat/chat-wait-pulse";
import { toolTreeRows } from "@/components/chat/tool-tree";
import { formatMarkdown } from "@/components/chat/format-markdown";

export type ChatTranscriptProps = {
  messages: UIMessage[];
  isStreaming: boolean;
  streamFailed: boolean;
  isStarter: boolean;
  checkpoints: CheckpointCards;
};

function getTextFromParts(parts: UIMessage["parts"]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
    </span>
  );
}

export function ChatTranscript({
  messages,
  isStreaming,
  streamFailed,
  checkpoints,
}: ChatTranscriptProps) {
  const waitPulse = showWaitPulse({
    messages,
    isStreaming,
    streamFailed,
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4">
      {messages.map((message) => {
        const textContent = getTextFromParts(message.parts);

        if (message.role === "user") {
          return (
            <div
              key={message.id}
              className="ml-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-6"
            >
              {textContent}
            </div>
          );
        }

        const rows = toolTreeRows(message.parts, { streamFailed });

        return (
          <div key={message.id} className="text-[15px] leading-6">
            {textContent ? (
              <div
                className="[&_pre]:whitespace-pre-wrap"
                dangerouslySetInnerHTML={{
                  __html: formatMarkdown(textContent),
                }}
              />
            ) : null}
            <ToolCallTree rows={rows} />
            {message.parts.map((part, partIndex) => (
              <div key={partIndex} className="mt-2">
                <CheckpointBlock part={part} cards={checkpoints} />
              </div>
            ))}
          </div>
        );
      })}
      {waitPulse ? <StreamingDots /> : null}
    </div>
  );
}
