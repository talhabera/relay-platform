import * as React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";

/** One run of rendered email text; insert/delete are tracked changes. */
type EmailSegment = { text: string; change?: "insert" | "delete" };

/** One paragraph of the rendered body (never raw {{variables}}). */
type EmailParagraph = EmailSegment[];

type EmailCheck = {
  /** Section label, e.g. "Spam score". */
  label: string;
  /** Large metric shown under the label (Spam score), e.g. "1.2". */
  metric?: string;
  /** Status line, e.g. "Good, low risk". */
  detail: string;
  ok: boolean;
};

type PreviewOption = { value: string; label: string };

type EmailStepCardProps = Omit<React.ComponentProps<"section">, "children"> & {
  stepNumber: number;
  /** Defaults to "Step <n>". */
  stepTitle?: string;
  /** Send offset, e.g. "Day 0". */
  day: string;
  subject: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** "Preview as" recipients; the body is rendered for the selected one. */
  previewOptions?: PreviewOption[];
  previewValue?: string;
  onPreviewChange?: (value: string) => void;
  body?: EmailParagraph[];
  checks?: EmailCheck[];
  onTool?: (tool: EmailTool) => void;
};

type EmailTool = "bold" | "italic" | "link" | "image" | "code" | "undo-2" | "redo-2";

const formatTools: { tool: EmailTool; label: string }[] = [
  { tool: "bold", label: "Bold" },
  { tool: "italic", label: "Italic" },
  { tool: "link", label: "Link" },
  { tool: "image", label: "Image" },
  { tool: "code", label: "Code" },
];
const historyTools: { tool: EmailTool; label: string }[] = [
  { tool: "undo-2", label: "Undo" },
  { tool: "redo-2", label: "Redo" },
];

/** Counts tracked-change runs: { inserted, removed }. */
function countChanges(body: EmailParagraph[]): { inserted: number; removed: number } {
  let inserted = 0;
  let removed = 0;
  for (const para of body) {
    for (const seg of para) {
      if (seg.change === "insert") inserted += 1;
      else if (seg.change === "delete") removed += 1;
    }
  }
  return { inserted, removed };
}

function Segment({ segment }: { segment: EmailSegment }) {
  if (segment.change === "insert") {
    return (
      <ins data-change="insert" className="text-diff-insert-foreground underline">
        {segment.text}
      </ins>
    );
  }
  if (segment.change === "delete") {
    return (
      <del data-change="delete" className="text-diff-delete-foreground line-through">
        {segment.text}
      </del>
    );
  }
  return <>{segment.text}</>;
}

function ToolButton({ tool, label, onTool }: { tool: EmailTool; label: string; onTool?: (t: EmailTool) => void }) {
  return <IconButton icon={tool as IconName} size="sm" label={label} onClick={() => onTool?.(tool)} />;
}

/**
 * Figma `Email step card` (02 `376:24310`): mail sequence step. collapsed = header row;
 * expanded = Preview as select, subject, body with tracked changes, editor toolbar and the
 * checks column (spam score, links, unsubscribe, personalization).
 */
function EmailStepCard({
  className,
  stepNumber,
  stepTitle,
  day,
  subject,
  expanded = false,
  onExpandedChange,
  previewOptions = [],
  previewValue,
  onPreviewChange,
  body = [],
  checks = [],
  onTool,
  ...props
}: EmailStepCardProps) {
  const bodyId = React.useId();
  const { inserted, removed } = countChanges(body);
  const title = stepTitle ?? `Step ${stepNumber}`;

  return (
    <section
      data-slot="email-step-card"
      data-state={expanded ? "expanded" : "collapsed"}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevation-1",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => onExpandedChange?.(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:shadow-focus-ring"
      >
        <span
          data-slot="email-step-marker"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-primary type-small text-primary"
        >
          {stepNumber}
        </span>
        <span className="shrink-0 whitespace-nowrap type-body-strong text-foreground">{title}</span>
        <span aria-hidden className="type-small text-muted-foreground">
          ·
        </span>
        <span className="shrink-0 whitespace-nowrap type-small text-primary">{day}</span>
        <span aria-hidden className="type-small text-muted-foreground">
          ·
        </span>
        <span className="min-w-0 flex-1 truncate type-small text-muted-foreground">{subject}</span>
        <Icon name="chevron-down" size={16} className={cn("text-muted-foreground", expanded && "rotate-180")} />
      </button>

      {expanded ? (
        <div id={bodyId} data-slot="email-step-body" className="flex w-full flex-col gap-3 px-4 pb-4">
          {previewOptions.length > 0 ? (
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap type-small text-muted-foreground">Preview as</span>
              <Select value={previewValue} onValueChange={onPreviewChange}>
                <SelectTrigger aria-label="Preview as" className="w-100 max-w-full">
                  <SelectValue placeholder="Choose a recipient" />
                </SelectTrigger>
                <SelectContent>
                  {previewOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background md:flex-row">
            <div data-slot="email-editor" className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3 type-small">
                <span className="text-muted-foreground">Subject</span>
                <span className="min-w-0 truncate text-foreground">{subject}</span>
              </div>
              <div data-slot="email-body" className="flex flex-col gap-5 p-4 type-body text-foreground">
                {body.map((para, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    {para.map((seg, j) => (
                      <Segment key={j} segment={seg} />
                    ))}
                  </p>
                ))}
              </div>
              <div data-slot="email-toolbar" className="mt-auto flex items-center gap-1 border-t border-border px-3 py-2">
                {formatTools.map((t) => (
                  <ToolButton key={t.tool} {...t} onTool={onTool} />
                ))}
                <span aria-hidden className="h-4 w-px bg-border" />
                {historyTools.map((t) => (
                  <ToolButton key={t.tool} {...t} onTool={onTool} />
                ))}
                <span className="flex-1" />
                {inserted > 0 ? (
                  <span className="rounded-full bg-diff-insert px-2 py-1 type-caption text-diff-insert-foreground">
                    +{inserted} inserted
                  </span>
                ) : null}
                {removed > 0 ? (
                  <span className="rounded-full bg-diff-delete px-2 py-1 type-caption text-diff-delete-foreground">
                    −{removed} removed
                  </span>
                ) : null}
              </div>
            </div>

            {checks.length > 0 ? (
              <ul
                data-slot="email-checks"
                aria-label="Checks"
                className="flex w-full shrink-0 flex-col border-t border-border md:w-50 md:border-t-0 md:border-l"
              >
                {checks.map((c) => (
                  <li key={c.label} className="flex flex-col gap-1 border-b border-border px-4 py-3">
                    <span className="type-caption text-muted-foreground">{c.label}</span>
                    {c.metric ? <span className="type-metric text-primary">{c.metric}</span> : null}
                    <span data-ok={c.ok} className="flex items-center gap-2 type-small text-foreground">
                      <Icon
                        name={c.ok ? "circle-check" : "triangle-alert"}
                        size={16}
                        className={c.ok ? "text-success" : "text-warning"}
                      />
                      {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export { EmailStepCard, countChanges };
export type { EmailCheck, EmailParagraph, EmailSegment, EmailStepCardProps, EmailTool, PreviewOption };
