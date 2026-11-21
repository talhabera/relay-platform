import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Figma 02 Button set `4:42`: variant x size sm|md|lg, radius/lg, 16px leading icon
// (sm draws it at 14px), hover = 90% fill or accent, focus = focus/ring, disabled has
// its own colors instead of an opacity drop.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent text-sm font-medium transition-[color,background-color,opacity,box-shadow] outline-none disabled:pointer-events-none focus-visible:shadow-focus-ring aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:opacity-90 disabled:bg-primary-soft disabled:text-primary-soft-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground",
        outline:
          "border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground",
        ghost:
          "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground disabled:text-muted-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline disabled:text-muted-foreground",
      },
      size: {
        sm: "h-8 px-3 font-normal [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-10 px-4",
        default: "h-10 px-4",
        lg: "h-11 px-5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "md",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
