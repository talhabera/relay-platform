import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "./icon";

/** Figma `Chip` (02 `350:610`): variant default | selected | steering x size sm 24 | md 32 | lg 44. */
const chipVariants = cva(
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground [button&]:hover:bg-accent",
        selected: "border-primary bg-primary-soft text-primary-soft-foreground",
        steering: "border-dashed border-border-strong bg-surface-raised text-foreground [button&]:hover:bg-accent",
      },
      size: {
        sm: "h-6 gap-1 px-2 type-caption",
        md: "h-8 gap-2 px-3 type-body",
        lg: "h-11 gap-2 px-4 type-body",
      },
    },
    defaultVariants: { variant: "default", size: "sm" },
  },
);

const iconClass: Record<NonNullable<ChipVariant["variant"]>, string> = {
  default: "text-muted-foreground",
  selected: "text-primary",
  steering: "text-primary",
};

type ChipVariant = VariantProps<typeof chipVariants>;

type ChipProps = Omit<React.ComponentProps<"button">, "children"> &
  ChipVariant & {
    children?: React.ReactNode;
    /** Leading Figma `Icon/<name>` glyph (the `icon` + `iconSwap` props). */
    icon?: IconName;
    /** Render a non-interactive span (e.g. a read-only tag) instead of a button. */
    asStatic?: boolean;
  };

function Chip({ className, variant = "default", size = "sm", icon, asStatic = false, children, ...props }: ChipProps) {
  const v = variant ?? "default";
  const content = (
    <>
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} className={iconClass[v]} /> : null}
      {children}
    </>
  );
  const shared = {
    "data-slot": "chip",
    "data-variant": v,
    "data-size": size ?? "sm",
    className: cn(chipVariants({ variant, size }), className),
  };

  if (asStatic) {
    return <span {...shared}>{content}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={v === "selected" ? true : v === "default" ? false : undefined}
      {...shared}
      {...props}
    >
      {content}
    </button>
  );
}

export { Chip, chipVariants };
export type { ChipProps };
