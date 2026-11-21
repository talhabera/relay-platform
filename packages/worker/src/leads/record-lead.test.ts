import { describe, expect, it } from "vitest";
import {
  LEGACY_INBOUND_INTAKE,
  type BindClickToRecordInput,
  type CompanyRecordStatus,
} from "@relay/db";
import {
  LeadScopeError,
  recordLead,
  type LeadChat,
  type LeadStore,
  type LeadStoreTx,
  type NewLead,
  type StoredLead,
} from "./record-lead";

type Row = StoredLead & {
  companyId: string;
  sourceAgentId: string;
  source: string;
  intakeComplete: boolean;
};

type Click = {
  companyId: string;
  code: string;
  expiresAt: Date;
  linkedRecordId: string | null;
};

type Bind = BindClickToRecordInput & { result: boolean };

/**
 * In-memory store with the same contract as the Postgres one, so the dedupe
 * and merge rules are tested as behaviour rather than as built SQL. Its
 * `bindClickToRecord` mirrors the conditional UPDATE in `@relay/db`, and its
 * `savepoint` restores the clicks when the nested work throws.
 */
function memoryStore(
  chats: Record<string, LeadChat & { companyId: string; agentId: string }>,
  referrals: Record<string, unknown> = {},
  firstTexts: Record<string, string> = {},
  clicks: Click[] = [],
) {
  const rows: Row[] = [];
  const events: { recordId: string; from: CompanyRecordStatus | null; to: CompanyRecordStatus; agentId: string }[] = [];
  const locks: string[][] = [];
  const binds: Bind[] = [];
  const savepoints = { opened: 0, rolledBack: 0 };
  let next = 1;

  const tx: LeadStoreTx = {
    async findByChat(companyId, chatId) {
      return rows.find((r) => r.companyId === companyId && r.chatId === chatId) ?? null;
    },
    async findByPhone(companyId, phone) {
      return rows.find((r) => r.companyId === companyId && r.phone === phone) ?? null;
    },
    async insert(lead: NewLead, agentId) {
      if (lead.phone && rows.some((r) => r.companyId === lead.companyId && r.phone === lead.phone)) {
        throw new Error("company_records_company_phone_uidx");
      }
      const row: Row = {
        id: `lead-${next++}`,
        status: "gathered",
        companyId: lead.companyId,
        sourceAgentId: lead.sourceAgentId,
        source: lead.source,
        name: lead.name,
        phone: lead.phone,
        chatId: lead.chatId,
        payload: lead.payload,
        referral: lead.referral,
        intakeComplete: lead.intakeComplete,
      };
      rows.push(row);
      events.push({ recordId: row.id, from: null, to: "gathered", agentId });
      return { ...row };
    },
    async update(id, companyId, patch) {
      const row = rows.find((r) => r.id === id && r.companyId === companyId);
      if (row) Object.assign(row, patch);
    },
    async transition(id, companyId, from, to, agentId) {
      const row = rows.find((r) => r.id === id && r.companyId === companyId);
      if (!row || !from.includes(row.status)) return false;
      events.push({ recordId: id, from: row.status, to, agentId });
      row.status = to;
      return true;
    },
    async bindClickToRecord(input) {
      const click = clicks.find(
        (c) =>
          c.companyId === input.companyId &&
          c.code === input.code &&
          c.linkedRecordId === null &&
          c.expiresAt > input.now,
      );
      const recordHasClick = clicks.some(
        (c) => c.companyId === input.companyId && c.linkedRecordId === input.recordId,
      );
      const result = Boolean(click) && !recordHasClick;
      if (result) click!.linkedRecordId = input.recordId;
      binds.push({ ...input, result });
      return result;
    },
    async savepoint(fn) {
      savepoints.opened++;
      const snapshot = clicks.map((c) => ({ ...c }));
      try {
        return await fn(tx);
      } catch (error) {
        savepoints.rolledBack++;
        snapshot.forEach((c, i) => Object.assign(clicks[i], c));
        throw error;
      }
    },
  };

  const store: LeadStore = {
    async loadChat(scope) {
      const chat = chats[scope.chatId];
      return chat && chat.companyId === scope.companyId && chat.agentId === scope.agentId
        ? chat
        : null;
    },
    async firstReferral(chatId) {
      return (referrals[chatId] as never) ?? null;
    },
    async firstInboundText(chatId) {
      return firstTexts[chatId] ?? null;
    },
    async withLocks(keys, fn) {
      locks.push(keys);
      return fn(tx);
    },
  };
  return { store, tx, rows, events, locks, clicks, binds, savepoints };
}

const WHATSAPP = (id: string) => ({
  id,
  companyId: "company-1",
  agentId: "agent-1",
  channelType: "whatsapp",
  visitorId: "905321234567",
  title: "Ayşe",
});
const SCOPE = (chatId: string) => ({ agentId: "agent-1", companyId: "company-1", chatId });
const INTAKE = LEGACY_INBOUND_INTAKE;

describe("recordLead", () => {
  it("creates a gathered person lead credited to the agent, phone from the channel", async () => {
    const { store, rows, events, locks } = memoryStore(
      { "chat-1": WHATSAPP("chat-1") },
      { "chat-1": { sourceId: "ad-9", headline: "Mutfak" } },
      { "chat-1": "Merhaba (Kod: A7F3K)" },
    );

    const result = await recordLead(store, SCOPE("chat-1"), INTAKE, {
      answers: { tip: "mutfak", m2: "140" },
    });

    expect(result).toMatchObject({ recorded: true, created: true, status: "gathered", intakeComplete: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceAgentId: "agent-1",
      source: "whatsapp",
      name: "Ayşe",
      phone: "+905321234567",
      chatId: "chat-1",
      referral: { sourceId: "ad-9", headline: "Mutfak" },
      payload: { intake: { tip: "mutfak", m2: "140", kod: "A7F3K" } },
    });
    expect(events).toEqual([{ recordId: "lead-1", from: null, to: "gathered", agentId: "agent-1" }]);
    expect(locks[0]).toEqual(["lead-chat:chat-1", "lead-phone:company-1:+905321234567"]);
  });

  it("merges later answers into the same lead and marks intake complete", async () => {
    const { store, rows } = memoryStore({ "chat-1": WHATSAPP("chat-1") });

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak", m2: "140" } });
    const result = await recordLead(store, SCOPE("chat-1"), INTAKE, {
      answers: { lokasyon: "Kadıköy", butce: "300-500k", iletisim: "dogrulandi" },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({
      intake: {
        tip: "mutfak",
        m2: "140",
        lokasyon: "Kadıköy",
        butce: "300-500k",
        iletisim: "dogrulandi",
        kod: "organik",
      },
    });
    expect(result).toMatchObject({ created: false, intakeComplete: true, missing: [] });
    expect(rows[0].intakeComplete).toBe(true);
  });

  it("updates the known phone's lead when the number comes back on a new conversation", async () => {
    const { store, rows, events } = memoryStore({
      "chat-1": WHATSAPP("chat-1"),
      "chat-2": WHATSAPP("chat-2"),
    });

    const first = await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });
    const second = await recordLead(store, SCOPE("chat-2"), INTAKE, { answers: { m2: "90" } });

    expect(rows).toHaveLength(1);
    expect(second).toMatchObject({ recorded: true, created: false });
    expect(second.recorded && first.recorded && second.id === first.id).toBe(true);
    expect(rows[0].chatId).toBe("chat-2");
    expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", m2: "90", kod: "organik" } });
    expect(events).toHaveLength(1);
  });

  it("does not create a lead when the first call already says not a prospect", async () => {
    const { store, rows } = memoryStore({ "chat-1": WHATSAPP("chat-1") });

    const result = await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: {}, rejected: true });

    expect(result).toEqual({ recorded: false, reason: "not_a_prospect" });
    expect(rows).toHaveLength(0);
  });

  it("rejects and revives a gathered lead, logging each change", async () => {
    const { store, rows, events } = memoryStore({ "chat-1": WHATSAPP("chat-1") });
    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: {}, rejected: true });
    expect(rows[0].status).toBe("rejected");
    // Omitted keeps the rejection.
    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { m2: "90" } });
    expect(rows[0].status).toBe("rejected");
    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: {}, rejected: false });
    expect(rows[0].status).toBe("gathered");
    expect(events.map((e) => e.to)).toEqual(["gathered", "rejected", "gathered"]);
  });

  it("never moves a qualified (billed) lead", async () => {
    const { store, rows, events } = memoryStore({ "chat-1": WHATSAPP("chat-1") });
    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });
    rows[0].status = "qualified";

    const result = await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: {}, rejected: true });

    expect(result).toMatchObject({ status: "qualified" });
    expect(rows[0].status).toBe("qualified");
    expect(events).toHaveLength(1);
  });

  it("ignores answers for keys that are not on the intake", async () => {
    const { store, rows } = memoryStore({ "chat-1": WHATSAPP("chat-1") });

    await recordLead(store, SCOPE("chat-1"), INTAKE, {
      answers: { tip: "mutfak", phone: "+15550000000", skor: "9" },
    });

    expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", kod: "organik" } });
    expect(rows[0].phone).toBe("+905321234567");
  });

  it("names the lead from the intake when the workflow asks for a name", async () => {
    const { store, rows } = memoryStore({
      "chat-1": { ...WHATSAPP("chat-1"), channelType: "widget", visitorId: "visitor-1", title: "hi" },
    });
    const intake = [
      { key: "name", label: "Name", required: true },
      { key: "need", label: "Need", required: true },
    ];

    const result = await recordLead(store, SCOPE("chat-1"), intake, { answers: { name: "Kemal" } });

    expect(rows[0]).toMatchObject({ name: "Kemal", phone: null, source: "widget", referral: null });
    expect(result).toMatchObject({ missing: ["Need"] });
  });

  it("refuses a conversation of another agent or company", async () => {
    const { store } = memoryStore({ "chat-1": WHATSAPP("chat-1") });

    await expect(
      recordLead(store, { ...SCOPE("chat-1"), agentId: "agent-2" }, INTAKE, { answers: {} }),
    ).rejects.toBeInstanceOf(LeadScopeError);
    await expect(
      recordLead(store, { ...SCOPE("chat-1"), companyId: "company-2" }, INTAKE, { answers: {} }),
    ).rejects.toBeInstanceOf(LeadScopeError);
  });

  it("stores the code extracted from the first message, not a model-supplied one", async () => {
    const { store, rows } = memoryStore(
      { "chat-1": WHATSAPP("chat-1") },
      {},
      { "chat-1": "Merhaba, web sitesi için yazıyorum. (Kod: G7KF3)" },
    );

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

    expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", kod: "G7KF3" } });
  });

  it("stores organik with no attribution when the first message has no code and no referral", async () => {
    const { store, rows } = memoryStore(
      { "chat-1": WHATSAPP("chat-1") },
      {},
      { "chat-1": "Merhaba, bilgi almak istiyorum" },
    );

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

    expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", kod: "organik" } });
    expect(rows[0].payload).not.toHaveProperty("attribution");
  });

  it("records the meta channel from the referral when there is no code", async () => {
    const { store, rows } = memoryStore(
      { "chat-1": WHATSAPP("chat-1") },
      { "chat-1": { sourceId: "ad-9", headline: "Mutfak" } },
      { "chat-1": "Merhaba" },
    );

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

    expect(rows[0].payload).toEqual({
      intake: { tip: "mutfak", kod: "organik" },
      attribution: { channel: "meta", via: "referral", sourceId: "ad-9" },
    });
  });

  it("omits sourceId from attribution when the referral has none", async () => {
    const { store, rows } = memoryStore(
      { "chat-1": WHATSAPP("chat-1") },
      { "chat-1": { headline: "Mutfak" } },
      { "chat-1": "Merhaba" },
    );

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

    expect(rows[0].payload).toEqual({
      intake: { tip: "mutfak", kod: "organik" },
      attribution: { channel: "meta", via: "referral" },
    });
  });

  it("stores the code without a channel override when both code and referral are present", async () => {
    const { store, rows } = memoryStore(
      { "chat-1": WHATSAPP("chat-1") },
      { "chat-1": { sourceId: "ad-9" } },
      { "chat-1": "Merhaba (Kod: MWEB1)" },
    );

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

    expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", kod: "MWEB1" } });
    expect(rows[0].payload).not.toHaveProperty("attribution");
  });

  it("keeps the first real code when a later chat carries another code or none", async () => {
    const { store, rows } = memoryStore(
      { "chat-1": WHATSAPP("chat-1"), "chat-2": WHATSAPP("chat-2"), "chat-3": WHATSAPP("chat-3") },
      {},
      {
        "chat-1": "Merhaba (Kod: G7KF3)",
        "chat-2": "Merhaba (Kod: M1234)",
        "chat-3": "Merhaba, yine ben",
      },
    );

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });
    await recordLead(store, SCOPE("chat-2"), INTAKE, { answers: { m2: "90" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", m2: "90", kod: "G7KF3" } });

    await recordLead(store, SCOPE("chat-3"), INTAKE, { answers: { lokasyon: "Kadıköy" } });
    expect(rows[0].payload).toEqual({
      intake: { tip: "mutfak", m2: "90", lokasyon: "Kadıköy", kod: "G7KF3" },
    });
  });

  it("upgrades an organik lead once a real code arrives and drops attribution", async () => {
    const { store, rows } = memoryStore(
      { "chat-1": WHATSAPP("chat-1"), "chat-2": WHATSAPP("chat-2") },
      { "chat-1": { sourceId: "ad-9" } },
      { "chat-1": "Merhaba", "chat-2": "Merhaba (Kod: G7KF3)" },
    );

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });
    expect(rows[0].payload).toEqual({
      intake: { tip: "mutfak", kod: "organik" },
      attribution: { channel: "meta", via: "referral", sourceId: "ad-9" },
    });

    await recordLead(store, SCOPE("chat-2"), INTAKE, { answers: { m2: "90" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", m2: "90", kod: "G7KF3" } });
  });

  it("extracts a code on a widget chat without any referral lookup", async () => {
    const { store, rows } = memoryStore(
      { "chat-1": { ...WHATSAPP("chat-1"), channelType: "widget", visitorId: "visitor-1" } },
      { "chat-1": { sourceId: "ad-9" } },
      { "chat-1": "Merhaba (Kod: G7KF3)" },
    );

    await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

    expect(rows[0]).toMatchObject({ source: "widget", referral: null });
    expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", kod: "G7KF3" } });
  });

  it("refuses a channel that does not produce leads", async () => {
    const { store } = memoryStore({ "chat-1": { ...WHATSAPP("chat-1"), channelType: "web" } });

    await expect(recordLead(store, SCOPE("chat-1"), INTAKE, { answers: {} })).rejects.toBeInstanceOf(
      LeadScopeError,
    );
  });

  describe("ad click binding", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const live = (code: string, linkedRecordId: string | null = null): Click => ({
      companyId: "company-1",
      code,
      expiresAt: new Date(Date.now() + DAY_MS),
      linkedRecordId,
    });
    const expired = (code: string): Click => ({
      ...live(code),
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    it("links an unexpired, unlinked click to the new lead", async () => {
      const clicks = [live("G7KF3")];
      const { store, rows, binds } = memoryStore(
        { "chat-1": WHATSAPP("chat-1") },
        {},
        { "chat-1": "Merhaba (Kod: G7KF3)" },
        clicks,
      );

      await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

      expect(clicks[0].linkedRecordId).toBe(rows[0].id);
      expect(binds).toEqual([
        expect.objectContaining({ companyId: "company-1", code: "G7KF3", recordId: rows[0].id, result: true }),
      ]);
    });

    it("links the click when an organik lead is upgraded to a real code", async () => {
      const clicks = [live("G7KF3")];
      const { store, rows } = memoryStore(
        { "chat-1": WHATSAPP("chat-1"), "chat-2": WHATSAPP("chat-2") },
        {},
        { "chat-1": "Merhaba", "chat-2": "Merhaba (Kod: G7KF3)" },
        clicks,
      );

      await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });
      expect(clicks[0].linkedRecordId).toBeNull();
      await recordLead(store, SCOPE("chat-2"), INTAKE, { answers: { m2: "90" } });

      expect(clicks[0].linkedRecordId).toBe(rows[0].id);
    });

    it.each([
      ["an expired code", "Merhaba (Kod: G7KF3)", [expired("G7KF3")]],
      ["an unknown code", "Merhaba (Kod: G7KF3)", [live("G4BXZ")]],
      ["a code already linked to another record", "Merhaba (Kod: G7KF3)", [live("G7KF3", "lead-other")]],
    ])("leaves the click untouched and still saves the lead on %s", async (_label, text, clicks) => {
      const before = clicks.map((c) => ({ ...c }));
      const { store, rows } = memoryStore({ "chat-1": WHATSAPP("chat-1") }, {}, { "chat-1": text }, clicks);

      const result = await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

      expect(result).toMatchObject({ recorded: true, created: true });
      expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", kod: "G7KF3" } });
      expect(clicks).toEqual(before);
    });

    it("never looks up organik or a code that is not an ad code", async () => {
      const clicks = [live("G7KF3")];
      const { store, binds, savepoints } = memoryStore(
        { "chat-1": WHATSAPP("chat-1"), "chat-2": { ...WHATSAPP("chat-2"), visitorId: "905329999999" } },
        {},
        { "chat-1": "Merhaba", "chat-2": "Merhaba (Kod: A7F3K)" },
        clicks,
      );

      await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });
      await recordLead(store, SCOPE("chat-2"), INTAKE, { answers: { tip: "banyo" } });

      expect(binds).toEqual([]);
      expect(savepoints.opened).toBe(0);
      expect(clicks[0].linkedRecordId).toBeNull();
    });

    it("links exactly one of two concurrent leads quoting the same code", async () => {
      const clicks = [live("G7KF3")];
      const { store, rows, binds } = memoryStore(
        { "chat-1": WHATSAPP("chat-1"), "chat-2": { ...WHATSAPP("chat-2"), visitorId: "905329999999" } },
        {},
        { "chat-1": "Merhaba (Kod: G7KF3)", "chat-2": "Merhaba (Kod: G7KF3)" },
        clicks,
      );

      const results = await Promise.all([
        recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } }),
        recordLead(store, SCOPE("chat-2"), INTAKE, { answers: { tip: "banyo" } }),
      ]);

      expect(results.every((r) => r.recorded)).toBe(true);
      expect(rows).toHaveLength(2);
      expect(binds.filter((b) => b.result)).toHaveLength(1);
      expect(rows.map((r) => r.id)).toContain(clicks[0].linkedRecordId);
    });

    it("keeps the first link when the same record later carries another valid code", async () => {
      const clicks = [live("G7KF3"), live("R4BXZ")];
      const { store, rows, binds } = memoryStore(
        { "chat-1": WHATSAPP("chat-1"), "chat-2": WHATSAPP("chat-2"), "chat-3": WHATSAPP("chat-3") },
        {},
        {
          "chat-1": "Merhaba (Kod: G7KF3)",
          "chat-2": "Merhaba (Kod: R4BXZ)",
          "chat-3": "Merhaba",
        },
        clicks,
      );

      await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });
      // A second call on the same lead (same phone) quoting another code.
      const second = await recordLead(store, SCOPE("chat-2"), INTAKE, { answers: { m2: "90" } });
      // An update that stores another valid code on the already-linked lead.
      (rows[0].payload.intake as Record<string, string>).kod = "R4BXZ";
      const third = await recordLead(store, SCOPE("chat-3"), INTAKE, { answers: { lokasyon: "Kadıköy" } });

      expect(second).toMatchObject({ recorded: true, created: false });
      expect(third).toMatchObject({ recorded: true, created: false });
      expect(rows).toHaveLength(1);
      expect(binds.map((b) => [b.code, b.result])).toEqual([
        ["G7KF3", true],
        ["G7KF3", false],
        ["R4BXZ", false],
      ]);
      expect(clicks[0].linkedRecordId).toBe(rows[0].id);
      expect(clicks[1].linkedRecordId).toBeNull();
      expect(rows[0].payload).toEqual({
        intake: { tip: "mutfak", m2: "90", lokasyon: "Kadıköy", kod: "R4BXZ" },
      });
    });

    it("swallows a 23505 from the bind, rolls back the savepoint and still saves the lead", async () => {
      const clicks = [live("G7KF3")];
      const { store, tx, rows, savepoints } = memoryStore(
        { "chat-1": WHATSAPP("chat-1") },
        {},
        { "chat-1": "Merhaba (Kod: G7KF3)" },
        clicks,
      );
      tx.bindClickToRecord = async (input) => {
        // Writes, then the unique index refuses: the savepoint must undo it.
        clicks[0].linkedRecordId = input.recordId;
        // Shaped like a driver error wrapped by the query layer.
        throw Object.assign(new Error("Failed query"), {
          cause: Object.assign(new Error("duplicate key value"), { code: "23505" }),
        });
      };

      const result = await recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } });

      expect(result).toMatchObject({ recorded: true, created: true });
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ intake: { tip: "mutfak", kod: "G7KF3" } });
      expect(savepoints).toEqual({ opened: 1, rolledBack: 1 });
      expect(clicks[0].linkedRecordId).toBeNull();
    });

    it("propagates any other bind error", async () => {
      const { store, tx } = memoryStore(
        { "chat-1": WHATSAPP("chat-1") },
        {},
        { "chat-1": "Merhaba (Kod: G7KF3)" },
        [live("G7KF3")],
      );
      tx.bindClickToRecord = async () => {
        throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
      };

      await expect(
        recordLead(store, SCOPE("chat-1"), INTAKE, { answers: { tip: "mutfak" } }),
      ).rejects.toThrow("deadlock detected");
    });
  });
});
