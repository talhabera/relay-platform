import Link from "next/link";

import { cn } from "@/lib/utils";

/** Bars of the Figma `Brand mark` (02 `7:8`): left offset, top offset, width (px, 3px high). */
const BARS = [
  "top-[9px] left-2 w-4",
  "top-[14.5px] left-3 w-3",
  "top-5 left-2 w-[9px]",
] as const;

/** Figma `Brand mark` (02 `7:8`): 32px primary tile, radius/lg, three stacked bars. */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      data-slot="brand-mark"
      aria-hidden
      className={cn("relative block size-8 shrink-0 rounded-lg bg-primary", className)}
    >
      {BARS.map((pos) => (
        <span
          key={pos}
          data-slot="brand-mark-bar"
          className={cn("absolute h-[3px] rounded-full bg-primary-foreground", pos)}
        />
      ))}
    </span>
  );
}

type BrandLockupProps = {
  /** Link target; `null` renders a plain block (e.g. on the auth screens). */
  href?: string | null;
  className?: string;
};

/** Figma `Brand lockup` (02 `7:12`): Brand mark + "Relay" in type/h3, 8px gap. */
function BrandLockup({ href = "/home", className }: BrandLockupProps) {
  const inner = (
    <>
      <BrandMark />
      <span className="type-h3 whitespace-nowrap text-foreground">Relay</span>
    </>
  );
  const classes = cn("flex shrink-0 items-center gap-2", className);

  if (!href) {
    return (
      <div data-slot="brand-lockup" className={classes}>
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={href}
      data-slot="brand-lockup"
      aria-label="Relay home"
      className={cn(classes, "rounded-lg outline-none focus-visible:shadow-focus-ring")}
    >
      {inner}
    </Link>
  );
}

export { BrandLockup, BrandMark };
export type { BrandLockupProps };
