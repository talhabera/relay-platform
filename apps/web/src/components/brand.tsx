import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className,
      )}
      aria-hidden="true"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M4 2.5v11"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M12 2.5v11"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M4 8h2.2c.7 0 .9-2 1.8-2s1.1 2 1.8 2H12"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function BrandLockup({
  href = "/",
  subtitle,
  className,
}: {
  href?: string | null;
  subtitle?: string;
  className?: string;
}) {
  const inner = (
    <>
      <BrandMark />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold tracking-tight">Relay</span>
        {subtitle ? (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
    </>
  );

  if (!href) {
    return (
      <div className={cn("flex items-center gap-2.5", className)}>{inner}</div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {inner}
    </Link>
  );
}
