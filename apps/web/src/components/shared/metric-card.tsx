import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type MetricCardProps = {
  label: string;
  /** null or undefined renders the empty state (em dash + no-data line). */
  value?: string | null;
  description?: string;
  /** Colors the description as a delta: up = approved, down = rejected status tokens. */
  trend?: "up" | "down";
  loading?: boolean;
  emptyText?: string;
  className?: string;
};

/** Figma Metric card (17:403): state = value | up | down | loading | empty. */
export function MetricCard({
  label,
  value,
  description,
  trend,
  loading = false,
  emptyText = "No data for this range yet",
  className,
}: MetricCardProps) {
  const empty = !loading && (value === null || value === undefined);
  const state = loading ? "loading" : empty ? "empty" : (trend ?? "value");

  return (
    <div
      data-slot="metric-card"
      data-state={state}
      className={cn(
        "bg-card text-card-foreground shadow-elevation-1 flex h-30 min-w-0 flex-col items-start justify-between gap-2 rounded-xl border p-5",
        className,
      )}
    >
      <p data-slot="metric-card-label" className="type-label text-muted-foreground truncate">
        {label}
      </p>
      {loading ? (
        <>
          <Skeleton variant="block" className="w-full" />
          <p data-slot="metric-card-description" className="type-caption text-muted-foreground">
            Loading…
          </p>
        </>
      ) : (
        <>
          <p data-slot="metric-card-value" className="type-metric text-card-foreground tabular-nums">
            {empty ? "—" : value}
          </p>
          <p
            data-slot="metric-card-description"
            className={cn(
              "type-caption truncate",
              state === "up"
                ? "text-status-approved-foreground"
                : state === "down"
                  ? "text-status-rejected-foreground"
                  : "text-muted-foreground",
            )}
          >
            {empty ? emptyText : description}
          </p>
        </>
      )}
    </div>
  );
}
