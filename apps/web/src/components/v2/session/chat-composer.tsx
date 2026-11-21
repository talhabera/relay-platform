"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon } from "../primitives/icon";

type ChatComposerProps = Omit<React.ComponentProps<"form">, "onChange" | "onSubmit" | "children"> & {
  /** centered: empty-thread hero (heading + suggestions). docked: under the transcript. */
  mode?: "centered" | "docked";
  /** desktop: Send Button sm. mobile: 44px targets (Send Button lg, suggestion Buttons lg wrap). */
  size?: "desktop" | "mobile";
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** centered only. */
  heading?: string;
  /** centered only: suggestion Buttons under the box. */
  suggestions?: string[];
  onSuggestion?: (label: string) => void;
  /** Figma `paperclip`: hidden, or a disabled attach button with a tooltip. */
  paperclip?: "hidden" | "disabled";
  paperclipTooltip?: string;
};

/**
 * Figma `Chat composer` (02 `13:236`, restyled 2026-09-25): mode centered | docked x
 * state default | focus (ring, via focus-within) | disabled x paperclip hidden | disabled x
 * size desktop | mobile.
 */
function ChatComposer({
  className,
  mode = "docked",
  size = "desktop",
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "Message Relay…",
  heading = "What can I help you ship?",
  suggestions = [],
  onSuggestion,
  paperclip = "hidden",
  paperclipTooltip = "File attach is not available yet.",
  ...props
}: ChatComposerProps) {
  const mobile = size === "mobile";
  const centered = mode === "centered";

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled && value.trim()) onSubmit(value.trim());
  };

  return (
    <form
      data-slot="chat-composer"
      data-mode={mode}
      data-size={size}
      data-disabled={disabled || undefined}
      onSubmit={submit}
      className={cn("flex w-full min-w-0 flex-col items-center gap-4", className)}
      {...props}
    >
      {centered && heading ? <h2 className="text-center type-h2 text-foreground">{heading}</h2> : null}
      <div
        data-slot="chat-composer-box"
        className={cn(
          "flex w-full flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card p-3 transition-[border-color,box-shadow]",
          !disabled && "focus-within:border-ring focus-within:ring-1 focus-within:ring-ring",
        )}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={1}
          aria-label={placeholder}
          placeholder={placeholder}
          className="field-sizing-content max-h-48 min-h-5 w-full resize-none bg-transparent type-body text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex w-full items-center gap-2">
          {paperclip === "disabled" ? (
            <span title={paperclipTooltip} className="inline-flex">
              <button
                type="button"
                disabled
                aria-label={paperclipTooltip}
                data-slot="chat-composer-paperclip"
                className="inline-flex size-4 items-center justify-center text-muted-foreground"
              >
                <Icon name="paperclip" size={16} />
              </button>
            </span>
          ) : null}
          <span className="flex-1" />
          <Button type="submit" size={mobile ? "lg" : "sm"} disabled={disabled} className={cn(mobile && "font-medium")}>
            Send
          </Button>
        </div>
      </div>
      {centered && suggestions.length > 0 ? (
        <div data-slot="chat-composer-suggestions" className="flex w-full flex-wrap items-start justify-center gap-2">
          {suggestions.map((label) => (
            <Button
              key={label}
              type="button"
              variant="outline"
              size={mobile ? "lg" : "md"}
              disabled={disabled}
              onClick={onSuggestion ? () => onSuggestion(label) : undefined}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </form>
  );
}

export { ChatComposer };
export type { ChatComposerProps };
