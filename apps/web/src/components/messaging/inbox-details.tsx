import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BrandGlyph } from "@/components/v2/primitives/brand-glyph";
import { Icon, type IconName } from "@/components/v2/primitives/icon";
import { ScoreRing } from "@/components/v2/primitives/score-ring";
import { StatusChip } from "@/components/v2/primitives/status-chip";
import { cn } from "@/lib/utils";
import type { InboxDetail } from "@/app/(dashboard)/messaging/inbox-data";

import { SOURCE_BRAND } from "./inbox-model";

const cardClass = "flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-elevation-1";

function DetailRow({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="flex w-26 shrink-0 items-center gap-2 type-small text-muted-foreground">
        <Icon name={icon} size={16} />
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2 truncate type-body text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Figma 08a details column: Details, Inbound lead (when the conversation
 * produced a lead) and Human handoff (escalated conversations). The Sentiment
 * card and the Language row have no data source yet, so they stay hidden.
 */
export function InboxDetails({
  className,
  conversation,
  canOpenAgents,
}: {
  className?: string;
  conversation: InboxDetail;
  canOpenAgents: boolean;
}) {
  const { details, lead, handoff } = conversation;
  return (
    <aside aria-label="Conversation details" data-slot="inbox-details" className={cn("flex min-h-0 flex-col gap-4 overflow-y-auto", className)}>
      <section className={cardClass}>
        <h2 className="type-h3 text-foreground">Details</h2>
        <dl className="flex flex-col gap-3">
          <DetailRow icon="user" label="Customer">
            <span className="truncate">{details.customer}</span>
          </DetailRow>
          <DetailRow icon="globe" label="Source">
            <BrandGlyph brand={SOURCE_BRAND[conversation.source]} size={16} />
            <span className="truncate">{details.source}</span>
          </DetailRow>
          {details.agent ? (
            <DetailRow icon="bot" label="Agent">
              <span className="truncate">{details.agent}</span>
            </DetailRow>
          ) : null}
          <DetailRow icon="calendar" label="Started">
            {details.started}
          </DetailRow>
          <DetailRow icon="clock" label="Duration">
            {details.duration}
          </DetailRow>
        </dl>
      </section>

      {lead ? (
        <section className={cardClass} data-slot="inbox-lead-card">
          <div className="flex items-center gap-2">
            <Icon name="target" size={20} className="text-primary" />
            <h2 className="min-w-0 flex-1 truncate type-h3 text-foreground">Inbound lead</h2>
            <StatusChip tone={lead.chip.tone}>{lead.chip.label}</StatusChip>
          </div>
          <p className="type-small text-muted-foreground">{lead.note}</p>
          <div className="flex items-center gap-3">
            {lead.score !== null ? <ScoreRing value={lead.score} /> : null}
            <div className="flex min-w-0 flex-col">
              <span className="truncate type-body-strong text-foreground">{lead.name}</span>
              {lead.line ? <span className="truncate type-small text-muted-foreground">{lead.line}</span> : null}
            </div>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href="/operator">Open in Operator</Link>
          </Button>
        </section>
      ) : null}

      {handoff ? (
        <section className={cardClass} data-slot="inbox-handoff-card">
          <div className="flex items-center gap-2">
            <Icon name="hand-helping" size={20} className="text-primary" />
            <h2 className="min-w-0 flex-1 truncate type-h3 text-foreground">Human handoff</h2>
            <StatusChip tone={handoff.chip.tone}>{handoff.chip.label}</StatusChip>
          </div>
          <p className="type-small text-muted-foreground">{handoff.narrative}</p>
          {canOpenAgents && conversation.agentId ? (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/agents/${conversation.agentId}`}>Open handoff settings</Link>
            </Button>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}
