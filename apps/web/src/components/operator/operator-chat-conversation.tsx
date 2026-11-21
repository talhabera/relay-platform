"use client";

import type { UIMessage } from "ai";

import { FileOutputCard } from "@/components/chat/file-output-card";
import { fileCardFromRow } from "@/components/chat/file-output";
import { formatMarkdown } from "@/components/chat/format-markdown";
import { CheckpointBlock, type CheckpointCards } from "@/components/operator/checkpoint-block";
import { ConversationMessage } from "@/components/v2/session/conversation-message";
import { ToolChip } from "@/components/v2/session/tool-chip";

import { conversationItems } from "./operator-chat-model";

type OperatorChatConversationProps = {
  messages: UIMessage[];
  isStreaming: boolean;
  streamFailed: boolean;
  checkpoints: CheckpointCards;
  agentName: string;
  /** Agent version pill, e.g. "v1 Live". */
  versionLabel?: string;
  /** Session starter: author of every operator message. */
  starterName: string;
  starterInitials: string;
  onRetry: () => void;
};

/**
 * Session conversation pane (05 session/*): Conversation messages with Tool
 * chips, file outputs and the agent's Checkpoint cards in line.
 */
export function OperatorChatConversation({
  messages,
  isStreaming,
  streamFailed,
  checkpoints,
  agentName,
  versionLabel,
  starterName,
  starterInitials,
  onRetry,
}: OperatorChatConversationProps) {
  const items = conversationItems(messages, { isStreaming, streamFailed });
  const last = items[items.length - 1];
  // The agent has not answered yet: a typing placeholder until its first token.
  const waiting = isStreaming && !streamFailed && last?.role !== "agent";

  return (
    <div data-slot="session-conversation" className="flex w-full flex-col gap-5 p-4">
      {items.map((item) => {
        if (item.role === "operator") {
          return (
            <ConversationMessage
              key={item.id}
              role="operator"
              author={starterName}
              initials={starterInitials}
              state={item.state === "error" ? "error" : "default"}
              onRetry={onRetry}
            >
              {item.text}
            </ConversationMessage>
          );
        }

        const files = item.tools
          .map((tool) => ({ id: tool.id, file: fileCardFromRow(tool.row) }))
          .filter((f) => f.file !== null);

        return (
          <div key={item.id} className="flex w-full min-w-0 flex-col gap-2">
            {item.text || item.state !== "default" ? (
              <ConversationMessage
                role="agent"
                author={agentName}
                version={versionLabel}
                state={item.state}
                errorReason={item.state === "error" ? "The agent stopped before finishing" : undefined}
                onRetry={onRetry}
                tools={item.tools.map((tool) => ({
                  label: tool.label,
                  state: tool.state,
                  title: tool.summary ?? undefined,
                }))}
              >
                {item.text ? (
                  <div
                    className="whitespace-normal [&_pre]:whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: formatMarkdown(item.text) }}
                  />
                ) : null}
              </ConversationMessage>
            ) : item.tools.length > 0 ? (
              // A turn with tool calls only: the chips without an empty bubble.
              <div data-slot="message-tools" className="flex flex-wrap items-start gap-2 pl-11">
                {item.tools.map((tool) => (
                  <ToolChip key={tool.id} label={tool.label} state={tool.state} title={tool.summary ?? undefined} />
                ))}
              </div>
            ) : null}
            {files.length > 0 ? (
              <div className="flex flex-col gap-2 pl-11">
                {files.map(({ id, file }) =>
                  file ? (
                    <FileOutputCard key={id} downloadPath={file.downloadPath} filename={file.filename} kind={file.kind} />
                  ) : null,
                )}
              </div>
            ) : null}
            {item.parts.map((part, index) => (
              <CheckpointBlock key={index} part={part} cards={checkpoints} />
            ))}
          </div>
        );
      })}
      {waiting ? (
        <ConversationMessage role="agent" author={agentName} version={versionLabel} state="streaming" />
      ) : null}
    </div>
  );
}
