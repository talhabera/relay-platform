import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectColumnNames } from "../test-utils/column-names";

const {
  returning,
  whereFn,
  setFn,
  updateFn,
  companyFindFirst,
  channelFindFirst,
  sendMessage,
  pushLimit,
  selectFn,
} = vi.hoisted(() => {
  const pushLimit = vi.fn();
  return {
    returning: vi.fn(),
    whereFn: vi.fn(),
    setFn: vi.fn(),
    updateFn: vi.fn(),
    companyFindFirst: vi.fn(),
    channelFindFirst: vi.fn(),
    sendMessage: vi.fn(),
    pushLimit,
    selectFn: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: pushLimit })) })),
    })),
  };
});

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      update: updateFn,
      select: selectFn,
      query: {
        companies: { findFirst: companyFindFirst },
        channels: { findFirst: channelFindFirst },
      },
    },
  };
});

vi.mock("../integrations/messaging", () => ({
  sendMessage: (...args: unknown[]) => sendMessage(...args),
}));

import { formatLeadNotification, notifyQualifiedLead } from "./notify-lead";

const LEAD = {
  id: "lead-1",
  companyId: "company-1",
  sourceAgentId: "agent-1",
  name: "Ayşe",
  phone: "+905321234567",
  score: 82,
  payload: {
    intake: {
      tip: "mutfak",
      m2: "140",
      lokasyon: "Kadıköy",
      butce: "300-500k",
      iletisim: "dogrulandi",
      kod: "A7F3K",
      skor: 80,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  updateFn.mockReturnValue({ set: setFn });
  setFn.mockReturnValue({ where: whereFn });
  whereFn.mockReturnValue({ returning });
  returning.mockResolvedValue([LEAD]);
  companyFindFirst.mockResolvedValue({ leadNotifyWhatsapp: "+905551234567", ownerId: "owner-1" });
  pushLimit.mockResolvedValue([]);
  channelFindFirst.mockResolvedValue({
    config: { phoneNumberId: "123456789012345", accessToken: "EAAGtoken" },
  });
  sendMessage.mockResolvedValue({ success: true, messageId: "wamid.1", error: null, platform: "whatsapp" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function jsonParamsOf(node: unknown): unknown[] {
  const seen = new Set<unknown>();
  const found: unknown[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string" && value.startsWith("{")) {
      try { found.push(JSON.parse(value)); } catch { /* not JSON */ }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    Object.values(value).forEach(walk);
  };
  walk(node);
  return found;
}

/** The second update is the release: notifiedAt back to null. */
function released() {
  return setFn.mock.calls.some(([values]) => values.notifiedAt === null);
}

describe("notifyQualifiedLead", () => {
  it("sends one message to the company number from the agent's WhatsApp channel", async () => {
    expect(await notifyQualifiedLead("lead-1")).toBe("sent");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [platform, recipient, content, credentials] = sendMessage.mock.calls[0];
    expect(platform).toBe("whatsapp");
    expect(recipient).toBe("905551234567");
    expect(content).toContain("A7F3K");
    expect(credentials).toEqual({ phoneNumberId: "123456789012345", accessToken: "EAAGtoken" });
    expect(released()).toBe(false);
  });

  it("returns push and sends no WhatsApp when the owner has a push subscription", async () => {
    pushLimit.mockResolvedValue([{ id: "sub-1" }]);

    expect(await notifyQualifiedLead("lead-1")).toBe("push");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(released()).toBe(false);
    const payloadSets = setFn.mock.calls
      .map(([values]) => values.payload)
      .filter((payload) => payload !== undefined);
    expect(payloadSets).toHaveLength(1);
    const stamped = jsonParamsOf(payloadSets[0]) as { pushExpectedAt?: string }[];
    expect(stamped.some((p) => typeof p.pushExpectedAt === "string")).toBe(true);
  });

  // Two record_lead calls can both see a qualified lead. Only the UPDATE that
  // still finds notified_at NULL may win, and a mock returns the same row
  // whatever the query says, so the built where is what proves the claim.
  it("claims the notification with id, status and notified_at together", async () => {
    await notifyQualifiedLead("lead-1");

    const columns = collectColumnNames(whereFn.mock.calls[0][0]);
    expect(columns).toEqual(expect.arrayContaining(["id", "status", "notified_at"]));
  });

  it("sends nothing when the claim finds no row (already notified)", async () => {
    returning.mockResolvedValue([]);

    expect(await notifyQualifiedLead("lead-1")).toBe("already-notified");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("releases the claim when the company has no number", async () => {
    companyFindFirst.mockResolvedValue({ leadNotifyWhatsapp: null });

    expect(await notifyQualifiedLead("lead-1")).toBe("no-recipient");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(released()).toBe(true);
  });

  it("releases the claim when the agent has no usable WhatsApp channel", async () => {
    channelFindFirst.mockResolvedValue({ config: { phoneNumberId: "1" } });

    expect(await notifyQualifiedLead("lead-1")).toBe("no-channel");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(released()).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      "[Lead notify] no usable WhatsApp channel",
      "lead-1",
    );
  });

  it("releases the claim when WhatsApp rejects the send", async () => {
    sendMessage.mockResolvedValue({ success: false, messageId: null, error: "window closed", platform: "whatsapp" });

    expect(await notifyQualifiedLead("lead-1")).toBe("failed");
    expect(released()).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      "[Lead notify] send failed",
      "lead-1",
      "window closed",
    );
  });

  it("never throws, even when the send itself throws", async () => {
    sendMessage.mockRejectedValue(new Error("network down"));

    await expect(notifyQualifiedLead("lead-1")).resolves.toBe("failed");
    expect(released()).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      "[Lead notify] unexpected failure",
      "lead-1",
      expect.any(Error),
    );
  });
});

describe("formatLeadNotification", () => {
  it("lists name, phone, the intake answers, kod and the fit score", () => {
    const text = formatLeadNotification(LEAD);

    for (const part of ["Ayşe", "+905321234567", "mutfak", "140", "Kadıköy", "300-500k", "dogrulandi", "A7F3K", "82/100"]) {
      expect(text).toContain(part);
    }
  });

  it("leaves out the migrated skor and an unscored fit score", () => {
    const text = formatLeadNotification({ ...LEAD, score: null });

    expect(text).not.toContain("skor:");
    expect(text).not.toContain("/100");
  });
});
