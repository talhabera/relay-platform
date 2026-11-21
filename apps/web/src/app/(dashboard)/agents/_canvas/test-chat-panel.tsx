"use client";

import * as React from "react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

import { ChatDock } from "@/components/v2/data";
import { Message, ToolChip } from "@/components/v2/session";
import { useChatWithAgent } from "@/hooks/use-chat-with-agent";

import { toolLabel } from "./inspector-model";

type TestChatPanelProps = {
  agentId: string;
  agentName: string;
  companyId: string;
  /** Back to the inspector tabs (minimize and close). */
  onClose: () => void;
};

/**
 * Inspector Test chat (Figma 07 `agents-customer/test-chat`, 411:31965): the Chat dock in the
 * inspector's place. Replies stream from the customer agent and are never sent to customers.
 */
export function TestChatPanel({ agentId, agentName, companyId, onClose }: TestChatPanelProps) {
  const [draft, setDraft] = React.useState("");
  const { messages, sendMessage, status, error } = useChatWithAgent({ agentId, companyId });
  const busy = status === "submitted" || status === "streaming";
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <ChatDock
      state="expanded"
      agentName={agentName}
      versionStatus="none"
      draft={draft}
      onDraftChange={setDraft}
      sending={busy}
      onSend={(text) => {
        setDraft("");
        void sendMessage({ text });
      }}
      onMinimize={onClose}
      onClose={onClose}
      className="h-[640px] w-full lg:h-auto lg:min-h-[560px] lg:w-[400px] lg:self-stretch"
    >
      {messages.length === 0 ? (
        <p className="m-auto max-w-[260px] text-center type-small text-muted-foreground">
          Write a message as a customer would. {agentName} answers with its live instructions, knowledge and
          integrations.
        </p>
      ) : (
        messages.map((m, i) => (
          <TestChatMessage
            key={m.id}
            message={m}
            streaming={busy && i === messages.length - 1 && m.role === "assistant"}
          />
        ))
      )}
      {status === "submitted" ? (
        <Message role="assistant" state="streaming">
          …
        </Message>
      ) : null}
      {error ? (
        <Message role="assistant" state="error" errorText="No reply. Check the agent and try again.">
          {" "}
        </Message>
      ) : null}
      <div ref={endRef} />
    </ChatDock>
  );
}

function TestChatMessage({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  const tools = message.parts.filter(isToolUIPart);

  return (
    <div className="flex flex-col gap-2">
      {tools.map((part, i) => (
        <ToolChip
          key={`${getToolName(part)}-${i}`}
          label={toolLabel(getToolName(part))}
          state={
            part.state === "output-error" ? "failed" : part.state === "output-available" ? "done" : "running"
          }
        />
      ))}
      {text ? (
        <Message role={message.role} state={streaming ? "streaming" : "default"}>
          {text}
        </Message>
      ) : null}
    </div>
  );
}
