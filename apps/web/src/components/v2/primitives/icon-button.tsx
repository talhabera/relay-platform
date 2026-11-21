import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "./icon";

/**
 * Figma `Icon button` (02 `351:616`): round, icon-only. ghost for toolbars and headers,
 * outline for secondary actions, filled for the primary action (send). sm 32 / md 40 /
 * lg 44 (mobile touch size, 20px icon).
 */
const iconButtonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-[color,background-color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        outline: "border border-border bg-card text-foreground hover:bg-accent",
        filled: "bg-primary text-primary-foreground hover:bg-primary/90",
      },
      size: {
        sm: "size-8",
        md: "size-10",
        lg: "size-11",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

type IconButtonProps = Omit<React.ComponentProps<"button">, "children" | "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    icon: IconName;
    /** Accessible name; icon-only buttons must have one. */
    label: string;
    /** 8px unread / attention dot, ringed in the surface colour. */
    dot?: boolean;
  };

function IconButton({ className, variant = "ghost", size = "md", icon, label, dot = false, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      data-slot="icon-button"
      data-variant={variant}
      data-size={size}
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      <Icon name={icon} size={size === "sm" ? 16 : 20} />
      {dot ? (
        <span
          data-slot="icon-button-dot"
          aria-hidden
          className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-background"
        />
      ) : null}
    </button>
  );
}

export { IconButton, iconButtonVariants };
export type { IconButtonProps };
