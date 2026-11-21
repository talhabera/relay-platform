import Link from "next/link";

import { cn } from "@/lib/utils";

type AgentKind = "customer" | "operator";

const ITEMS = [
  { kind: "customer", label: "Customer agents", href: "/agents" },
  { kind: "operator", label: "Operator agents", href: "/agents/operator" },
] as const satisfies ReadonlyArray<{ kind: AgentKind; label: string; href: string }>;

/**
 * Figma 07 Customer / Operator segmented (411:27717): Segmented control styled as links,
 * since each kind is its own canvas (agents.kind is immutable; no conversion).
 */
export function AgentsKindNav({ active }: { active: AgentKind }) {
  return (
    <nav aria-label="Agent kind">
      <div
        data-slot="agents-kind-nav"
        className="inline-flex w-fit items-center rounded-full border border-border bg-card p-1"
      >
        {ITEMS.map((item) => {
          const current = item.kind === active;
          return (
            <Link
              key={item.kind}
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
