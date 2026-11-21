import { beforeEach, describe, expect, it, vi } from "vitest";

// W3GAP item 4: a qualified inbound lead, and an inbound borderline lead a
// person accepts, both end at one pending lead_delivery card. Real scoreLead,
// onLeadAcceptedByPerson and proposeLeadDelivery over an in-memory store; only
// the WhatsApp notification is stubbed.

type Lead = {
  id: string;
  companyId: string;
  name: string;
  phone: string | null;
  status: string;
  source: string | null;
  score: number | null;
  chatId: string | null;
  sourceAgentId: string | null;
  payload: Record<string, unknown>;
};
type Card = Record<string, unknown> & { recordId: string; status: string };

const { store, notifyQualifiedLead } = vi.hoisted(() => ({
  store: { lead: null as Lead | null, cards: [] as Card[] },
  notifyQualifiedLead: vi.fn(async () => "sent"),
}));

vi.mock("./notify-lead", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notify-lead")>()),
  notifyQualifiedLead,
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    // Status writes land on the one lead in the store.
    transitionLeadStatus: vi.fn(
      async (_tx: unknown, input: { toStatus: string; set?: Record<string, unknown> }) => {
        Object.assign(store.lead!, input.set ?? {}, { status: input.toStatus });
        return { changed: true, event: { id: "ev" } };
      },
    ),
    db: {
      query: {
        companyRecords: { findFirst: async () => (store.lead ? { ...store.lead } : undefined) },
        companies: {
          findFirst: async () => ({ id: "co-1", leadNotifyWhatsapp: "+905320000000" }),
        },
      },
      transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ insert: () => ({ values: async () => undefined }) }),
      insert: () => ({
        values: (values: Card) => ({
          // checkpoints_record_pending_uidx
          onConflictDoNothing: () => ({
            returning: async () => {
              const open = store.cards.some(
                (c) => c.recordId === values.recordId && c.status === "pending",
              );
              if (open) return [];
              const card = { ...values, id: `cp-${store.cards.length + 1}` };
              store.cards.push(card);
              return [{ id: card.id }];
            },
          }),
        }),
      }),
    },
  };
});

import { onLeadAcceptedByPerson, scoreLead } from "./score-lead";

function inboundLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    companyId: "co-1",
    name: "Ayse",
    phone: "+905551112233",
    status: "gathered",
    source: "whatsapp",
    score: null,
    chatId: "chat-1",
    sourceAgentId: "ag-customer",
    payload: { intake: { tip: "villa", m2: "140" } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.cards = [];
});

describe("lead flow to a pending lead_delivery card", () => {
  it("a qualified inbound lead from a Qualify run", async () => {
    store.lead = inboundLead();
    const scored = await scoreLead({
      companyId: "co-1",
      agentId: "ag-qualify",
      recordId: "lead-1",
      score: 84,
      reasons: ["budget fits"],
      parent: { cronRunId: "run-1" },
    });

    expect(scored).toMatchObject({ status: "qualified", route: "deliver" });
    expect(notifyQualifiedLead).toHaveBeenCalledWith("lead-1");
    expect(store.cards).toHaveLength(1);
    expect(store.cards[0]).toMatchObject({
      kind: "lead_delivery",
      status: "pending",
      recordId: "lead-1",
      agentId: "ag-qualify",
      cronRunId: "run-1",
      chatId: null,
      payload: {
        kind: "lead_delivery",
        leadId: "lead-1",
        channel: "whatsapp",
        recipient: "+905320000000",
        reason: "Qualified inbound lead, fit 84",
      },
    });
  });

  it("an inbound borderline lead a person accepts", async () => {
    store.lead = inboundLead();
    await scoreLead({
      companyId: "co-1",
      agentId: "ag-qualify",
      recordId: "lead-1",
      score: 61,
      reasons: ["timeline unknown"],
      parent: { cronRunId: "run-1" },
    });
    expect(store.lead.status).toBe("borderline");
    expect(store.cards).toHaveLength(0);

    // acceptBorderlineLead (web) moves it to qualified, then asks the worker.
    store.lead.status = "qualified";
    const accepted = await onLeadAcceptedByPerson("lead-1");

    expect(accepted).toEqual({ notify: "sent", deliveryCheckpointId: "cp-1" });
    expect(store.cards).toHaveLength(1);
    expect(store.cards[0]).toMatchObject({
      kind: "lead_delivery",
      status: "pending",
      recordId: "lead-1",
      agentId: "ag-customer",
      chatId: "chat-1",
      cronRunId: null,
      payload: { leadId: "lead-1", reason: "Qualified inbound lead, fit 61" },
    });
  });

  it("opens one card however often it is asked, and none once delivered", async () => {
    store.lead = inboundLead({ status: "qualified", score: 80 });
    await onLeadAcceptedByPerson("lead-1");
    await onLeadAcceptedByPerson("lead-1");
    expect(store.cards).toHaveLength(1);

    store.cards = [];
    store.lead.status = "delivered";
    await expect(onLeadAcceptedByPerson("lead-1")).resolves.toMatchObject({
      deliveryCheckpointId: null,
    });
    expect(store.cards).toHaveLength(0);
  });

  it("an accepted outbound lead goes to outreach, not delivery", async () => {
    store.lead = inboundLead({ source: "outbound", status: "qualified", chatId: null });
    await onLeadAcceptedByPerson("lead-1");
    expect(store.cards).toHaveLength(0);
  });
});
