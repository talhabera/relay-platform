import * as React from "react";

import { cn } from "@/lib/utils";

import { BrandGlyph } from "../primitives/brand-glyph";
import { Icon } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";
import { StatusChip, type StatusTone } from "../primitives/status-chip";

type ReviewSource = "google" | "trustpilot";
type ReviewSentiment = "positive" | "neutral" | "negative";
type ReviewReplyStatus = "drafted" | "approved" | "posted";

const sentimentTone: Record<ReviewSentiment, StatusTone> = {
  positive: "success",
  neutral: "neutral",
  negative: "error",
};

const replyStatus: Record<ReviewReplyStatus, { tone: StatusTone; label: string }> = {
  drafted: { tone: "draft", label: "Drafted" },
  approved: { tone: "live", label: "Approved" },
  posted: { tone: "success", label: "Posted" },
};

const sourceLabel: Record<ReviewSource, string> = { google: "Google", trustpilot: "Trustpilot" };

/** Google replies cap at 4096 characters (Figma counter). */
const REPLY_LIMIT = 4096;

function Stars({ rating }: { rating: number }) {
  const filled = Math.round(Math.min(Math.max(rating, 0), 5));
  return (
    <span role="img" aria-label={`${filled} of 5 stars`} data-slot="review-stars" className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <Icon
          key={i}
          name="star"
          size={14}
          data-filled={i < filled}
          className={i < filled ? "fill-warning text-warning" : "text-muted-foreground"}
        />
      ))}
    </span>
  );
}

type ReviewCardProps = Omit<React.ComponentProps<"article">, "children"> & {
  source: ReviewSource;
  /** 1-5 stars. */
  rating: number;
  author: string;
  /** Pre-formatted date, e.g. "22 Sep 2026". */
  date: string;
  /** Review text; collapsed shows it on one line. */
  text: string;
  sentiment: ReviewSentiment;
  replyStatus?: ReviewReplyStatus;
  /** Drafted reply shown in the expanded editor. */
  reply?: string;
  /** Posting is a checkpoint: show the Needs you approval chip while pending. */
  needsApproval?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onEmoji?: () => void;
  onVariable?: () => void;
};

/**
 * Figma `Review card` (02 `378:26623`): state collapsed | expanded x sentiment x source.
 * Collapsed = source, stars, author, date, one-line review, sentiment and reply status.
 * Expanded = full review + drafted reply editor with character count and Needs you chip.
 * Once posted (05 session-reviews/approved) the reply is read-only: "Posted reply", no toolbar.
 */
function ReviewCard({
  className,
  source,
  rating,
  author,
  date,
  text,
  sentiment,
  replyStatus: status = "drafted",
  reply,
  needsApproval = true,
  expanded = false,
  onExpandedChange,
  onEmoji,
  onVariable,
  ...props
}: ReviewCardProps) {
  const replyId = React.useId();
  const rs = replyStatus[status];
  const posted = status === "posted";
  return (
    <article
      data-slot="review-card"
      data-state={expanded ? "expanded" : "collapsed"}
      data-sentiment={sentiment}
      data-source={source}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border bg-card p-4 shadow-elevation-1",
        expanded ? "border-primary" : "border-border",
        className,
      )}
      {...props}
    >
      <BrandGlyph brand={source} size={24} label={sourceLabel[source]} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Stars rating={rating} />
          <span className="type-body-strong text-foreground">{author}</span>
          <span aria-hidden className="type-caption text-muted-foreground">
            ·
          </span>
          <span className="type-caption text-muted-foreground">{date}</span>
        </div>
        <p className={cn("type-body text-foreground", !expanded && "truncate")}>{text}</p>
        {expanded && reply !== undefined ? (
          <div
            id={replyId}
            data-slot="review-reply"
            className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background"
          >
            <div className="flex flex-col gap-1 px-4 py-3">
              <span className="type-label text-muted-foreground">{posted ? "Posted reply" : "Drafted reply"}</span>
              <p className="whitespace-pre-wrap type-body text-foreground">{reply}</p>
            </div>
            {posted ? null : (
              <div className="flex items-center justify-between border-t border-border py-1 pr-3 pl-2">
                <div className="flex gap-1">
                  <IconButton icon="smile" size="sm" label="Insert emoji" onClick={onEmoji} />
                  <IconButton icon="braces" size="sm" label="Insert variable" onClick={onVariable} />
                </div>
                <div className="flex items-center gap-3">
                  <span data-slot="review-reply-count" className="type-caption text-muted-foreground tabular-nums">
                    {reply.length} / {REPLY_LIMIT}
                  </span>
                  {needsApproval ? <StatusChip tone="needs-you" /> : null}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusChip tone={sentimentTone[sentiment]}>
          {sentiment[0].toUpperCase() + sentiment.slice(1)}
        </StatusChip>
        <StatusChip tone={rs.tone} dot={false}>
          {rs.label}
        </StatusChip>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? replyId : undefined}
          aria-label={expanded ? "Collapse review" : "Expand review"}
          onClick={() => onExpandedChange?.(!expanded)}
          className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:shadow-focus-ring"
        >
          <Icon name="chevron-down" size={16} className={cn(expanded && "rotate-180")} />
        </button>
      </div>
    </article>
  );
}

export { ReviewCard, REPLY_LIMIT };
export type { ReviewCardProps, ReviewReplyStatus, ReviewSentiment, ReviewSource };
