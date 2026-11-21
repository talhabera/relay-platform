"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { Chip } from "../primitives/chip";
import { IconButton } from "../primitives/icon-button";
import type { IconName } from "../primitives/icon";

type SteeringChip = { label: string; icon?: IconName };

type SteeringQuote = {
  /** Small line above the quote, e.g. "Ask for changes · Checkpoint". */
  label?: string;
  /** Quoted checkpoint title. */
  text: string;
};

type SteeringComposerProps = Omit<React.ComponentProps<"form">, "onChange" | "onSubmit" | "children"> & {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  /** Steering chips above the input (Figma boolean `chips`). */
  chips?: SteeringChip[];
  onChip?: (label: string) => void;
  /** Set after Ask for changes: the checkpoint is quoted above the input. */
  quote?: SteeringQuote;
  onRemoveQuote?: () => void;
  /** Read-only member: muted box, no steering. */
  disabled?: boolean;
  disabledPlaceholder?: string;
  /** Shows a disabled attach button with this tooltip; omitted hides it. */
  attachTooltip?: string;
};

/**
 * Figma `Steering composer` (02 `376:24845`): bottom of a session conversation.
 * default | focus (ring + focus/ring, via focus-within) | quoting (checkpoint quoted after
 * Ask for changes) | disabled (read-only member).
 */
function SteeringComposer({
  className,
  value,
  onChange,
  onSubmit,
  placeholder = "Tell the agent what to change…",
  chips = [],
  onChip,
  quote,
  onRemoveQuote,
  disabled = false,
  disabledPlaceholder = "Read-only · you can view this session but not steer it",
  attachTooltip = "File attach is not available yet.",
  ...props
}: SteeringComposerProps) {
  const quoting = !disabled && quote !== undefined;
  const state = disabled ? "disabled" : quoting ? "quoting" : "default";
  const canSend = !disabled && value.trim().length > 0;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSend) onSubmit(value.trim());
  };

  return (
    <form
      data-slot="steering-composer"
      data-state={state}
      onSubmit={submit}
      className={cn("flex w-full min-w-0 flex-col items-start gap-2", className)}
      {...props}
    >
      {chips.length > 0 ? (
        <div
          data-slot="steering-chips"
          className={cn("flex w-full flex-wrap items-start gap-2", disabled && "opacity-40")}
        >
          {chips.map((c) => (
            <Chip
              key={c.label}
              variant="steering"
              size="sm"
              icon={c.icon}
              disabled={disabled}
              onClick={onChip ? () => onChip(c.label) : undefined}
            >
              {c.label}
            </Chip>
          ))}
        </div>
      ) : null}
      <div
        data-slot="steering-input"
        className={cn(
          "flex w-full flex-col gap-2 overflow-hidden rounded-xl border p-2 transition-[border-color,box-shadow]",
          disabled
            ? "border-border bg-muted"
            : cn(
                "bg-surface-raised focus-within:border-ring focus-within:shadow-focus-ring",
                quoting ? "border-ring shadow-focus-ring" : "border-input",
              ),
        )}
      >
        {quoting ? (
          <div data-slot="steering-quote" className="flex w-full items-center gap-3 rounded-md bg-primary-soft px-3 py-2">
            <span aria-hidden className="w-0.5 self-stretch bg-primary" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate type-caption text-primary-soft-foreground">
                {quote.label ?? "Ask for changes · Checkpoint"}
              </span>
              <span className="truncate type-small text-foreground">{quote.text}</span>
            </div>
            <IconButton icon="x" label="Remove quote" size="sm" onClick={onRemoveQuote} />
          </div>
        ) : null}
        <div className="flex w-full items-center gap-2">
          <span title={attachTooltip}>
            <IconButton icon="paperclip" label={attachTooltip} disabled />
          </span>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            rows={1}
            aria-label="Steer the agent"
            placeholder={disabled ? disabledPlaceholder : quoting ? "Say what should change…" : placeholder}
            className="field-sizing-content max-h-40 min-h-5 min-w-0 flex-1 resize-none bg-transparent type-body text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <IconButton type="submit" variant="filled" icon="arrow-up" label="Send" disabled={disabled} />
        </div>
      </div>
    </form>
  );
}

export { SteeringComposer };
export type { SteeringChip, SteeringComposerProps, SteeringQuote };
