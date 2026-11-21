import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, updateFn, setFn, whereFn, returning, deliveryLimit, sendWhatsappNotice } =
  vi.hoisted(() => {
    const deliveryLimit = vi.fn();
    return {
      findMany: vi.fn(),
      updateFn: vi.fn(),
      setFn: vi.fn(),
      whereFn: vi.fn(),
      returning: vi.fn(),
      deliveryLimit,
      sendWhatsappNotice: vi.fn(),
    };
  });

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      update: updateFn,
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: deliveryLimit })) })),
      })),
      query: { companyRecords: { findMany } },
    },
  };
});

vi.mock("./notify-lead", () => ({
  sendWhatsappNotice: (...args: unknown[]) => sendWhatsappNotice(...args),
}));

import { sweepUnpushedQualifiedLeads } from "./unpushed-sweep";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function lead(over: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    companyId: "company-1",
    sourceAgentId: "agent-1",
    name: "Ayşe",
    phone: "+905321234567",
    score: 82,
    status: "qualified",
    notifiedAt: minutesAgo(10),
    payload: { pushExpectedAt: minutesAgo(10).toISOString(), intake: {} },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateFn.mockReturnValue({ set: setFn });
  setFn.mockReturnValue({ where: whereFn });
  whereFn.mockReturnValue({ returning });
  returning.mockResolvedValue([{ id: "lead-1" }]);
  deliveryLimit.mockResolvedValue([]);
  findMany.mockResolvedValue([lead()]);
  sendWhatsappNotice.mockResolvedValue("sent");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sweepUnpushedQualifiedLeads", () => {
  it("sends one WhatsApp backup for a push-expected lead with no delivery row", async () => {
    expect(await sweepUnpushedQualifiedLeads(NOW)).toBe(1);
    expect(sendWhatsappNotice).toHaveBeenCalledTimes(1);
    expect(sendWhatsappNotice.mock.calls[0][0]).toMatchObject({ id: "lead-1" });
  });

  it("skips a lead that already has a push delivery", async () => {
    deliveryLimit.mockResolvedValue([{ itemId: "lead:lead-1" }]);
    expect(await sweepUnpushedQualifiedLeads(NOW)).toBe(0);
    expect(sendWhatsappNotice).not.toHaveBeenCalled();
  });

  it("skips a lead younger than 3 minutes (push may still land)", async () => {
    findMany.mockResolvedValue([lead({ notifiedAt: minutesAgo(1) })]);
    expect(await sweepUnpushedQualifiedLeads(NOW)).toBe(0);
    expect(sendWhatsappNotice).not.toHaveBeenCalled();
  });

  it("skips a lead sent by WhatsApp (no pushExpectedAt, no delivery row)", async () => {
    findMany.mockResolvedValue([lead({ payload: { intake: {} } })]);
    expect(await sweepUnpushedQualifiedLeads(NOW)).toBe(0);
    expect(sendWhatsappNotice).not.toHaveBeenCalled();
  });

  it("skips a historical lead older than 24 hours", async () => {
    findMany.mockResolvedValue([lead({ notifiedAt: minutesAgo(25 * 60) })]);
    expect(await sweepUnpushedQualifiedLeads(NOW)).toBe(0);
    expect(sendWhatsappNotice).not.toHaveBeenCalled();
  });

  it("skips a lead already stamped whatsappBackupAt", async () => {
    findMany.mockResolvedValue([
      lead({ payload: { pushExpectedAt: minutesAgo(10).toISOString(), whatsappBackupAt: minutesAgo(5).toISOString() } }),
    ]);
    expect(await sweepUnpushedQualifiedLeads(NOW)).toBe(0);
    expect(sendWhatsappNotice).not.toHaveBeenCalled();
  });

  it("releases the backup stamp when the send fails, so a later tick retries", async () => {
    sendWhatsappNotice.mockResolvedValue("failed");
    expect(await sweepUnpushedQualifiedLeads(NOW)).toBe(0);
    // Stamp update plus its release update.
    expect(updateFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("skips when another tick already claimed the backup stamp", async () => {
    returning.mockResolvedValue([]);
    expect(await sweepUnpushedQualifiedLeads(NOW)).toBe(0);
    expect(sendWhatsappNotice).not.toHaveBeenCalled();
  });
});
