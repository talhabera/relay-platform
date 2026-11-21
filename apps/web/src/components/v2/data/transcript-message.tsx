import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { BrandGlyph, type BrandName } from "../primitives/brand-glyph";
import { initials } from "../shell/initials";

type TranscriptMessageProps = Omit<React.ComponentProps<"div">, "role"> & {
  /** user = customer (or the tester in the Chat dock), assistant = customer agent. */
  role: "user" | "assistant";
  /** Name above the bubble, e.g. "You · test", "Acme Website Assistant". */
  author: string;
  /** Initials source for the user avatar; defaults to `author`. */
  avatarName?: string;
  time?: string;
  /** Assistant: channel glyph beside the bubble. */
  source?: BrandName;
  text: React.ReactNode;
};

/**
 * Figma `Message` view=transcript (02 `14:149`) as used by the Chat dock and the read-only Inbox
 * transcript: customer left with an initials avatar, agent right with the source glyph; name and
 * time above each bubble, text max 300 wide.
 */
function TranscriptMessage({ className, role, author, avatarName, time, source = "website", text, ...props }: TranscriptMessageProps) {
  const user = role === "user";
  return (
    <div
      data-slot="transcript-message"
      data-role={role}
      className={cn("flex w-full items-start gap-2", !user && "justify-end", className)}
      {...props}
    >
      {user ? (
        <Avatar size="sm">
          <AvatarFallback>{initials(avatarName ?? author)}</AvatarFallback>
        </Avatar>
      ) : null}
      <div className={cn("flex min-w-0 flex-col gap-1", user ? "items-start" : "items-end")}>
        <div className="flex items-center gap-2 type-caption">
          <span className="text-foreground">{author}</span>
          {time ? <span className="text-muted-foreground">{time}</span> : null}
        </div>
        <div
          data-slot="transcript-message-bubble"
          className={cn(
            "rounded-xl border border-border px-3 py-2",
            user ? "rounded-tl-sm bg-card" : "rounded-tr-sm bg-primary-soft",
          )}
        >
          <p className="max-w-75 type-body break-words whitespace-pre-wrap text-foreground">{text}</p>
        </div>
      </div>
      {user ? null : <BrandGlyph brand={source} size={24} />}
    </div>
  );
}

export { TranscriptMessage };
export type { TranscriptMessageProps };
