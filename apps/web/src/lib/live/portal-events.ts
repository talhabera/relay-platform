import { db } from "@/db";
import {
  portalEvents,
  PORTAL_EVENT_TYPES,
  type PortalEventChannel,
  type PortalEventType,
} from "@/db/schema";
import type { InferSelectModel } from "drizzle-orm";

// Writes to the append-only Live feed (spec 2026-10-02-report-snapshots-and-
// live-feed). Each owning session calls `emitPortalEvent` where its event
// happens; pass the surrounding transaction so the row commits with the
// change it describes. There is no update path on purpose.

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PortalEventExecutor = typeof db | Transaction;

export type PortalEventRow = InferSelectModel<typeof portalEvents>;

export type PortalEventInput = {
  companyId: string;
  type: PortalEventType;
  title: string;
  detail?: string;
  channel?: PortalEventChannel | null;
  /** Id of the lead, handoff request or chat behind the event. */
  refId?: string | null;
  /** Defaults to the database `now()`. */
  at?: Date;
};

export class PortalEventInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalEventInputError";
  }
}

const TYPES: ReadonlySet<string> = new Set(PORTAL_EVENT_TYPES);

export async function emitPortalEvent(
  executor: PortalEventExecutor,
  input: PortalEventInput,
): Promise<PortalEventRow> {
  if (!TYPES.has(input.type)) {
    throw new PortalEventInputError(`Unknown portal event type "${input.type}"`);
  }
  const title = input.title.trim();
  if (title === "") {
    throw new PortalEventInputError("A portal event needs a title");
  }

  const [row] = await executor
    .insert(portalEvents)
    .values({
      companyId: input.companyId,
      type: input.type,
      title,
      detail: input.detail?.trim() ?? "",
      channel: input.channel ?? null,
      refId: input.refId ?? null,
      ...(input.at ? { at: input.at } : {}),
    })
    .returning();
  return row;
}
