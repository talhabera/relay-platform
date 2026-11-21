import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkpointFindFirst,
  recordFindFirst,
  channelFindFirst,
  selectLimit,
  sendMessage,
  store,
  updateSet,
} = vi.hoisted(() => ({
  checkpointFindFirst: vi.fn(),
  recordFindFirst: vi.fn(),
  channelFindFirst: vi.fn(),
  selectLimit: vi.fn(),
  sendMessage: vi.fn(),
  // The card's send_receipt column, as the guarded UPDATEs see it.
  store: { receipt: null as unknown },
  updateSet: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        checkpoints: { findFirst: checkpointFindFirst },
        companyRecords: { findFirst: recordFindFirst },
        channels: { findFirst: channelFindFirst },
      },
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: () => ({ limit: selectLimit }) }),
        }),
      }),
      update: () => ({
        set: (values: { sendReceipt: { state: string } | null }) => ({
          where: () => ({
            returning: async () => {
              updateSet(values);
              const claim = values.sendReceipt?.state === "sending";
              // The claim is guarded on send_receipt IS NULL.
              if (claim && store.receipt !== null) return [];
              store.receipt = values.sendReceipt;
              return [{ id: "cp-1" }];
            },
          }),
        }),
      }),
    },
  };
});

vi.mock("../integrations/messaging", () => ({
  sendMessage: (...args: unknown[]) => sendMessage(...args),
}));

import { deliverLead, parseDeliverLeadBody } from "./deliver-lead";

const creds = { phoneNumberId: "pn-1", accessToken: "tok" };

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: "cp-1",
    companyId: "co-1",
    status: "approved",
    payload: {
      kind: "lead_delivery",
      leadId: "lead-1",
      channel: "whatsapp",
      recipient: "+905551112233",
      summary: "Ayse, villa, Kadikoy",
      reason: "fit 82",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.receipt = null;
  checkpointFindFirst.mockImplementation(async () => card({ sendReceipt: store.receipt }));
  recordFindFirst.mockResolvedValue({
    id: "lead-1",
    companyId: "co-1",
    sourceAgentId: "agent-1",
    status: "qualified",
  });
  channelFindFirst.mockResolvedValue({ config: creds });
  selectLimit.mockResolvedValue([]);
  sendMessage.mockResolvedValue({ success: true, messageId: "wamid-1", error: null });
});

describe("parseDeliverLeadBody", () => {
  it("needs a checkpoint id", () => {
    expect(parseDeliverLeadBody({ checkpointId: "cp-1" })).toEqual({ checkpointId: "cp-1" });
    expect(parseDeliverLeadBody({})).toBeNull();
    expect(parseDeliverLeadBody(null)).toBeNull();
  });
});

describe("deliverLead", () => {
  it("sends the summary on WhatsApp through the lead's agent channel", async () => {
    await expect(deliverLead("cp-1")).resolves.toEqual({
      ok: true,
      result: {
        mode: "sent",
        channel: "whatsapp",
        recipient: "+905551112233",
        messageId: "wamid-1",
      },
    });
    expect(sendMessage).toHaveBeenCalledWith(
      "whatsapp",
      "905551112233",
      "Ayse, villa, Kadikoy",
      creds,
    );
  });

  it("falls back to any active WhatsApp channel of the company", async () => {
    channelFindFirst.mockResolvedValue(undefined);
    selectLimit.mockResolvedValue([{ config: creds }]);
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: true });
  });

  it("refuses a card web has not approved", async () => {
    checkpointFindFirst.mockResolvedValue(card({ status: "pending" }));
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: false, status: 409 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("refuses other kinds and unknown cards", async () => {
    checkpointFindFirst.mockResolvedValue(card({ payload: { kind: "post" } }));
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: false, status: 400 });
    checkpointFindFirst.mockResolvedValue(undefined);
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: false, status: 404 });
  });

  it("reports channels without a connector and missing numbers", async () => {
    checkpointFindFirst.mockResolvedValue(
      card({ payload: { ...card().payload, channel: "email" } }),
    );
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: false, status: 422 });

    checkpointFindFirst.mockImplementation(async () => card({ sendReceipt: store.receipt }));
    channelFindFirst.mockResolvedValue(undefined);
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: false, status: 422 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("reports a failed send", async () => {
    sendMessage.mockResolvedValue({ success: false, messageId: null, error: "rate limited" });
    await expect(deliverLead("cp-1")).resolves.toEqual({
      ok: false,
      status: 502,
      error: "rate limited",
    });
  });

  it("leaves no marker after a failed send, so Retry can send", async () => {
    sendMessage.mockResolvedValueOnce({ success: false, messageId: null, error: "down" });
    await deliverLead("cp-1");
    expect(store.receipt).toBeNull();
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  // Item 5: a stuck-approved Retry (or a persist Retry) calls again after the
  // first send went out; the client must get the lead once.
  it("sends once per card and returns the earlier result on a repeat", async () => {
    const first = await deliverLead("cp-1");
    const second = await deliverLead("cp-1");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(store.receipt).toMatchObject({ state: "sent", result: { messageId: "wamid-1" } });
  });

  it("claims the marker before sending", async () => {
    sendMessage.mockImplementationOnce(async () => {
      expect(store.receipt).toMatchObject({ state: "sending" });
      return { success: true, messageId: "wamid-1", error: null };
    });
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: true });
  });

  it("never sends while an earlier attempt holds the marker", async () => {
    store.receipt = { state: "sending", at: "2026-10-03T00:00:00.000Z" };
    await expect(deliverLead("cp-1")).resolves.toMatchObject({ ok: false, status: 409 });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // Item 7: only a qualified (or interested) lead reaches the client.
  it.each(["rejected", "gathered", "borderline"])(
    "refuses a %s lead before sending",
    async (status) => {
      recordFindFirst.mockResolvedValue({
        id: "lead-1",
        companyId: "co-1",
        sourceAgentId: "agent-1",
        status,
      });
      const out = await deliverLead("cp-1");
      expect(out).toMatchObject({ ok: false, status: 422 });
      expect(out.ok ? "" : out.error).toContain(status);
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );
});
