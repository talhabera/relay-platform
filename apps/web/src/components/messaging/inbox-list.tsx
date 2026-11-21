"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InboxRow } from "@/components/v2/data/inbox-row";
import { Segmented } from "@/components/v2/primitives/segmented";
import { cn } from "@/lib/utils";

import {
  INBOX_SOURCES,
  SOURCE_BRAND,
  SOURCE_LABEL,
  type InboxConversation,
  type InboxSourceFilter,
  type InboxTab,
} from "./inbox-model";

type InboxListProps = {
  className?: string;
  companyName: string;
  conversations: InboxConversation[];
  /** Total before filters; 0 means the company has no customer conversations at all. */
  total: number;
  counts: Record<InboxTab, number>;
  tab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  query: string;
  onQueryChange: (query: string) => void;
  source: InboxSourceFilter;
  onSourceChange: (source: InboxSourceFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function tabNote(tab: InboxTab, companyName: string, empty: boolean): string | null {
  if (tab === "waiting") {
    return `Handoffs nobody answered before the link expired. Answer them here as ${companyName}.`;
  }
  if (tab === "escalated") return "Only conversations the agent handed to a person.";
  return empty ? "No conversations match these filters." : null;
}

/** Figma 08a list pane: tabs, search + source filter, Inbox rows. */
export function InboxList({
  className,
  companyName,
  conversations,
  total,
  counts,
  tab,
  onTabChange,
  query,
  onQueryChange,
  source,
  onSourceChange,
  selectedId,
  onSelect,
}: InboxListProps) {
  const note = total === 0 ? "No conversations in any source yet." : tabNote(tab, companyName, conversations.length === 0);

  return (
    <section
      aria-label="Conversations"
      data-slot="inbox-list"
      className={cn(
        "flex min-h-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-elevation-1",
        className,
      )}
    >
      <Segmented
        aria-label="Inbox view"
        className="w-full"
        value={tab}
        onValueChange={(value) => onTabChange(value as InboxTab)}
        items={[
          { value: "all", label: "All" },
          { value: "waiting", label: `Waiting for you (${counts.waiting})` },
          { value: "escalated", label: `Escalated (${counts.escalated})` },
        ]}
      />
      <div className="flex gap-2">
        <Input
          type="search"
          aria-label="Search conversations"
          placeholder="Search conversations…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="h-10 min-w-0 flex-1"
        />
        <Select value={source} onValueChange={(value) => onSourceChange(value as InboxSourceFilter)}>
          <SelectTrigger aria-label="Source" className="h-10 w-38 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {INBOX_SOURCES.map((value) => (
              <SelectItem key={value} value={value}>
                {SOURCE_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-1">
        <ul className="flex flex-col gap-2" aria-label="Conversation list">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => onSelect(conversation.id)}
                aria-current={conversation.id === selectedId ? "true" : undefined}
                className="w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <InboxRow
                  state={conversation.id === selectedId ? "selected" : "default"}
                  customer={conversation.customer}
                  source={SOURCE_BRAND[conversation.source]}
                  time={conversation.time}
                  agent={conversation.agentLine}
                  snippet={conversation.snippet}
                  handoff={conversation.handoff}
                  status={conversation.chip}
                  className={conversation.id === selectedId ? undefined : "hover:bg-accent"}
                />
              </button>
            </li>
          ))}
        </ul>
        {note ? (
          <p
            data-slot="inbox-list-note"
            className={cn("type-caption text-muted-foreground", total === 0 ? "text-left" : "text-center")}
          >
            {note}
          </p>
        ) : null}
      </div>
    </section>
  );
}
