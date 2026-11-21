"use client"

import { Loader2Icon } from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Figma 02 Toast `4:292` (v2 restyle): 320 wide, radius/xl, elevation/3, padding
// space/4 x space/3, title type/body-strong over a type/small description, 4 apart.
// variant=default is the popover surface (toast / toast.success / toast.info);
// variant=error is a solid destructive fill (toast.error). No status icon, only the
// loading spinner. Styles are unstyled + classNames so sonner's own CSS does not win.
export const toastClassNames = {
  toast:
    "group/toast flex w-full items-start gap-3 rounded-xl border border-border bg-popover px-4 py-3 text-popover-foreground shadow-elevation-3",
  content: "flex min-w-0 flex-1 flex-col gap-1",
  title: "type-body-strong",
  description: "type-small text-muted-foreground",
  icon: "hidden in-data-[type=loading]:flex size-5 shrink-0 items-center justify-center",
  error:
    "border-destructive bg-destructive text-destructive-foreground [&_[data-description]]:text-destructive-foreground",
  actionButton:
    "type-body-strong ml-auto shrink-0 rounded-lg bg-primary px-3 py-1 text-primary-foreground",
  cancelButton:
    "type-body-strong shrink-0 rounded-lg bg-secondary px-3 py-1 text-secondary-foreground",
  closeButton: "text-muted-foreground",
} satisfies NonNullable<ToasterProps["toastOptions"]>["classNames"]

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{ unstyled: true, classNames: toastClassNames }}
      style={{ "--width": "320px" } as React.CSSProperties}
      position="bottom-right"
      {...props}
    />
  )
}

export { Toaster }
