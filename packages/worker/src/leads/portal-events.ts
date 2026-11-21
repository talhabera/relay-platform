import {
  portalEvents,
  PORTAL_EVENT_CHANNELS,
  type LeadEventExecutor,
  type PortalEventChannel,
} from "@relay/db";

// Worker-side writer for the Live feed `lead_inbound_qualified` row (spec
// 2026-10-02-report-snapshots-and-live-feed). Same row shape as the web's
// `emitPortalEvent` (`apps/web/src/lib/live/portal-events.ts`), which the
// worker cannot import. Pass the transaction of the status change.

function channelOf(source: string | null): PortalEventChannel | null {
  return (PORTAL_EVENT_CHANNELS as readonly string[]).includes(source ?? "")
    ? (source as PortalEventChannel)
    : null;
}

export async function emitInboundQualified(
  executor: LeadEventExecutor,
  lead: { id: string; companyId: string; name: string | null; source: string | null; at?: Date },
): Promise<void> {
  await executor.insert(portalEvents).values({
    companyId: lead.companyId,
    type: "lead_inbound_qualified",
    title: (lead.name ?? "").trim() || "Lead",
    detail: "Qualified inbound lead",
    channel: channelOf(lead.source),
    refId: lead.id,
    ...(lead.at ? { at: lead.at } : {}),
  });
}
