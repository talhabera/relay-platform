"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Figma 02 Switch `4:170`: 36x20 track with 2px inset, 16px thumb. Off = muted-foreground
// thumb on muted, on = primary-foreground thumb on primary. Focus and error draw an
// inset 1px border (primary / destructive) so the track never changes size.
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full p-0.5 transition-[background-color,box-shadow] outline-none data-[state=unchecked]:bg-muted data-[state=checked]:bg-primary focus-visible:shadow-[inset_0_0_0_1px_var(--primary),var(--shadow-focus-ring)] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full ring-0 transition-transform data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-muted-foreground data-[state=checked]:bg-primary-foreground group-data-[size=default]/switch:size-4 group-data-[size=default]/switch:data-[state=checked]:translate-x-4 group-data-[size=sm]/switch:size-3 group-data-[size=sm]/switch:data-[state=checked]:translate-x-3"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
