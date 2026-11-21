import { cn } from "@/lib/utils"

/** Figma Skeleton (4:285): text 16 high radius/sm, block 40 high radius/xl, avatar 24 circle. */
const skeletonVariants = {
  text: "h-4 rounded-sm",
  block: "h-10 rounded-xl",
  avatar: "size-6 rounded-full",
} as const

function Skeleton({
  className,
  variant = "text",
  ...props
}: React.ComponentProps<"div"> & { variant?: keyof typeof skeletonVariants }) {
  return (
    <div
      data-slot="skeleton"
      data-variant={variant}
      className={cn("bg-muted animate-pulse", skeletonVariants[variant], className)}
      {...props}
    />
  )
}

export { Skeleton }
