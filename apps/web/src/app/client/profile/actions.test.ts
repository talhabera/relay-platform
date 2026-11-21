import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Array<{ set: unknown }> = [];

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (set: unknown) => ({
        where: async () => {
          updates.push({ set });
        },
      }),
    }),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u-markus" } })) }));
vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));

import { requireClientAccess } from "@/lib/operator/access";

import { markNotificationsSeen, saveWhatsappNumber, setReportEmails } from "./actions";

const COMPANY = "8d3c0b5e-1f2a-4c3d-9e8f-0a1b2c3d4e5f";

beforeEach(() => {
  updates.length = 0;
  vi.mocked(requireClientAccess).mockReset();
});

describe("saveWhatsappNumber", () => {
  it("stores E.164", async () => {
    expect(await saveWhatsappNumber("+49 151 2345 6789")).toEqual({ ok: true, value: "+4915123456789" });
    expect(updates[0].set).toMatchObject({ whatsappNumber: "+4915123456789" });
  });

  it("refuses a number without a country code and writes nothing", async () => {
    const result = await saveWhatsappNumber("0151 2345 6789");
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("setReportEmails", () => {
  it("stores the opt-out as the inverse of the toggle, as a portal mutation", async () => {
    vi.mocked(requireClientAccess).mockResolvedValue({ session: { user: { id: "u-markus" } }, role: "client" } as never);
    await setReportEmails(COMPANY, false);
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY, { mutation: true });
    expect(updates[0].set).toEqual({ reportEmailOptOut: true });
  });

  it("refuses the read-only preview", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new Error("Unauthorized: The client portal preview is read-only"));
    await expect(setReportEmails(COMPANY, true)).rejects.toThrow(/read-only/);
    expect(updates).toHaveLength(0);
  });
});

describe("markNotificationsSeen", () => {
  it("is a no-op for the owner / member preview", async () => {
    vi.mocked(requireClientAccess).mockResolvedValue({ session: { user: { id: "u-owner" } }, role: "owner" } as never);
    await markNotificationsSeen(COMPANY);
    expect(updates).toHaveLength(0);
  });

  it("stamps the client's membership row", async () => {
    vi.mocked(requireClientAccess).mockResolvedValue({ session: { user: { id: "u-markus" } }, role: "client" } as never);
    await markNotificationsSeen(COMPANY);
    expect(updates[0].set).toMatchObject({ notificationsSeenAt: expect.any(Date) });
  });
});
