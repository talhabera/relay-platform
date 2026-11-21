import * as React from "react";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "@/components/v2/primitives";

/**
 * Landing section frame (Figma 09 `section/*`): 1440 desktop with space/20 sides and
 * space/10 vertical; 390 mobile with space/6 sides and space/12 vertical.
 */
export function LandingSection({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("w-full scroll-mt-20 px-6 py-12 md:px-20 md:py-10", className)} {...props}>
      <div className="mx-auto flex w-full max-w-[1280px] flex-col items-start gap-10">{children}</div>
    </section>
  );
}

/** Figma `section head`: primary eyebrow (type/label), type/h2 title, optional type/body lede. */
export function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <div data-slot="section-head" className="flex max-w-[720px] flex-col items-start gap-3">
      <p className="type-label text-primary">{eyebrow}</p>
      <h2 className="type-h2 text-foreground">{title}</h2>
      {lede ? <p className="type-body text-muted-foreground">{lede}</p> : null}
    </div>
  );
}

/** 36px primary-soft tile with a 20px icon (how-it-works steps, workflow cards). */
export function IconTile({ icon }: { icon: IconName }) {
  return (
    <span className="inline-flex shrink-0 rounded-lg bg-primary-soft p-2 text-primary">
      <Icon name={icon} size={20} />
    </span>
  );
}

/** Card surface shared by step, workflow and FAQ cards (radius-xl, elevation/1). */
export const landingCardClass = "rounded-xl border border-border bg-card p-6 shadow-elevation-1";
