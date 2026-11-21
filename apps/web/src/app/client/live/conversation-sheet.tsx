"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Icon } from "@/components/v2/primitives/icon";
import { IconButton } from "@/components/v2/primitives/icon-button";

import { ConversationBody } from "./conversation-body";
import type { ConversationView } from "./conversation-model";

/** Error copy for `POST /api/client/answer-now` (S36). */
export function answerNowError(status: number): string {
  if (status === 409) return "Someone is already answering this conversation.";
  if (status === 404) return "This conversation is no longer available.";
  if (status === 429) return "Too many attempts. Try again in a minute.";
  if (status === 403) return "Only client users can answer from Live.";
  return "Could not start answering. Try again.";
}

/** Answer now = Takeover authored by the signed-in client user; opens the 11c chat surface. */
function AnswerNowButton({
  companyId,
  chatId,
  onError,
}: {
  companyId: string;
  chatId: string;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function answerNow() {
    setPending(true);
    onError(null);
    try {
      const res = await fetch("/api/client/answer-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, chatId }),
      });
      if (!res.ok) {
        onError(answerNowError(res.status));
        setPending(false);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      router.push(url);
    } catch {
      onError(answerNowError(0));
      setPending(false);
    }
  }

  return (
    <Button onClick={() => void answerNow()} disabled={pending} data-slot="live-answer-now">
      <Icon name="send" size={16} />
      Answer now
    </Button>
  );
}

export function OpenInInboxButton({ href }: { href: string }) {
  return (
    <Button asChild variant="outline" data-slot="live-open-inbox">
      <Link href={href}>
        <Icon name="inbox" size={16} />
        Open in Inbox
      </Link>
    </Button>
  );
}

/**
 * Figma 11b `11/live/conversation-open`: right sheet over the Live page. A
 * client user gets Answer now on a waiting conversation; the owner / member
 * preview gets Open in Inbox instead (spec client-role-and-portal, decision 5).
 */
export function ConversationSheet({
  view,
  companyId,
  readOnly,
  closeHref,
}: {
  view: ConversationView;
  companyId: string;
  readOnly: boolean;
  closeHref: string;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  const action = readOnly ? (
    <OpenInInboxButton href={view.inboxHref} />
  ) : (
    <AnswerNowButton companyId={companyId} chatId={view.chatId} onError={setError} />
  );
  const actionNote = readOnly
    ? { text: "Preview · staff answer from the Inbox", tone: "muted" as const }
    : { text: view.banner?.waited ?? "", tone: "warning" as const };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
    >
      <SheetContent side="right" showCloseButton={false} className="w-full sm:max-w-140">
        <SheetTitle className="sr-only">Conversation with {view.customer}</SheetTitle>
        <SheetDescription className="sr-only">Live transcript, read-only</SheetDescription>
        <ConversationBody
          view={view}
          action={action}
          actionNote={actionNote}
          error={error}
          close={
            <SheetClose asChild>
              <IconButton icon="x" label="Close" />
            </SheetClose>
          }
        />
      </SheetContent>
    </Sheet>
  );
}
