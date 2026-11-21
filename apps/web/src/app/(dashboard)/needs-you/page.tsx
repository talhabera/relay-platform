import Link from "next/link";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { listAccessibleCompanies, resolveActiveCompanyId } from "@/lib/operator/companies";
import { getNeedsYou, type NeedsYouItem } from "@/lib/operator/needs-you";
import {
  filterNeedsYou,
  needsYouFacets,
  needsYouImpactCopy,
  needsYouLiveCheckpoint,
  needsYouOpenLabel,
  needsYouPageHref,
  needsYouStatus,
  NEEDS_YOU_KIND_FILTERS,
  NEEDS_YOU_KIND_LABEL,
  parseNeedsYouFilter,
  toNeedsYouRow,
  type NeedsYouFilter,
  type NeedsYouKindFilter,
} from "@/lib/operator/needs-you-view";
import { buttonVariants } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  AgentChip,
  chipVariants,
  CountBadge,
  Icon,
  iconButtonVariants,
  StatusChip,
  type IconName,
} from "@/components/v2/primitives";
import { NoCompanyState, SystemStateFrame } from "@/components/v2/shell";
import { NeedsYouRow } from "@/components/v2/work";
import { NeedsYouCheckpoint } from "@/components/operator/checkpoint-block";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<NeedsYouKindFilter, IconName | undefined> = {
  all: undefined,
  checkpoint: "flag",
  question: "message-square",
  "failed-run": "triangle-alert",
};

function FilterChip({
  href,
  selected,
  icon,
  children,
}: {
  href: string;
  selected: boolean;
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      data-slot="chip"
      data-variant={selected ? "selected" : "default"}
      className={cn(chipVariants({ variant: selected ? "selected" : "default", size: "md" }), "shrink-0")}
    >
      {icon ? <Icon name={icon} size={16} className={selected ? "text-primary" : undefined} /> : null}
      {children}
    </Link>
  );
}

function updatedLabel(now: Date): string {
  return `Updated ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Figma 06 `06/needs-you/list`: filters, the ordered list and the selected item. */
export default async function NeedsYouPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; workflow?: string; item?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);
  const companies = await listAccessibleCompanies(session.user.id);
  const activeCompanyId = resolveActiveCompanyId(prefs?.activeCompanyId, companies);
  const company = companies.find((c) => c.id === activeCompanyId);
  if (!company) {
    const isOwner = companies.some((c) => c.ownerId === session.user.id);
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={isOwner} />
      </SystemStateFrame>
    );
  }

  // Membership is enough (same as the bell API): checkpoints are already
  // filtered to the agents this viewer may approve.
  const list = await getNeedsYou({
    companyId: company.id,
    viewerId: session.user.id,
    ownerId: company.ownerId,
  });

  const filter = parseNeedsYouFilter(params);
  const facets = needsYouFacets(list.items, filter);
  const items = filterNeedsYou(list.items, filter);
  const selected = items.find((i) => i.id === params.item) ?? items[0] ?? null;
  const now = new Date();
  const withFilter = (change: Partial<NeedsYouFilter>) => needsYouPageHref({ ...filter, ...change });

  return (
    <div data-slot="needs-you-page" className="flex min-h-0 flex-col gap-4 px-4 pt-2 pb-6 sm:px-6">
      <div className="flex items-center gap-4">
        <Link href="/operator" aria-label="Back to Operator" className={iconButtonVariants({ variant: "outline", size: "md" })}>
          <Icon name="arrow-left" size={20} />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/operator">Operator</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Needs you</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-center gap-3">
            <h1 className="type-h2 text-foreground">Needs you</h1>
            {list.total > 0 ? <CountBadge tone="warning" count={list.total} aria-label={`${list.total} open`} /> : null}
          </div>
          <p className="type-small text-muted-foreground">
            {company.name} · Checkpoints, questions and failed runs, ordered by impact on qualified leads
          </p>
        </div>
        <div
          aria-label="Sort"
          className="hidden h-10 w-70 shrink-0 items-center justify-between rounded-lg border border-border px-3 type-small text-foreground md:flex"
        >
          Sort: impact on qualified leads
          <Icon name="chevron-down" size={16} className="text-muted-foreground" />
        </div>
      </div>

      <nav aria-label="Filter Needs you" className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <span className="shrink-0 type-label text-muted-foreground uppercase">Kind</span>
        {NEEDS_YOU_KIND_FILTERS.map((kind) => (
          <FilterChip key={kind} href={withFilter({ kind })} selected={filter.kind === kind} icon={KIND_ICON[kind]}>
            {NEEDS_YOU_KIND_LABEL[kind]} · {facets.kind[kind]}
          </FilterChip>
        ))}
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
        <span className="shrink-0 type-label text-muted-foreground uppercase">Workflow</span>
        <FilterChip href={withFilter({ workflow: null })} selected={filter.workflow === null}>
          All workflows
        </FilterChip>
        {facets.workflows.map((w) => (
          <FilterChip key={w.name} href={withFilter({ workflow: w.name })} selected={filter.workflow === w.name} icon="workflow">
            {w.name} · {w.count}
          </FilterChip>
        ))}
      </nav>

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[520px_minmax(0,1fr)]">
        <section aria-label="Needs you items" className="flex flex-col rounded-2xl border border-border bg-card p-2 shadow-elevation-1">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="type-label text-muted-foreground uppercase">{items.length} open · Highest impact first</span>
            <span className="type-caption text-muted-foreground">{updatedLabel(now)}</span>
          </div>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Icon name="circle-check" size={24} />
              </span>
              <p className="type-body-strong text-foreground">
                {list.total === 0 ? "You're all caught up" : "Nothing matches these filters"}
              </p>
              <p className="max-w-75 type-small text-muted-foreground">
                {list.total === 0
                  ? "Checkpoints, questions and failed runs show up here, ordered by impact on qualified leads."
                  : "Clear a filter to see the rest of the list."}
              </p>
            </div>
          ) : (
            items.map((item) => {
              const { id, ...row } = toNeedsYouRow(item, now);
              return (
                <NeedsYouRow
                  key={id}
                  {...row}
                  selected={selected?.id === id}
                  titleHref={needsYouPageHref(filter, id)}
                />
              );
            })
          )}
        </section>

        {selected ? <NeedsYouDetail item={selected} now={now} /> : null}
      </div>
    </div>
  );
}

function NeedsYouDetail({ item, now }: { item: NeedsYouItem; now: Date }) {
  const status = needsYouStatus(item);
  const row = toNeedsYouRow(item, now);
  const customer = item.href.startsWith("/messaging");
  // Listed checkpoints are already only the ones this viewer can approve.
  const live = needsYouLiveCheckpoint(item);
  return (
    <section
      aria-label="Selected item"
      data-slot="needs-you-detail"
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-elevation-1"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="type-caption text-muted-foreground">
            {item.workflow ? `Workflows / ${item.workflow}` : "Operator"}
          </span>
          <h2 className="type-h3 text-foreground">{item.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <AgentChip kind={customer ? "customer" : "operator"} name={item.agentName} />
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <span className="type-caption text-muted-foreground">{row.age}</span>
          </div>
        </div>
        <Link href={item.href} className={buttonVariants({ variant: "outline" })}>
          <Icon name="external-link" size={16} />
          {needsYouOpenLabel(item.href)}
        </Link>
      </div>
      <div aria-hidden className="h-px w-full bg-border" />
      {live ? (
        <NeedsYouCheckpoint key={live.checkpointId} chatId={live.chatId} checkpointId={live.checkpointId} />
      ) : null}
      {item.type === "failed_run" && item.error ? (
        <div className="flex flex-col gap-1">
          <span className="type-label text-muted-foreground uppercase">Error</span>
          <p className="type-small break-words text-foreground">{item.error}</p>
        </div>
      ) : null}
      <div className="flex items-start gap-3 rounded-xl bg-muted px-4 py-3">
        <Icon name="target" size={20} className="mt-0.5 shrink-0 text-primary" />
        <div className="flex flex-col gap-1">
          <span className="type-label text-muted-foreground uppercase">Impact</span>
          <p className="type-small text-foreground">{needsYouImpactCopy(item.tier)}</p>
        </div>
      </div>
    </section>
  );
}
