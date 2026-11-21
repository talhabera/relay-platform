"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CustomerChatCheckpoints } from "@/components/operator/checkpoint-block";
import { TranscriptMessage } from "@/components/v2/data/transcript-message";
import { BrandGlyph } from "@/components/v2/primitives/brand-glyph";
import { Chip } from "@/components/v2/primitives/chip";
import { Icon } from "@/components/v2/primitives/icon";
import { StatusChip } from "@/components/v2/primitives/status-chip";
import { ToolChip } from "@/components/v2/session/tool-chip";
import { initials } from "@/components/v2/shell/initials";
import { cn } from "@/lib/utils";
import {
  handBackFromInbox,
  sendInboxMessage,
  takeOverFromInbox,
  type InboxActionResult,
} from "@/app/(dashboard)/messaging/actions";
import type { InboxDetail, InboxTranscriptItem } from "@/app/(dashboard)/messaging/inbox-data";

import { firstName, SOURCE_BRAND } from "./inbox-model";

const ERROR_COPY: Record<Exclude<InboxActionResult, { ok: true }>["error"], string> = {
  forbidden: "You do not have Inbox access for this company.",
  invalid: "Write a message first.",
  not_found: "This conversation no longer exists.",
  read_only: "This conversation is read-only right now.",
  conflict: "Someone else changed this conversation. It has been refreshed.",
  rate_limited: "Too many takeovers in a minute. Try again shortly.",
};

type InboxConversationProps = {
  className?: string;
  companyId: string;
  companyName: string;
  conversation: InboxDetail;
  /** Mobile: back to the list. */
  onBack?: () => void;
};

/** Figma 08a conversation pane: header, read-only banner or customer question, transcript, composer. */
export function InboxConversation({ className, companyId, companyName, conversation, onBack }: InboxConversationProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastItemId = conversation.transcript.at(-1)?.id;
  const { handoff } = conversation;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation.id, lastItemId]);

  function run(action: () => Promise<InboxActionResult>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(ERROR_COPY[result.error]);
        if (result.error === "conflict" || result.error === "read_only") router.refresh();
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  const chatRef = { companyId, chatId: conversation.id };

  return (
    <section
      aria-label="Conversation"
      data-slot="inbox-conversation"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevation-1",
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-5">
        {onBack ? (
          <Button variant="ghost" size="icon" onClick={onBack} className="-ml-2 lg:hidden" aria-label="Back to conversations">
            <Icon name="arrow-left" size={18} />
          </Button>
        ) : null}
        <BrandGlyph brand={SOURCE_BRAND[conversation.source]} size={24} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate type-h3 text-foreground">{conversation.customer}</h2>
          <p className="truncate type-small text-muted-foreground">{conversation.customerMeta}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {handoff ? (
            <Chip asStatic icon={handoff.status === "handed_back" ? "bot" : "hand-helping"}>
              {handoff.headerLabel}
            </Chip>
          ) : null}
          <StatusChip tone={conversation.chip.tone}>{conversation.chip.label}</StatusChip>
        </div>
      </header>

      <CustomerChatCheckpoints key={conversation.id} chatId={conversation.id} />

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {handoff ? (
          <div className="border-b border-border p-6">
            <QuestionCard
              handoff={handoff}
              customer={conversation.customer}
              source={conversation.source}
              pending={pending}
              onTakeOver={() => run(() => takeOverFromInbox(chatRef))}
            />
          </div>
        ) : (
          <div className="px-6 pt-4">
            <div
              data-slot="inbox-read-only-banner"
              className="flex items-start gap-3 rounded-xl border border-primary bg-primary-soft px-4 py-3"
            >
              <Icon name="info" size={20} className="mt-0.5 text-primary" />
              <div className="flex flex-col gap-1">
                <p className="type-body-strong text-foreground">Read-only · replies are handled by the customer agent</p>
                <p className="type-small text-muted-foreground">
                  You are viewing this conversation as read-only. Questions the agent cannot answer go to a person
                  through the human handoff.
                </p>
              </div>
            </div>
          </div>
        )}

        <ol className="flex flex-col gap-4 p-6" aria-label="Transcript">
          {conversation.transcript.length === 0 ? (
            <li className="py-8 text-center type-small text-muted-foreground">No messages yet.</li>
          ) : (
            conversation.transcript.map((item) => (
              <TranscriptItem key={item.id} item={item} conversation={conversation} />
            ))
          )}
        </ol>
      </div>

      {conversation.composer ? (
        <Composer
          key={conversation.id}
          mode={conversation.composer}
          placeholder={
            conversation.composer === "reply"
              ? `Answer ${firstName(conversation.customer)} as ${companyName}…`
              : `Message ${firstName(conversation.customer)}…`
          }
          pending={pending}
          onSend={(text, clear) => run(() => sendInboxMessage({ ...chatRef, text }), clear)}
          onHandBack={() => run(() => handBackFromInbox(chatRef))}
        />
      ) : null}
    </section>
  );
}

function TranscriptItem({ item, conversation }: { item: InboxTranscriptItem; conversation: InboxDetail }) {
  if (item.kind === "event") {
    return (
      <li data-slot="inbox-handoff-event" className="flex items-center justify-center gap-2 text-center type-caption text-muted-foreground">
        <Icon
          name={item.icon}
          size={16}
          className={item.tone === "warning" ? "text-warning" : item.tone === "primary" ? "text-primary" : "text-muted-foreground"}
        />
        <span>{item.text}</span>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2">
      {item.tools.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2">
          {item.tools.map((tool, index) => (
            <ToolChip key={`${item.id}-${index}`} label={tool} state="done" />
          ))}
        </div>
      ) : null}
      {item.from === "person" ? (
        <PersonMessage author={item.author} time={item.time} text={item.text} />
      ) : (
        <TranscriptMessage
          role={item.from === "customer" ? "user" : "assistant"}
          author={item.author}
          avatarName={conversation.customer}
          time={item.time}
          source={SOURCE_BRAND[conversation.source]}
          text={item.text}
        />
      )}
    </li>
  );
}

/** A person's message (handoff answer, takeover or Inbox reply): right side, initials avatar. */
function PersonMessage({ author, time, text }: { author: string; time: string; text: string }) {
  return (
    <div data-slot="inbox-person-message" className="flex w-full items-start justify-end gap-2">
      <div className="flex min-w-0 flex-col items-end gap-1">
        <div className="flex items-center gap-2 type-caption">
          <span className="text-foreground">{author}</span>
          <span className="text-muted-foreground">{time}</span>
        </div>
        <div className="rounded-xl rounded-tr-sm border border-border bg-primary-soft px-3 py-2">
          <p className="max-w-75 type-body break-words whitespace-pre-wrap text-foreground">{text}</p>
        </div>
      </div>
      <Avatar size="sm">
        <AvatarFallback>{initials(author.split(" · ")[0] ?? author)}</AvatarFallback>
      </Avatar>
    </div>
  );
}

function QuestionCard({
  handoff,
  customer,
  source,
  pending,
  onTakeOver,
}: {
  handoff: NonNullable<InboxDetail["handoff"]>;
  customer: string;
  source: InboxDetail["source"];
  pending: boolean;
  onTakeOver: () => void;
}) {
  return (
    <div
      data-slot="inbox-question-card"
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-4",
        handoff.canTakeOverAgain ? "border-primary" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="type-label tracking-wide text-muted-foreground uppercase">Customer question</span>
        <StatusChip tone={handoff.chip.tone}>{handoff.chip.label}</StatusChip>
      </div>
      {handoff.question ? (
        <p
          className={cn(
            "type-h3",
            handoff.status === "expired" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {handoff.question}
        </p>
      ) : null}
      {handoff.alsoAsked.length > 0 ? (
        <ul className="flex flex-col gap-1 type-small text-muted-foreground">
          {handoff.alsoAsked.map((text, index) => (
            <li key={index}>Also asked: {text}</li>
          ))}
        </ul>
      ) : null}
      {handoff.reason ? <p className="type-small text-muted-foreground">Why you: {handoff.reason}</p> : null}
      <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2">
        <Avatar size="sm">
          <AvatarFallback>{initials(customer)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate type-small text-foreground">{customer}</span>
        <BrandGlyph brand={SOURCE_BRAND[source]} size={16} />
      </div>
      <p className="flex items-center gap-2 type-small text-foreground">
        <Icon
          name={handoff.footer.icon}
          size={16}
          className={handoff.status === "expired" ? "text-muted-foreground" : "text-primary"}
        />
        {handoff.footer.text}
      </p>
      {handoff.canTakeOverAgain ? (
        <Button className="w-fit" onClick={onTakeOver} disabled={pending}>
          <Icon name="hand-helping" size={16} />
          Take over again
        </Button>
      ) : null}
    </div>
  );
}

function Composer({
  mode,
  placeholder,
  pending,
  onSend,
  onHandBack,
}: {
  mode: "reply" | "takeover";
  placeholder: string;
  pending: boolean;
  onSend: (text: string, clear: () => void) => void;
  onHandBack: () => void;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  function submit() {
    if (!trimmed || pending) return;
    onSend(trimmed, () => setText(""));
  }

  return (
    <form
      data-slot="inbox-composer"
      className="shrink-0 border-t border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
        <Textarea
          aria-label={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          rows={2}
          maxLength={4000}
          className="min-h-11 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-end gap-2">
          {mode === "takeover" ? (
            <Button type="button" variant="outline" size="sm" onClick={onHandBack} disabled={pending}>
              <Icon name="bot" size={16} />
              Hand back to agent
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={!trimmed || pending}>
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}
