"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Package,
  Plug,
  Settings,
  Shield,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

import { useCompany } from "@/components/shared/company-context";
import { cn } from "@/lib/utils";

import { activeSettingsHref, settingsNavSections, type SettingsNavIcon } from "./settings-nav";

const ICONS: Record<SettingsNavIcon, LucideIcon> = {
  shield: Shield,
  users: Users,
  plug: Plug,
  package: Package,
  building: Building2,
  user: User,
  settings: Settings,
};

/** Left column of the Settings shell (Figma 08c): section labels and the active item. */
export function SettingsNavPanel() {
  const pathname = usePathname();
  const { activeCompany } = useCompany();
  const active = activeSettingsHref(pathname);
  const sections = settingsNavSections(activeCompany?.name ?? null);

  return (
    <nav aria-label="Settings" className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <p className="truncate px-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            {section.label}
          </p>
          {section.items.map((item) => {
            const Icon = ICONS[item.icon];
            const isActive = item.href === active;
            const className = cn(
              "flex h-9 items-center gap-2.5 rounded-lg border border-transparent px-2.5 text-sm transition-colors",
              isActive
                ? "border-primary/60 bg-primary-soft font-medium text-primary-soft-foreground"
                : "text-foreground hover:bg-muted",
            );
            if (!item.available) {
              return (
                <span
                  key={item.href}
                  aria-disabled="true"
                  title="Coming soon"
                  className={cn(className, "cursor-not-allowed text-muted-foreground hover:bg-transparent")}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.title}
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={className}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.title}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
