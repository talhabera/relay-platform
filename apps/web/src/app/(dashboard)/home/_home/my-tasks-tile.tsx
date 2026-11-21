import Link from "next/link";

import { CountBadge, StatusChip } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import type { MyTaskRow, MyTasksTileModel } from "./home-model";
import { HomeTile } from "./home-view";

/** Due chip for a row: overdue and today stand out; doing without a date says so. */
function dueChip(row: MyTaskRow) {
  if (row.overdue) return { tone: "error" as const, label: "Overdue" };
  if (row.dueToday) return { tone: "needs-you" as const, label: "Today" };
  if (row.status === "doing") return { tone: "pending" as const, label: "Doing" };
  return null;
}

/**
 * My tasks (issue 08): the viewer's open tasks in this company, at most five,
 * each linking into the Operator Tasks tab. Takes the projected model only.
 */
export function MyTasksTile({ model }: { model: MyTasksTileModel }) {
  const { tasks, openCount } = model;
  return (
    <HomeTile
      slot="my-tasks"
      title="My tasks"
      titleExtra={openCount > 0 ? <CountBadge count={openCount} aria-label={`${openCount} open`} /> : null}
      link={{ href: "/operator?tab=tasks", label: "All tasks" }}
    >
      {tasks.length === 0 ? (
        <p className="type-small text-muted-foreground">No open tasks assigned to you.</p>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((row) => {
            const chip = dueChip(row);
            return (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <Link
                  href={row.href}
                  data-status={row.status}
                  className="flex items-center gap-3 rounded-md py-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate type-body-strong text-foreground">{row.title}</span>
                    {row.dueLabel ? (
                      <span className={cn("truncate type-caption", row.overdue ? "text-destructive" : "text-muted-foreground")}>
                        Due {row.dueLabel}
                      </span>
                    ) : null}
                  </span>
                  {chip ? (
                    <StatusChip tone={chip.tone} className="shrink-0 uppercase">
                      {chip.label}
                    </StatusChip>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </HomeTile>
  );
}
