import * as React from "react"

import { cn } from "@/lib/utils"

// Shared field look (Figma 02 Input `4:67`, Textarea `4:76`, Select `4:89`):
// radius/lg, input border on background, focus = primary border + focus/ring,
// error = destructive border (aria-invalid), disabled = 50% opacity.
const fieldClassName = cn(
  "w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-none transition-[color,border-color,box-shadow] outline-none",
  "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
  "focus-visible:border-primary focus-visible:shadow-focus-ring",
  "aria-invalid:border-destructive",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
)

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClassName,
        "h-10 py-2 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input, fieldClassName }
