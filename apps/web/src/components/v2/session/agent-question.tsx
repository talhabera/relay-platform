import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Chip } from "../primitives/chip";
import { Icon } from "../primitives/icon";

type AgentQuestionProps = Omit<React.ComponentProps<"div">, "children"> & {
  state: "open" | "answered";
  question: string;
  context?: string;
  /** Agent that asked, e.g. "Lead Qualifier". */
  askedBy: string;
  /** Preformatted time, e.g. "11:48". */
  askedAt?: string;
  /** Quick replies shown while open. */
  replies?: string[];
  onReply?: (reply: string) => void;
  /** Chosen reply with who and when. Shown when answered. */
  answer?: { reply: string; by: string; at?: string };
};

/**
 * Figma `Agent question` (02 `375:25217`): the agent asks instead of guessing.
 * open: amber border, quick-reply outline Buttons, hint. answered: chosen reply Chip, who and when.
 */
function AgentQuestion({
  className,
  state,
  question,
  context,
  askedBy,
  askedAt,
  replies = [],
  onReply,
  answer,
  ...props
}: AgentQuestionProps) {
  const open = state === "open";
  return (
    <div
      data-slot="agent-question"
      data-state={state}
      className={cn(
        "flex w-full min-w-0 flex-col items-start gap-3 rounded-xl border bg-surface-raised p-4",
        open ? "border-status-needs-you-foreground" : "border-border",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2 whitespace-nowrap">
        <Icon
          name={open ? "message-circle" : "circle-check"}
          size={16}
          className={open ? "text-status-needs-you-foreground" : "text-success"}
        />
        <span className={cn("type-label uppercase", open ? "text-status-needs-you-foreground" : "text-muted-foreground")}>
          {open ? "Question" : "Answered"}
        </span>
        <span className="type-caption text-muted-foreground">
          {askedAt ? `${askedBy} · ${askedAt}` : askedBy}
        </span>
      </div>
      <p className="w-full type-body-strong text-foreground">{question}</p>
      {context ? <p className="w-full type-small text-muted-foreground">{context}</p> : null}
      {open ? (
        <>
          {replies.length > 0 ? (
            <div className="flex flex-wrap items-start gap-2">
              {replies.map((r) => (
                <Button key={r} variant="outline" size="md" onClick={onReply ? () => onReply(r) : undefined}>
                  {r}
                </Button>
              ))}
            </div>
          ) : null}
          <p className="type-caption text-muted-foreground">Or type your own answer in the composer.</p>
        </>
      ) : answer ? (
        <div className="flex items-center gap-2">
          <Chip asStatic variant="selected" size="md" icon="check">
            {answer.reply}
          </Chip>
          <span className="whitespace-nowrap type-caption text-muted-foreground">
            {answer.at ? `${answer.by} · ${answer.at}` : answer.by}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export { AgentQuestion };
export type { AgentQuestionProps };
