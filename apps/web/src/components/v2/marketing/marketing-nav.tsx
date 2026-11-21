"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { IconButton } from "../primitives/icon-button";
import { BrandLockup } from "../shell/brand";

type MarketingLink = { label: string; href: string };

const MARKETING_NAV_LINKS: readonly MarketingLink[] = [
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Blog", href: "/blog" },
];

type MarketingNavProps = {
  className?: string;
  links?: readonly MarketingLink[];
  signInHref?: string;
  /** Opens the Request access dialog (S103). Without it the CTA links to `requestAccessHref`. */
  onRequestAccess?: () => void;
  requestAccessHref?: string;
  /** Start with the mobile menu open (Figma `mode=mobile-open`). */
  defaultOpen?: boolean;
};

function RequestAccess({
  onRequestAccess,
  href,
  className,
  onNavigate,
}: {
  onRequestAccess?: () => void;
  href: string;
  className?: string;
  onNavigate?: () => void;
}) {
  if (onRequestAccess) {
    return (
      <Button
        className={className}
        onClick={() => {
          onNavigate?.();
          onRequestAccess();
        }}
      >
        Request access
      </Button>
    );
  }
  return (
    <Button asChild className={className}>
      <Link href={href} onClick={onNavigate}>
        Request access
      </Link>
    </Button>
  );
}

/**
 * Figma `Marketing nav` (02 `19:393`): mode desktop | mobile | mobile-open. Desktop (md+): Brand
 * lockup, floating pill with Features · Pricing · Blog, Sign in (ghost) + Request access. Below md:
 * 64px bar with a menu Icon button that expands the links and full-width actions in place.
 * Sign in only; there is no public create-account CTA.
 */
function MarketingNav({
  className,
  links = MARKETING_NAV_LINKS,
  signInHref = "/sign-in",
  onRequestAccess,
  requestAccessHref = "/#request-access",
  defaultOpen = false,
}: MarketingNavProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const close = () => setOpen(false);

  return (
    <header
      data-slot="marketing-nav"
      data-state={open ? "open" : "closed"}
      className={cn("flex w-full flex-col border-b border-border bg-background", className)}
    >
      <div className="flex h-16 w-full items-center justify-between gap-6 px-6 py-3 md:h-auto md:px-8 md:py-4">
        <div className="flex h-10 items-center md:w-60">
          <BrandLockup href="/" />
        </div>
        <nav
          data-slot="marketing-nav-links"
          aria-label="Main"
          className="hidden shrink-0 items-center gap-8 rounded-full border border-border bg-nav px-6 py-3 shadow-elevation-2 md:flex"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="type-body-strong whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div data-slot="marketing-nav-actions" className="hidden h-10 w-60 items-center justify-end gap-2 md:flex">
          <Button asChild variant="ghost">
            <Link href={signInHref}>Sign in</Link>
          </Button>
          <RequestAccess onRequestAccess={onRequestAccess} href={requestAccessHref} />
        </div>
        <IconButton
          icon={open ? "x" : "menu"}
          label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="marketing-nav-menu"
          onClick={() => setOpen((value) => !value)}
          className="md:hidden"
        />
      </div>
      {open ? (
        <div
          id="marketing-nav-menu"
          data-slot="marketing-nav-menu"
          className="flex w-full flex-col items-start gap-6 px-6 pt-2 pb-6 md:hidden"
        >
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={close} className="type-h3 text-foreground outline-none">
              {link.label}
            </Link>
          ))}
          <div className="flex w-full flex-col gap-3 pt-4">
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link href={signInHref} onClick={close}>
                Sign in
              </Link>
            </Button>
            <RequestAccess onRequestAccess={onRequestAccess} href={requestAccessHref} className="w-full px-5" onNavigate={close} />
          </div>
        </div>
      ) : null}
    </header>
  );
}

export { MARKETING_NAV_LINKS, MarketingNav };
export type { MarketingLink, MarketingNavProps };
