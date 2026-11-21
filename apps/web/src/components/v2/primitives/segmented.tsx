"use client";

import * as React from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type SegmentedItem = { value: string; label: React.ReactNode; disabled?: boolean };

type SegmentedProps = Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange" | "children" | "orientation"
> & {
  /** 2-5 mutually exclusive segments. */
  items: SegmentedItem[];
  /** Selected value; leave undefined for Figma `active=none` (nothing picked yet). */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

/**
 * Figma `Segmented control` (02 `352:665`): switches between 2-5 views or ranges.
 * items=5 tightens segment padding to space/2 so five tabs fit a 440 inspector.
 */
function Segmented({ className, items, value, defaultValue, onValueChange, ...props }: SegmentedProps) {
  const tight = items.length >= 5;
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented"
      orientation="horizontal"
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      className={cn("inline-flex w-fit items-center rounded-full border border-border bg-card p-1", className)}
      {...props}
    >
      {items.map((item) => (
        <RadioGroupPrimitive.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          data-slot="segmented-item"
          className={cn(
            "inline-flex h-7 shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-full type-body text-muted-foreground outline-none transition-[color,background-color,box-shadow]",
            "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            "data-[state=checked]:bg-primary-soft data-[state=checked]:font-medium data-[state=checked]:text-primary-soft-foreground",
            tight ? "px-2" : "px-3",
          )}
        >
          {item.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

type SegmentedTabsItem = SegmentedItem & { content: React.ReactNode };

type SegmentedTabsProps = Omit<SegmentedProps, "items"> & {
  items: SegmentedTabsItem[];
  /** Wrapper around the control and the active panel. */
  rootClassName?: string;
  /** Classes for the active panel (e.g. `mt-6`). */
  contentClassName?: string;
};

/**
 * Segmented control that switches page sections (replaces `ui/tabs`). Only the active
 * panel mounts, matching the old Radix Tabs behaviour. Panel content may be server-rendered.
 */
function SegmentedTabs({
  items,
  value,
  defaultValue,
  onValueChange,
  rootClassName,
  contentClassName,
  ...props
}: SegmentedTabsProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? items[0]?.value);
  const active = value ?? uncontrolled;
  const panel = items.find((item) => item.value === active);

  function handleChange(next: string) {
    if (value === undefined) setUncontrolled(next);
    onValueChange?.(next);
  }

  return (
    <div data-slot="segmented-tabs" className={rootClassName}>
      <Segmented
        items={items.map(({ value: v, label, disabled }) => ({ value: v, label, disabled }))}
        value={active}
        onValueChange={handleChange}
        {...props}
      />
      {panel ? (
        <div data-slot="segmented-tabs-panel" role="region" aria-label={typeof panel.label === "string" ? panel.label : undefined} className={contentClassName}>
          {panel.content}
        </div>
      ) : null}
    </div>
  );
}

export { Segmented, SegmentedTabs };
export type { SegmentedItem, SegmentedProps, SegmentedTabsItem, SegmentedTabsProps };
