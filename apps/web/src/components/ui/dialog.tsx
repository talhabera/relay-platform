"use client"

import * as React from "react"
import { TriangleAlertIcon, XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

// Figma 02 Dialog set `709:95882` (v2 restyle): radius/2xl, elevation/3, padding space/6,
// sections 16 apart, 480 wide by default (screens widen it to 520/560 via className).
// tone colors the optional title icon; footer is inline (right-aligned) or stacked
// (full-width primary + optional note). showCloseButton = Figma `showClose`.

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-overlay",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 flex w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col gap-4 rounded-2xl border border-border p-6 shadow-elevation-3 duration-200 outline-none sm:max-w-[480px]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-6 right-6"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-4 text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  layout = "inline",
  note,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Figma `footer`: inline = buttons right-aligned; stacked = full-width buttons, note below. */
  layout?: "inline" | "stacked"
  /** Figma `note` (shown when set): caption line under a stacked footer. */
  note?: React.ReactNode
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      data-layout={layout}
      className={cn(
        layout === "stacked"
          ? "flex flex-col items-stretch gap-3"
          : "flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="secondary">Close</Button>
        </DialogPrimitive.Close>
      )}
      {layout === "stacked" && note ? (
        <p
          data-slot="dialog-footer-note"
          className="type-caption text-muted-foreground text-center"
        >
          {note}
        </p>
      ) : null}
    </div>
  )
}

const dialogIconTone = {
  danger: "text-destructive",
  success: "text-success",
  neutral: "text-popover-foreground",
} as const

function DialogTitle({
  className,
  children,
  icon,
  tone = "danger",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title> & {
  /** Figma `titleIcon` + `icon`: true renders the default triangle-alert, a node swaps it. */
  icon?: React.ReactNode
  /** Figma `tone`: colors the title icon. */
  tone?: keyof typeof dialogIconTone
}) {
  const leading = icon === true ? <TriangleAlertIcon /> : icon
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      data-tone={leading ? tone : undefined}
      className={cn(
        "type-h3 text-popover-foreground flex items-center gap-3",
        className
      )}
      {...props}
    >
      {leading ? (
        <span
          data-slot="dialog-title-icon"
          aria-hidden="true"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center [&_svg]:size-5",
            dialogIconTone[tone]
          )}
        >
          {leading}
        </span>
      ) : null}
      {leading ? <span className="min-w-0 flex-1">{children}</span> : children}
    </DialogPrimitive.Title>
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("type-body text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
