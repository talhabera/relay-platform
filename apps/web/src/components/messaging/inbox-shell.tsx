"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/v2/primitives/icon";
import { cn } from "@/lib/utils";
import type { InboxData } from "@/app/(dashboard)/messaging/inbox-data";

import { InboxConversation } from "./inbox-conversation";
import { InboxDetails } from "./inbox-details";
import { InboxList } from "./inbox-list";
import {
  countTabs,
  filterConversations,
  type InboxSourceFilter,
  type InboxTab,
} from "./inbox-model";

/** The Inbox re-reads the server while it is visible, so new messages and handoff moves show up. */
const REFRESH_MS = 15_000;

type InboxShellProps = {
  data: InboxData;
  companyId: string;
  companyName: string;
  initialTab?: InboxTab;
  /** Owner or `agents` page access: shows the links into Agents. */
  canOpenAgents: boolean;
};

/**
 * Figma 08a Inbox (`1:9`): list, conversation, details. The selected chat
 * lives in the URL (`/messaging?chatId=…`), so Needs you deep links and
 * reloads land on the same conversation. Below 1024px one pane shows at a time.
 */
export function InboxShell({ data, companyId, companyName, initialTab = "all", canOpenAgents }: InboxShellProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<InboxTab>(initialTab);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<InboxSourceFilter>("all");
  const [mobilePane, setMobilePane] = useState<"list" | "conversation">(
    data.selected && !data.autoSelected ? "conversation" : "list",
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [router]);

  const visible = filterConversations(data.conversations, { tab, query, source });
  const counts = countTabs(data.conversations);
  const selectedId = data.selected?.id ?? null;
  const total = data.conversations.length;

  function select(id: string) {
    setMobilePane("conversation");
    if (id === selectedId) return;
    startTransition(() => {
      router.push(`/messaging?chatId=${encodeURIComponent(id)}`, { scroll: false });
    });
  }

  return (
    <div className="flex h-full min-h-0 gap-4 px-4 pb-4 md:px-6 md:pb-6">
      <InboxList
        className={cn("w-full lg:flex lg:w-96 lg:shrink-0 xl:w-108", mobilePane === "list" ? "flex" : "hidden")}
        companyName={companyName}
        conversations={visible}
        total={total}
        counts={counts}
        tab={tab}
        onTabChange={setTab}
        query={query}
        onQueryChange={setQuery}
        source={source}
        onSourceChange={setSource}
        selectedId={selectedId}
        onSelect={select}
      />

      {data.selected ? (
        <>
          <InboxConversation
            className={cn("min-w-0 flex-1 lg:flex", mobilePane === "conversation" ? "flex" : "hidden")}
            companyId={companyId}
            companyName={companyName}
            conversation={data.selected}
            onBack={() => setMobilePane("list")}
          />
          <InboxDetails
            className="hidden w-84 shrink-0 xl:flex"
            conversation={data.selected}
            canOpenAgents={canOpenAgents}
          />
        </>
      ) : (
        <section
          data-slot="inbox-empty"
          className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-10 text-center shadow-elevation-1 lg:flex"
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-secondary">
            <Icon name="inbox" size={24} className="text-foreground" />
          </span>
          <h2 className="type-h3 text-foreground">No customer conversations yet</h2>
          <p className="max-w-160 type-body text-muted-foreground">
            Conversations appear here, read-only, once a customer agent answers on the website widget, WhatsApp,
            Instagram or Messenger.
          </p>
          {canOpenAgents ? (
            <Button asChild>
              <Link href="/agents">Set up a source in Agents</Link>
            </Button>
          ) : null}
        </section>
      )}
    </div>
  );
}
