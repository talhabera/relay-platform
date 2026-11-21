"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { UIMessage } from "ai";
import { isChatBusy } from "@/components/chat/chat-status";
import { composerCopy } from "@/components/chat/composer-copy";
import { suggestionChips } from "@/components/chat/suggestion-chips";
import { useOperatorChat } from "@/hooks/use-operator-chat";
import { useCheckpointCards } from "@/components/operator/checkpoint-block";
import type { CheckpointAction } from "@/lib/operator/approvals";
import { SessionHeader } from "@/components/v2/session/session-header";
import { SteeringComposer } from "@/components/v2/session/steering-composer";
import { cn } from "@/lib/utils";
import { SessionSteerProvider, type SessionSteer } from "./session-steer";
import {
  SessionQuestions,
  postQuestionAnswer,
  type SessionQuestionView,
} from "./session-questions";
import { OperatorChatConversation } from "./operator-chat-conversation";
import {
  operatorInitials,
  quotedCheckpoint,
  steeringChips,
  steeringSubmit,
  type SessionHeaderModel,
} from "./operator-chat-model";

type OperatorChatProps = {
  chatId: string;
  initialMessages: UIMessage[];
  isStarter: boolean;
  agentName: string;
  packageSlug: string | null;
  autoContinueOnUserOnlyHistory?: boolean;
  /** Session header (05 session/*), built by `sessionHeaderModel`. */
  header: SessionHeaderModel;
  /** Agent version pill on agent messages, e.g. "v1 Live". */
  versionLabel?: string;
  /** Session starter's display name: author of the operator messages. */
  starterName: string;
  /** Right-hand work pane for the session type; none spans the conversation. */
  workPane?: React.ReactNode;
  /** Agent questions on this session, oldest first (open ones block it). */
  questions?: SessionQuestionView[];
  /** The worker is mid-turn on this session (page opened during a run). */
  runActive?: boolean;
};

function getTextFromParts(parts: UIMessage["parts"]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function OperatorChat({
  chatId,
  initialMessages,
  isStarter,
  agentName,
  packageSlug,
  autoContinueOnUserOnlyHistory = false,
  header,
  versionLabel,
  starterName,
  workPane,
  questions = [],
  runActive = false,
}: OperatorChatProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const continuedRef = useRef(false);
  const [input, setInput] = useState("");
  // Checkpoint quoted in the composer after Ask for changes (05 session-mail/ask-for-changes).
  const [quoteId, setQuoteId] = useState<string | null>(null);

  const { messages, setMessages, sendMessage, regenerate, status, error } = useOperatorChat({
    chatId,
    initialMessages,
  });

  // A turn this tab streams, or one the worker runs without us (after a refresh).
  const isStreaming = isChatBusy(status) || runActive;
  const streamFailed = Boolean(error);

  const copy = composerCopy({ agentName, packageSlug });
  // Empty session: starter suggestions. Running session: contextual steering chips.
  const chips =
    messages.length === 0
      ? isStarter
        ? suggestionChips({ packageSlug }).map((label) => ({ label }))
        : []
      : steeringChips({ packageSlug });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (error) {
      toast.error("Failed to get response");
    }
  }, [error]);

  // Questions and the header come from the server: reload them when a turn
  // ends, so an ask_operator question shows without a page refresh.
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) router.refresh();
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, router]);

  // Opened mid-turn: nothing streams to this tab, so poll the server until the
  // worker finishes, then take the saved transcript.
  useEffect(() => {
    if (!runActive) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [runActive, router]);
  const wasRunActiveRef = useRef(runActive);
  useEffect(() => {
    if (wasRunActiveRef.current && !runActive) setMessages(initialMessages);
    wasRunActiveRef.current = runActive;
  }, [runActive, initialMessages, setMessages]);

  useEffect(() => {
    if (
      !autoContinueOnUserOnlyHistory ||
      runActive ||
      continuedRef.current ||
      !isStarter ||
      initialMessages.length === 0
    ) {
      return;
    }

    const hasAssistantReply = initialMessages.some(
      (message) => message.role === "assistant",
    );
    if (hasAssistantReply) return;

    const lastMessage = initialMessages[initialMessages.length - 1];
    if (lastMessage.role !== "user") return;

    const text = getTextFromParts(lastMessage.parts);
    if (!text) return;

    continuedRef.current = true;
    void sendMessage({ text });
  }, [
    autoContinueOnUserOnlyHistory,
    runActive,
    initialMessages,
    isStarter,
    sendMessage,
  ]);

  // The agent picks the session up again after an action that hands it work
  // (approve result, direction, refresh). Discard leaves the session idle.
  const onResolved = useCallback(
    (action: CheckpointAction) => {
      router.refresh();
      if (action !== "discard") {
        void sendMessage({ text: "Continue." });
      }
    },
    [router, sendMessage],
  );
  const loaded = useCheckpointCards(
    { chatId },
    { reloadKey: isStreaming ? -1 : messages.length, onResolved },
  );
  // Only the starter steers; other approvers keep the reply box under the card.
  const checkpoints = isStarter
    ? {
        ...loaded,
        askForChanges: (view: { id: string }) => {
          setQuoteId(view.id);
        },
      }
    : loaded;
  const quote = quotedCheckpoint(quoteId, loaded.byId);

  const openQuestion = questions.find((q) => q.status === "open");

  // Answering resumes the session with the answer as the person's message.
  const onQuestionAnswered = useCallback(
    (answer: string) => {
      router.refresh();
      void sendMessage({ text: answer });
    },
    [router, sendMessage],
  );

  function send(value: string) {
    const intent = steeringSubmit({
      text: value,
      quoteId: quote?.id,
      isStarter,
      isStreaming,
    });
    switch (intent.kind) {
      case "busy":
        toast.info("The agent is still working. Send when it finishes.");
        return;
      case "ignore":
        return;
      case "ask_for_changes":
        setInput("");
        setQuoteId(null);
        loaded.onAction(intent.id, "ask_for_changes", intent.feedback);
        return;
      case "message":
        setInput("");
        // "Or type your own answer in the composer": a typed message answers
        // the open agent question first.
        if (openQuestion) {
          const text = intent.text;
          void postQuestionAnswer(openQuestion.id, text).then((outcome) => {
            if (outcome === "session") onQuestionAnswered(text);
          });
          return;
        }
        void sendMessage({ text: intent.text });
        return;
    }
  }

  function handleChip(label: string) {
    send(label);
  }

  // The header comes from the server; while the agent streams it is running.
  const headerStatus = isStreaming ? "running" : header.status;

  const composer = (
    <SteeringComposer
      className="p-4 pt-2"
      value={input}
      onChange={setInput}
      onSubmit={send}
      placeholder={messages.length === 0 ? copy.placeholder : undefined}
      // 05 session-mail/ask-for-changes: chips off while a checkpoint is quoted.
      chips={quote ? [] : chips}
      onChip={handleChip}
      quote={quote ? { text: quote.text } : undefined}
      onRemoveQuote={() => setQuoteId(null)}
      disabled={!isStarter}
    />
  );

  const steer: SessionSteer = { send: isStarter ? send : null, isStreaming };

  return (
    <SessionSteerProvider value={steer}>
      <div data-slot="operator-session" className="flex h-[calc(100dvh-7rem)] min-h-[560px] flex-col gap-4">
        <SessionHeader {...header} status={headerStatus} className="flex-wrap md:flex-nowrap" />
        <div className={cn("grid min-h-0 flex-1 gap-4", workPane ? "lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]" : "grid-cols-1")}>
          <section
            aria-label="Conversation"
            className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevation-1"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-4">
                <h2 className="text-center type-h2 text-foreground">{copy.heading}</h2>
              </div>
            ) : (
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className={cn("flex min-h-full flex-col justify-end", !workPane && "mx-auto max-w-3xl")}>
                  <OperatorChatConversation
                    messages={messages}
                    isStreaming={isStreaming}
                    streamFailed={streamFailed}
                    checkpoints={checkpoints}
                    agentName={agentName}
                    versionLabel={versionLabel}
                    starterName={starterName}
                    starterInitials={operatorInitials(starterName)}
                    onRetry={() => {
                      if (!isStarter || isStreaming) return;
                      void regenerate();
                    }}
                  />
                  <SessionQuestions
                    questions={questions}
                    agentName={agentName}
                    canAnswer
                    onAnswered={onQuestionAnswered}
                  />
                </div>
              </div>
            )}
            <div className={cn("w-full", !workPane && "mx-auto max-w-3xl")}>{composer}</div>
          </section>
          {workPane ? <div className="flex min-h-0">{workPane}</div> : null}
        </div>
      </div>
    </SessionSteerProvider>
  );
}
