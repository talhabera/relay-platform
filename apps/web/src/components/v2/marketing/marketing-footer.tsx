import Link from "next/link";

import { cn } from "@/lib/utils";

import { BrandLockup } from "../shell/brand";

type FooterColumn = { title: string; links: { label: string; href: string }[] };

/** Figma `Marketing footer` (02 `19:394`) columns, in order. */
const MARKETING_FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Customer agents", href: "/#customer-agents" },
      { label: "Operator workflows", href: "/#operator-workflows" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/#about" },
      { label: "FAQ", href: "/#faq" },
      { label: "Contact", href: "/#contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Docs", href: "/docs" },
      { label: "Changelog", href: "/changelog" },
      { label: "Status", href: "/status" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "DPA", href: "/dpa" },
    ],
  },
];

type MarketingFooterProps = {
  className?: string;
  columns?: readonly FooterColumn[];
  /** Copyright year; defaults to the current year. */
  year?: number;
};

/**
 * Figma `Marketing footer` (02 `19:394`): card surface with a top border. Brand lockup + tagline,
 * four link columns (160 wide, wrapping), separator, closed-beta line and copyright. At 390 the
 * horizontal padding drops to space/6 and the top to space/10 (sample `414:54231`).
 */
function MarketingFooter({ className, columns = MARKETING_FOOTER_COLUMNS, year = new Date().getFullYear() }: MarketingFooterProps) {
  return (
    <footer
      data-slot="marketing-footer"
      className={cn("flex w-full flex-col gap-10 border-t border-border bg-card px-6 pt-10 pb-10 md:px-20 md:pt-16", className)}
    >
      <div className="flex w-full flex-wrap items-start justify-between gap-x-12 gap-y-10">
        <div className="flex w-80 max-w-full flex-col gap-4">
          <BrandLockup href="/" />
          <p className="type-small text-muted-foreground">
            More qualified leads for every client. One desk for the agents your agency runs.
          </p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title} data-slot="marketing-footer-column" className="flex w-40 flex-col gap-3">
            <span className="type-body-strong text-foreground">{column.title}</span>
            {column.links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="type-small whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div role="separator" className="h-px w-full bg-border" />
      <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 type-caption text-muted-foreground">
        <p>Relay is in closed beta. Accounts are created by invitation only.</p>
        <p>© {year} Relay</p>
      </div>
    </footer>
  );
}

export { MARKETING_FOOTER_COLUMNS, MarketingFooter };
export type { FooterColumn, MarketingFooterProps };
