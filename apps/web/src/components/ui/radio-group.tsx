"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    />
  )
}

// Figma 02 Radio `4:149`: 16px round, border-strong on background; checked = primary
// fill + border with a 6px primary-foreground dot; focus = primary border + focus/ring.
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-background transition-[border-color,box-shadow] outline-none data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:border-primary focus-visible:shadow-focus-ring aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <span
          data-slot="radio-group-dot"
          className="block size-1.5 rounded-full bg-primary-foreground"
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
