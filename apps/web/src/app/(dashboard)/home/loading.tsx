import { Skeleton } from "@/components/ui/skeleton";

import { tileClass } from "./_home/home-view";

function RowSkeletons({ count, trailing }: { count: number; trailing?: boolean }) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          {trailing ? <Skeleton className="h-6 w-14 shrink-0" /> : null}
        </div>
      ))}
    </div>
  );
}

function SideTile({ title, rows, trailing }: { title: string; rows: number; trailing?: boolean }) {
  return (
    <section aria-busy="true" className={`${tileClass} gap-2 p-4`}>
      <h2 className="type-h3 text-foreground">{title}</h2>
      <RowSkeletons count={rows} trailing={trailing} />
    </section>
  );
}

const GOAL_LABELS = ["Qualified leads delivered", "Lead quality score", "Cost per qualified lead"];

/** Figma 04 `home/loading`: tile frames with skeleton rows while Home loads. */
export default function HomeLoading() {
  return (
    <div data-slot="home" data-state="loading" className="flex flex-col gap-6 pt-2 pb-6 lg:flex-row lg:items-start">
      <span className="sr-only" role="status">
        Loading Home
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex flex-col gap-4 md:flex-row">
          {GOAL_LABELS.map((label) => (
            <div key={label} className={`${tileClass} flex-1 gap-2 rounded-xl p-4`}>
              <span className="type-label text-muted-foreground uppercase">{label}</span>
              <Skeleton className="h-8 w-full" />
              <span className="type-caption text-muted-foreground">Loading…</span>
            </div>
          ))}
        </div>
        <div className={`${tileClass} h-100 gap-4 p-4`}>
          <Skeleton className="h-5 w-32" />
          <div className="grid flex-1 grid-cols-3 gap-6">
            <Skeleton className="h-full" />
            <Skeleton className="h-full" />
            <Skeleton className="h-full" />
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-4 lg:w-100 lg:shrink-0">
        <SideTile title="Needs you" rows={3} />
        <SideTile title="Today" rows={3} trailing />
        <SideTile title="Lead engine · this week" rows={3} trailing />
      </div>
    </div>
  );
}
