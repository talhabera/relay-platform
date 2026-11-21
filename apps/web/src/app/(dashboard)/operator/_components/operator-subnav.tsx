import Link from "next/link";

import { cn } from "@/lib/utils";

import type { OperatorTab } from "../_sessions/sessions-list";

const ITEMS = [
  { tab: "overview", label: "Overview", href: "/operator" },
  { tab: "sessions", label: "Sessions", href: "/operator?tab=sessions" },
  { tab: "tasks", label: "Tasks", href: "/operator?tab=tasks" },
  { tab: "cron", label: "Schedules", href: "/operator?tab=cron" },
  { tab: "pipeline", label: "Pipeline", href: "/operator?tab=pipeline" },
] as const satisfies ReadonlyArray<{ tab: OperatorTab; label: string; href: string }>;

/**
 * Figma 05 `operator-subnav` (521:72606): Segmented control styled as links under the
 * App header. Pipeline is a segment too, so the accounts agents save are reachable.
 */
export function OperatorSubnav({ active }: { active: OperatorTab }) {
  return (
    <nav aria-label="Operator" className="pt-4 pb-1">
      <div
        data-slot="operator-subnav"
        className="inline-flex w-fit items-center rounded-full border border-border bg-card p-1"
      >
        {ITEMS.map((item) => {
          const current = item.tab === active;
          return (
            <Link
              key={item.tab}
              href={item.href}
              aria-current={current ? "page" : undefined}
              data-state={current ? "checked" : "unchecked"}
              className={cn(
                "inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 type-body outline-none transition-[color,background-color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50",
                current
                  ? "bg-primary-soft font-medium text-primary-soft-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
