import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { portalEvents, PORTAL_EVENT_TYPES as DB_TYPES } from "@/db/schema";
import { PORTAL_EVENT_TYPES as FIXTURE_TYPES } from "@/lib/fixtures/interfaces";
import {
  emitPortalEvent,
  PortalEventInputError,
  type PortalEventExecutor,
} from "./portal-events";

const COMPANY = "11111111-1111-4111-8111-111111111111";

function fakeExecutor() {
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
  const executor = {
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return {
          returning: async () => [
            {
              id: "evt-1",
              at: new Date("2026-10-03T10:00:00Z"),
              detail: "",
              channel: null,
              refId: null,
              ...values,
            },
          ],
        };
      },
    })),
  };
  return { executor: executor as unknown as PortalEventExecutor, inserted };
}

describe("emitPortalEvent", () => {
  it("appends one row to portal_events and returns it", async () => {
    const { executor, inserted } = fakeExecutor();
    const row = await emitPortalEvent(executor, {
      companyId: COMPANY,
      type: "conversation_started",
      title: "  New WhatsApp conversation  ",
      detail: "Ayse asked about a 3+1",
      channel: "whatsapp",
      refId: "chat-1",
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe(portalEvents);
    expect(inserted[0].values).toEqual({
      companyId: COMPANY,
      type: "conversation_started",
      title: "New WhatsApp conversation",
      detail: "Ayse asked about a 3+1",
      channel: "whatsapp",
      refId: "chat-1",
    });
    expect(row).toMatchObject({ id: "evt-1", type: "conversation_started" });
  });

  it("defaults detail to empty and channel/refId to null", async () => {
    const { executor, inserted } = fakeExecutor();
    await emitPortalEvent(executor, {
      companyId: COMPANY,
      type: "lead_delivered",
      title: "Lead delivered",
    });
    expect(inserted[0].values).toEqual({
      companyId: COMPANY,
      type: "lead_delivered",
      title: "Lead delivered",
      detail: "",
      channel: null,
      refId: null,
    });
  });

  it("passes an explicit timestamp through", async () => {
    const { executor, inserted } = fakeExecutor();
    const at = new Date("2026-10-01T08:30:00Z");
    await emitPortalEvent(executor, {
      companyId: COMPANY,
      type: "handoff_sent",
      title: "Question sent to Mehmet",
      at,
    });
    expect(inserted[0].values.at).toBe(at);
  });

  it("rejects an unknown type or an empty title without writing", async () => {
    const { executor, inserted } = fakeExecutor();
    await expect(
      emitPortalEvent(executor, {
        companyId: COMPANY,
        type: "agent_answered" as never,
        title: "x",
      }),
    ).rejects.toBeInstanceOf(PortalEventInputError);
    await expect(
      emitPortalEvent(executor, {
        companyId: COMPANY,
        type: "lead_inbound_qualified",
        title: "   ",
      }),
    ).rejects.toBeInstanceOf(PortalEventInputError);
    expect(inserted).toHaveLength(0);
  });

  it("keeps the db catalog and the fixture interface in step", () => {
    expect([...DB_TYPES]).toEqual([...FIXTURE_TYPES]);
  });
});
