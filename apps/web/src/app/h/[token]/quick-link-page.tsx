"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { HandoffHeader, HandoffRequestCard } from "@/components/v2/client";
import { BrandGlyph } from "@/components/v2/primitives/brand-glyph";
import { Icon, type IconName } from "@/components/v2/primitives/icon";
import { StatusChip } from "@/components/v2/primitives/status-chip";
import { ChatComposer, Message } from "@/components/v2/session";
import { cn } from "@/lib/utils";

import {
  CARD_STATE,
  CUSTOMER,
  cardStatusText,
  channelOf,
  formatClock,
  headerLinkText,
  initialsOf,
  linkLifetimeText,
  liveBanner,
  mergeMessages,
  messageAuthor,
  personName,
  quickLinkScreen,
  sentBanner,
  waitingText,
  type QuickLinkMessage,
  type QuickLinkPayload,
} from "./screen";

type ReplyMode = "person" | "agent";
type Size = "mobile" | "desktop";

export type QuickLinkPageProps = {
  token: string;
  initialView: QuickLinkPayload;
  /** Company IANA timezone: every clock on the page uses it. */
  timeZone: string;
  /** HANDOFF_TAKEOVER_IDLE_MINUTES. */
  idleMinutes: number;
  /** Fixture pages render without the network. */
  offline?: boolean;
  /** Server render time, so the waiting chip matches on hydration. */
  now?: string;
  /** Pins the layout (tests); otherwise mobile below 1024 px, desktop above. */
  size?: Size;
};

const DESKTOP_QUERY = "(min-width: 1024px)";
const TYPING_THROTTLE_MS = 3_000;

function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Mobile first (server render), desktop two-pane from 1024 px. */
function useSize(): Size {
  const desktop = React.useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
  return desktop ? "desktop" : "mobile";
}

/**
 * The public quick-link page (S69, Figma 11c `500:69277`). The token in the
 * URL is the only credential. One answer (as the person or phrased by the
 * agent), or take over the chat until hand back; Done closes the link.
 */
export function QuickLinkPage({
  token,
  initialView,
  timeZone,
  idleMinutes,
  offline = false,
  now,
  size: pinnedSize,
}: QuickLinkPageProps) {
  const mediaSize = useSize();
  const size = pinnedSize ?? mediaSize;
  const [view, setView] = React.useState(initialView);
  const [draft, setDraft] = React.useState("");
  const [suggestion, setSuggestion] = React.useState<string | null>(null);
  const [replyMode, setReplyMode] = React.useState<ReplyMode>(initialView.defaultReply);
  const [expanded, setExpanded] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [customerTyping, setCustomerTyping] = React.useState(initialView.typing.customer);
  const lastTypingPost = React.useRef(0);

  const screen = quickLinkScreen(view);
  const replying = screen === "open" && draft.trim().length > 0;
  const transcript = view.transcript ?? [];
  const channel = channelOf(view.channel);
  const statusKey = `${view.request.status}:${view.link.isClosed}`;

  // Last message id, so a reconnect resumes after it instead of replaying.
  const lastId = React.useRef<string | undefined>(initialView.transcript?.at(-1)?.id);
  React.useEffect(() => {
    lastId.current = view.transcript?.at(-1)?.id;
  }, [view.transcript]);

  // Live transcript, request state and customer typing (GET /api/h/[token]/events).
  // Reconnects only when the page moves to another frame.
  const canView = view.link.canView;
  React.useEffect(() => {
    if (offline || !canView) return;
    const after = lastId.current;
    const source = new EventSource(
      `/api/h/${encodeURIComponent(token)}/events${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    );
    source.addEventListener("message", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as QuickLinkMessage;
      setView((v) => ({ ...v, transcript: mergeMessages(v.transcript ?? [], [message]) }));
    });
    source.addEventListener("handoff", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as Pick<QuickLinkPayload, "request" | "link">;
      setView((v) => ({ ...v, request: next.request, link: next.link }));
    });
    source.addEventListener("typing", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as { customer?: boolean };
      setCustomerTyping(Boolean(next.customer));
    });
    return () => source.close();
  }, [token, offline, statusKey, canView]);

  // A status change from elsewhere (expiry, idle hand back, another tab) arrives
  // as request state only: reload the full view (sent message, transcript).
  const [loadedKey, setLoadedKey] = React.useState(statusKey);
  React.useEffect(() => {
    if (offline || statusKey === loadedKey) return;
    let cancelled = false;
    void fetch(`/api/h/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<QuickLinkPayload>) : null))
      .then((next) => {
        if (cancelled) return;
        if (next) setView(next);
        setLoadedKey(statusKey);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [statusKey, loadedKey, offline, token]);

  // The waiting chip counts minutes.
  const [nowMs, setNowMs] = React.useState(() => (now ? Date.parse(now) : Date.now()));
  React.useEffect(() => {
    if (offline) return;
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [offline]);

  function loaded(next: QuickLinkPayload) {
    setView(next);
    setLoadedKey(`${next.request.status}:${next.link.isClosed}`);
  }

  async function act(body: Record<string, unknown>): Promise<boolean> {
    if (offline) return false;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/h/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
        return false;
      }
      const data = (await res.json().catch(() => null)) as (QuickLinkPayload & { error?: string }) | null;
      if (!res.ok || !data || data.error) {
        setError(
          res.status === 404
            ? "This link no longer works."
            : "This link can't do that any more. The page shows where things stand now.",
        );
        const fresh = await fetch(`/api/h/${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
        if (fresh?.ok) loaded((await fresh.json()) as QuickLinkPayload);
        return false;
      }
      loaded(data);
      return true;
    } catch {
      setError("Could not reach Relay. Check your connection and try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  function pickSuggestion(reply: string) {
    setSuggestion(reply);
    setDraft(reply);
  }

  async function sendAnswer(text: string) {
    if (await act({ action: "answer", text, replyMode })) {
      setDraft("");
      setSuggestion(null);
    }
  }

  async function sendLive(text: string) {
    if (await act({ action: "message", text })) setDraft("");
  }

  function onLiveDraft(value: string) {
    setDraft(value);
    const nowMs = Date.now();
    if (offline || !value.trim() || nowMs - lastTypingPost.current < TYPING_THROTTLE_MS) return;
    lastTypingPost.current = nowMs;
    void fetch(`/api/h/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "typing" }),
    }).catch(() => {});
  }

  const takeOver = view.link.canTakeOver ? () => void act({ action: "take_over" }) : undefined;
  const clock = (iso: string | null | undefined) => formatClock(iso, timeZone);
  const desktop = size === "desktop";

  const card = (
    <HandoffRequestCard
      state={CARD_STATE[screen]}
      size={size}
      question={view.request.questions[0]?.text ?? ""}
      reason={view.request.reason}
      customer={`${CUSTOMER} · ${channel.label}`}
      source={channel.glyph}
      waitingText={waitingText(view.request.createdAt, new Date(nowMs))}
      suggestedReplies={view.request.suggestedReplies}
      onReply={screen === "open" && !pending ? pickSuggestion : undefined}
      statusText={cardStatusText(view, timeZone)}
      onHandBack={screen === "taken-over" && view.link.canHandBack && !pending ? () => void act({ action: "hand_back" }) : undefined}
      onTakeOverAgain={screen === "handed-back" ? takeOver : undefined}
    />
  );

  const messages = (
    <TranscriptMessages
      view={view}
      messages={transcript}
      clock={clock}
      size={size}
      customerTyping={customerTyping && (screen === "taken-over" || screen === "handed-back")}
    />
  );

  const banner = <Banner view={view} screen={screen} timeZone={timeZone} idleMinutes={idleMinutes} />;
  const notice = screen === "expired" || screen === "closed" ? <Notice view={view} screen={screen} /> : null;
  const errorLine = error ? (
    <p role="alert" className="flex items-center gap-2 type-small text-destructive">
      <Icon name="circle-alert" size={14} />
      {error}
    </p>
  ) : null;

  const dock = (
    <Dock
      view={view}
      screen={screen}
      size={size}
      replying={replying}
      draft={draft}
      suggestion={suggestion}
      replyMode={replyMode}
      pending={pending}
      clock={clock}
      onDraft={screen === "taken-over" ? onLiveDraft : setDraft}
      onReplyMode={setReplyMode}
      onAnswer={sendAnswer}
      onLive={sendLive}
      onTakeOver={takeOver}
      onDone={() => void act({ action: "done" })}
      error={errorLine}
    />
  );

  const header = (
    <HandoffHeader
      size={size}
      company={view.company.name || "Relay"}
      linkText={headerLinkText(view, timeZone, size)}
      onTakeOver={desktop && screen !== "taken-over" && !pending ? takeOver : undefined}
    />
  );

  if (desktop) {
    return (
      <div data-slot="quick-link" data-screen={screen} data-size="desktop" className="flex h-dvh flex-col bg-background">
        {header}
        <main className="flex min-h-0 flex-1">
          <section aria-label="Conversation" className="min-w-0 flex-[2] overflow-y-auto border-r border-border">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-8">
              <div className="flex flex-col gap-1">
                <span className="type-label text-muted-foreground">Conversation so far</span>
                <h1 className="type-h3 text-foreground">{CUSTOMER}</h1>
                <p className="flex items-center gap-2 type-small text-muted-foreground">
                  <BrandGlyph brand={channel.glyph} size={16} />
                  {channel.label}
                  {view.agent ? ` · talking to ${view.agent.name}` : ""}
                  {transcript[0] ? ` · started ${clock(transcript[0].createdAt)}` : ""}
                </p>
              </div>
              {view.transcript ? messages : <p className="type-small text-muted-foreground">The conversation is no longer shown on this link.</p>}
            </div>
          </section>
          <aside aria-label="Your answer" className="flex w-[480px] shrink-0 flex-col gap-4 overflow-y-auto p-6">
            {banner}
            {card}
            {notice}
            <div className="flex-1" />
            {dock}
          </aside>
        </main>
      </div>
    );
  }

  return (
    <div data-slot="quick-link" data-screen={screen} data-size="mobile" className="flex min-h-dvh flex-col bg-background">
      <div className="sticky top-0 z-10">{header}</div>
      <main className="flex flex-1 flex-col gap-3 px-4 py-3">
        {banner}
        {card}
        {notice}
        {view.transcript ? (
          replying && !expanded ? (
            <button
              type="button"
              data-slot="conversation-collapsed"
              onClick={() => setExpanded(true)}
              aria-expanded={false}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-card px-4 text-left outline-none focus-visible:shadow-focus-ring"
            >
              <Icon name="messages-square" size={16} className="text-foreground" />
              <span className="flex-1 type-small text-foreground">Conversation so far</span>
              <span className="type-caption text-muted-foreground">
                {transcript.length} {transcript.length === 1 ? "message" : "messages"}
              </span>
              <Icon name="chevron-down" size={16} className="text-muted-foreground" />
            </button>
          ) : (
            <section aria-label="Conversation so far" className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="type-label text-muted-foreground">Conversation so far</span>
                <span className="type-caption text-muted-foreground">{channel.label}</span>
              </div>
              {messages}
            </section>
          )
        ) : null}
      </main>
      <div className="sticky bottom-0 border-t border-border bg-background px-4 pt-2 pb-3">{dock}</div>
    </div>
  );
}

function Banner({
  view,
  screen,
  timeZone,
  idleMinutes,
}: {
  view: QuickLinkPayload;
  screen: ReturnType<typeof quickLinkScreen>;
  timeZone: string;
  idleMinutes: number;
}) {
  if (screen === "sent") {
    const { title, detail } = sentBanner(view, timeZone);
    return (
      <div data-slot="sent-banner" role="status" className="flex w-full items-start gap-3 rounded-xl border border-primary bg-card p-4">
        <Icon name="circle-check" size={20} className="shrink-0 text-status-approved-foreground" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="type-body-strong text-foreground">{title}</p>
          <p className="type-caption text-muted-foreground">{detail}</p>
        </div>
      </div>
    );
  }
  if (screen !== "taken-over" && screen !== "handed-back") return null;
  const { title, detail } = liveBanner(view, timeZone, idleMinutes);
  return (
    <div data-slot="live-banner" role="status" className="flex w-full items-center gap-3 rounded-xl border border-primary bg-primary-soft p-4">
      {screen === "taken-over" ? <StatusChip tone="live">Live</StatusChip> : <StatusChip tone="neutral">Agent</StatusChip>}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="type-body-strong text-foreground">{title}</p>
        <p className="type-caption text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function Notice({ view, screen }: { view: QuickLinkPayload; screen: "expired" | "closed" }) {
  const lifetime = linkLifetimeText(view.request.createdAt, view.request.expiresAt);
  const copy =
    screen === "closed"
      ? {
          icon: "circle-check" as IconName,
          title: "You closed this link.",
          detail: `Thanks. ${view.company.name || "The team"} has the conversation from here.`,
        }
      : {
          icon: "clock" as IconName,
          title: "Nobody answered in time, so the agent followed up with the customer.",
          detail: lifetime
            ? `Links are personal, single-use and expire ${lifetime} after sending.`
            : "Links are personal and single-use.",
        };
  return (
    <div data-slot="notice" className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
        <Icon name={copy.icon} size={18} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="type-body-strong text-foreground">{copy.title}</p>
        <p className="type-caption text-muted-foreground">{copy.detail}</p>
      </div>
    </div>
  );
}

function TranscriptMessages({
  view,
  messages,
  clock,
  size,
  customerTyping,
}: {
  view: QuickLinkPayload;
  messages: QuickLinkMessage[];
  clock: (iso: string | null | undefined) => string;
  size: Size;
  customerTyping: boolean;
}) {
  const channel = channelOf(view.channel);
  const sentId = view.sent?.id;
  const handoffAt = view.request.createdAt;
  const systemIndex = messages.findIndex((m) => m.createdAt > handoffAt);
  const systemLine = (
    <p key="handoff-sent" data-slot="system-line" className="flex items-center justify-center gap-2 py-1 type-caption text-muted-foreground">
      <Icon name="send" size={14} />
      {clock(handoffAt)} · Handoff sent to {personName(view)}
    </p>
  );

  const rows: React.ReactNode[] = [];
  messages.forEach((message, index) => {
    if (size === "desktop" && index === systemIndex) rows.push(systemLine);
    const author = messageAuthor(message, view);
    const human = message.author === "human";
    rows.push(
      <div key={message.id} className="flex flex-col items-end gap-1">
        <Message
          view="transcript"
          role={message.role}
          author={author}
          time={clock(message.createdAt)}
          initials={initialsOf(author)}
          source={channel.glyph}
        >
          {message.content}
        </Message>
        {human && message.id === sentId ? (
          <p data-slot="human-label" className="flex items-center gap-1 pr-8 type-caption text-muted-foreground">
            <Icon name="user-check" size={12} className="text-primary" />
            {view.request.replyMode === "agent" ? "Human answer · phrased by the agent" : "Human answer · sent with your name"}
          </p>
        ) : null}
      </div>,
    );
  });
  if (size === "desktop" && systemIndex === -1 && messages.length > 0) rows.push(systemLine);
  if (customerTyping) {
    rows.push(
      <Message
        key="typing"
        view="transcript"
        role="user"
        state="streaming"
        author={CUSTOMER}
        initials={initialsOf(CUSTOMER)}
        statusText="Customer is typing…"
      />,
    );
  }
  return <div className={cn("flex flex-col", size === "desktop" ? "gap-4" : "gap-2")}>{rows}</div>;
}

type DockProps = {
  view: QuickLinkPayload;
  screen: ReturnType<typeof quickLinkScreen>;
  size: Size;
  replying: boolean;
  draft: string;
  suggestion: string | null;
  replyMode: ReplyMode;
  pending: boolean;
  clock: (iso: string | null | undefined) => string;
  onDraft: (value: string) => void;
  onReplyMode: (mode: ReplyMode) => void;
  onAnswer: (text: string) => void;
  onLive: (text: string) => void;
  onTakeOver?: () => void;
  onDone: () => void;
  error: React.ReactNode;
};

function FooterNote({ icon = "lock", children, action }: { icon?: IconName; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div data-slot="footer-row" className="flex min-h-4 w-full items-center gap-2">
      <Icon name={icon} size={14} className="shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 type-caption text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

function Dock(props: DockProps) {
  const { view, screen, size, replying, draft, suggestion, replyMode, pending, clock, error } = props;
  const mobile = size === "mobile";
  const buttonSize = mobile ? "lg" : "md";
  const onlyYou = "Only you can use this link.";
  const expires = `${onlyYou} It expires at ${clock(view.request.expiresAt)}.`;

  if (screen === "open") {
    const person = personName(view);
    return (
      <div data-slot="dock" className="flex w-full flex-col gap-2">
        {!mobile ? (
          <div className="flex items-center justify-between">
            <span className="type-label text-muted-foreground">Your answer</span>
            <span className="type-caption text-muted-foreground">
              {replyMode === "person" ? "The customer sees your name" : "The agent phrases it"}
            </span>
          </div>
        ) : null}
        {replying ? (
          <div data-slot="send-as" className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="type-label text-muted-foreground">Send as</span>
              {suggestion !== null && draft !== suggestion ? (
                <span className="flex items-center gap-1 type-caption text-muted-foreground">
                  <Icon name="pencil" size={12} />
                  Edited from a suggested reply
                </span>
              ) : null}
            </div>
            <RadioGroup
              value={replyMode}
              onValueChange={(value) => props.onReplyMode(value as ReplyMode)}
              aria-label="Send as"
              className="gap-0"
            >
              <label className="flex min-h-11 cursor-pointer items-center gap-3 type-body text-foreground">
                <RadioGroupItem value="person" />
                As {person} (customer sees your name)
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 type-body text-foreground">
                <RadioGroupItem value="agent" />
                Let the agent phrase it
              </label>
            </RadioGroup>
          </div>
        ) : null}
        <ChatComposer
          size={size}
          value={draft}
          onChange={props.onDraft}
          onSubmit={props.onAnswer}
          disabled={pending}
          placeholder="Write your answer…"
          aria-label="Your answer"
        />
        {error}
        <FooterNote
          action={
            mobile && !replying && props.onTakeOver ? (
              <Button variant="secondary" size="lg" onClick={props.onTakeOver} disabled={pending}>
                Take over chat
              </Button>
            ) : undefined
          }
        >
          {mobile ? onlyYou : expires}
        </FooterNote>
      </div>
    );
  }

  if (screen === "taken-over") {
    return (
      <div data-slot="dock" className="flex w-full flex-col gap-2">
        <ChatComposer
          size={size}
          value={draft}
          onChange={props.onDraft}
          onSubmit={props.onLive}
          disabled={pending}
          placeholder="Write to the customer…"
          aria-label="Message to the customer"
        />
        {error}
        <FooterNote>{onlyYou}</FooterNote>
      </div>
    );
  }

  if (screen === "sent") {
    return (
      <div data-slot="dock" className="flex w-full flex-col gap-2">
        {!view.link.isClosed ? (
          <div className="flex w-full gap-3">
            {props.onTakeOver ? (
              <Button variant="outline" size={buttonSize} className="flex-1" onClick={props.onTakeOver} disabled={pending}>
                Take over chat
              </Button>
            ) : null}
            <Button size={buttonSize} className="flex-1" onClick={props.onDone} disabled={pending}>
              Done
            </Button>
          </div>
        ) : null}
        {error}
        <FooterNote>{view.link.isClosed ? "You closed this link." : onlyYou}</FooterNote>
      </div>
    );
  }

  if (screen === "handed-back") {
    return (
      <div data-slot="dock" className="flex w-full flex-col gap-2">
        {props.onTakeOver ? (
          <Button size={buttonSize} className="w-full" onClick={props.onTakeOver} disabled={pending}>
            Take over again
          </Button>
        ) : null}
        {error}
        <FooterNote>The agent replies to the customer from here on.</FooterNote>
      </div>
    );
  }

  return (
    <div data-slot="dock" className="flex w-full flex-col gap-2">
      {error}
      <FooterNote icon="info">
        {screen === "closed"
          ? "This link is closed. The team follows up from the Inbox."
          : "This link can no longer answer the customer. The team follows up from the Inbox."}
      </FooterNote>
    </div>
  );
}
