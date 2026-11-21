import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  bindClickToRecord,
  chats,
  companyRecords,
  db,
  isIntakeComplete,
  isValidAdCode,
  LEAD_KOD_KEY,
  messages,
  missingIntakeFields,
  toE164,
  transitionLeadStatus,
  insertLeadEvent,
  type BindClickToRecordInput,
  type CompanyRecordStatus,
  type LeadReferral,
  type LeadSource,
  type WorkflowIntakeField,
} from "@relay/db";
import { extractKod } from "./extract-kod";

// Inbound intake (lead scoring spec, decisions 9-14): the one write path for
// `record_lead`. A customer agent creates a lead only when it calls the tool;
// nothing else on the customer runtime writes `company_records`, so a support
// chat never becomes a lead. The lead enters at the Qualify stage as
// `gathered` with no fit score: customer agents never score.

export interface RecordLeadScope {
  agentId: string;
  companyId: string;
  chatId: string;
}

export interface RecordLeadInput {
  /** Answers keyed by intake field key. Keys not on the intake are ignored. */
  answers: Record<string, string | undefined>;
  /**
   * Tri-state: `true` rejects a gathered lead, `false` revives a rejected one,
   * omitted keeps the status, so a later partial call cannot un-reject.
   */
  rejected?: boolean;
}

export type RecordLeadResult =
  | { recorded: false; reason: "not_a_prospect" }
  | {
      recorded: true;
      id: string;
      status: CompanyRecordStatus;
      created: boolean;
      intakeComplete: boolean;
      /** Labels of required intake fields still empty. */
      missing: string[];
    };

/** The conversation is not one this agent may attach a lead to. */
export class LeadScopeError extends Error {}

const KOD_ORGANIK = "organik";

/** Chat channel types that produce leads, mapped to `company_records.source`. */
const CHANNEL_SOURCES: Record<string, LeadSource> = {
  whatsapp: "whatsapp",
  instagram: "instagram",
  telegram: "telegram",
  messenger: "messenger",
  widget: "widget",
};

export interface LeadChat {
  id: string;
  channelType: string | null;
  visitorId: string | null;
  title: string | null;
}

export interface StoredLead {
  id: string;
  status: CompanyRecordStatus;
  name: string;
  phone: string | null;
  chatId: string | null;
  payload: Record<string, unknown>;
  referral: LeadReferral | null;
}

export interface NewLead {
  companyId: string;
  sourceAgentId: string;
  name: string;
  payload: Record<string, unknown>;
  source: LeadSource;
  chatId: string;
  phone: string | null;
  referral: LeadReferral | null;
  intakeComplete: boolean;
}

export interface LeadPatch {
  name: string;
  payload: Record<string, unknown>;
  chatId: string;
  phone: string | null;
  referral: LeadReferral | null;
  intakeComplete: boolean;
}

/** Writes inside one transaction that holds the chat (and phone) locks. */
export interface LeadStoreTx {
  findByChat(companyId: string, chatId: string): Promise<StoredLead | null>;
  findByPhone(companyId: string, phone: string): Promise<StoredLead | null>;
  /** Inserts the lead as `gathered` and logs its creation event. */
  insert(lead: NewLead, agentId: string): Promise<StoredLead>;
  update(id: string, companyId: string, patch: LeadPatch): Promise<void>;
  /** Moves the lead only when its status is one of `from`. */
  transition(
    id: string,
    companyId: string,
    from: CompanyRecordStatus[],
    to: CompanyRecordStatus,
    agentId: string,
  ): Promise<boolean>;
  /**
   * Binds the ad click carrying `code` to the lead (`@relay/db`
   * `bindClickToRecord`): false when the code is expired, unknown, already
   * used, or the lead already holds another click.
   */
  bindClickToRecord(input: BindClickToRecordInput): Promise<boolean>;
  /** Runs `fn` in a nested transaction (a savepoint), rolled back if it throws. */
  savepoint<T>(fn: (tx: LeadStoreTx) => Promise<T>): Promise<T>;
}

export interface LeadStore {
  /** The chat, only when it belongs to this company and agent. */
  loadChat(scope: RecordLeadScope): Promise<LeadChat | null>;
  /** The first Click-to-WhatsApp referral carried by an inbound message. */
  firstReferral(chatId: string): Promise<LeadReferral | null>;
  /** The chat's first inbound message text, where a campaign code arrives. */
  firstInboundText(chatId: string): Promise<string | null>;
  withLocks<T>(keys: string[], fn: (tx: LeadStoreTx) => Promise<T>): Promise<T>;
}

function intakeOf(payload: Record<string, unknown>): Record<string, unknown> {
  const intake = payload.intake;
  return intake && typeof intake === "object" && !Array.isArray(intake)
    ? (intake as Record<string, unknown>)
    : {};
}

/** Postgres unique_violation, possibly wrapped by the query layer. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Link the lead's stored campaign code to its ad click. Never fails the lead:
 * an expired, unknown or used code just leaves the click alone (the channel
 * falls back to the code prefix downstream), and `organik` is never looked
 * up. The bind runs in a savepoint so a `23505` from the one-click-per-lead
 * index (two concurrent binds) rolls back only the bind, not the outer
 * transaction holding the lead write; any other error still propagates.
 */
async function bindAdClick(
  tx: LeadStoreTx,
  companyId: string,
  kod: string,
  recordId: string,
): Promise<void> {
  if (kod === KOD_ORGANIK || !isValidAdCode(kod)) return;
  try {
    await tx.savepoint((sp) =>
      sp.bindClickToRecord({ companyId, code: kod, recordId, now: new Date() }),
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

function cleanAnswers(
  intake: readonly WorkflowIntakeField[],
  input: RecordLeadInput,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const field of intake) {
    const value = input.answers[field.key]?.trim();
    if (value) answers[field.key] = value.slice(0, 200);
  }
  return answers;
}

/**
 * Create or update the lead for one conversation.
 *
 * The chat is re-read by id, company and agent together: the widget passes a
 * client-supplied chat id through, so this is the boundary that stops one
 * company's agent writing to another's conversation. Dedupe (decision 13):
 * the lead already on this chat, else the company's lead with the sender's
 * phone, so a known number back on a new conversation updates its lead.
 * Fields not sent keep their stored value. The AI SDK runs a step's tool
 * calls concurrently, so the read-merge-write runs under transaction locks on
 * the chat and the phone.
 */
export async function recordLead(
  store: LeadStore,
  scope: RecordLeadScope,
  intake: readonly WorkflowIntakeField[],
  input: RecordLeadInput,
): Promise<RecordLeadResult> {
  const chat = await store.loadChat(scope);
  if (!chat) {
    throw new LeadScopeError("This conversation does not belong to this agent");
  }
  const source = chat.channelType ? CHANNEL_SOURCES[chat.channelType] : undefined;
  if (!source) {
    throw new LeadScopeError("Conversations on this channel do not create leads");
  }

  // Phone comes from the channel, never from the model (decision 9).
  const phone = source === "whatsapp" ? toE164(chat.visitorId) : null;
  const referral = source === "whatsapp" ? await store.firstReferral(chat.id) : null;
  // The campaign code is read from the first inbound message here, never
  // supplied by the model: a codeless message is organik, and a Meta
  // referral on a codeless message still records the meta channel.
  const firstText = await store.firstInboundText(chat.id);
  const kod = extractKod(firstText ?? "") ?? KOD_ORGANIK;
  const attribution =
    kod === KOD_ORGANIK && referral
      ? {
          channel: "meta",
          via: "referral",
          ...(referral.sourceId ? { sourceId: referral.sourceId } : {}),
        }
      : undefined;
  const answers = cleanAnswers(intake, input);

  const keys = [`lead-chat:${chat.id}`];
  if (phone) keys.push(`lead-phone:${scope.companyId}:${phone}`);

  return store.withLocks(keys, async (tx) => {
    const existing =
      (await tx.findByChat(scope.companyId, chat.id)) ??
      (phone ? await tx.findByPhone(scope.companyId, phone) : null);

    if (!existing) {
      // Judged not a prospect before a lead existed: nothing to record.
      if (input.rejected === true) {
        return { recorded: false, reason: "not_a_prospect" } as const;
      }
      const complete = isIntakeComplete(intake, answers);
      const lead = await tx.insert(
        {
          companyId: scope.companyId,
          sourceAgentId: scope.agentId,
          name: answers.name ?? defaultName(chat, source),
          payload: {
            intake: { ...answers, [LEAD_KOD_KEY]: kod },
            ...(attribution ? { attribution } : {}),
          },
          source,
          chatId: chat.id,
          phone,
          referral,
          intakeComplete: complete,
        },
        scope.agentId,
      );
      await bindAdClick(tx, scope.companyId, kod, lead.id);
      return {
        recorded: true,
        id: lead.id,
        status: lead.status,
        created: true,
        intakeComplete: complete,
        missing: missingIntakeFields(intake, answers),
      } as const;
    }

    // First real code wins: a stored real code is never overwritten or
    // downgraded to organik; an organik (or codeless legacy) lead takes the
    // newly extracted code once.
    const storedKod = intakeOf(existing.payload)[LEAD_KOD_KEY];
    const finalKod =
      typeof storedKod === "string" && storedKod !== KOD_ORGANIK ? storedKod : kod;
    const merged = { ...intakeOf(existing.payload), ...answers, [LEAD_KOD_KEY]: finalKod };
    const payload: Record<string, unknown> = { ...existing.payload, intake: merged };
    if (finalKod === KOD_ORGANIK) {
      if (payload.attribution == null && attribution) payload.attribution = attribution;
    } else {
      delete payload.attribution;
    }
    const complete = isIntakeComplete(intake, merged);
    await tx.update(existing.id, scope.companyId, {
      name: answers.name ?? existing.name,
      payload,
      chatId: chat.id,
      phone: existing.phone ?? phone,
      referral: existing.referral ?? referral,
      intakeComplete: complete,
    });
    await bindAdClick(tx, scope.companyId, finalKod, existing.id);

    // Only a lead still at intake can be rejected or revived by the customer
    // agent: a qualified (billed) lead never changes state here.
    let status = existing.status;
    if (input.rejected === true && status === "gathered") {
      if (await tx.transition(existing.id, scope.companyId, ["gathered"], "rejected", scope.agentId)) {
        status = "rejected";
      }
    } else if (input.rejected === false && status === "rejected") {
      if (await tx.transition(existing.id, scope.companyId, ["rejected"], "gathered", scope.agentId)) {
        status = "gathered";
      }
    }

    return {
      recorded: true,
      id: existing.id,
      status,
      created: false,
      intakeComplete: complete,
      missing: missingIntakeFields(intake, merged),
    } as const;
  });
}

function defaultName(chat: LeadChat, source: LeadSource): string {
  const title = chat.title?.trim();
  if (title && (source === "whatsapp" || source === "instagram")) return title.slice(0, 200);
  return "Lead";
}

// --- Postgres store --------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const LEAD_COLUMNS = {
  id: companyRecords.id,
  status: companyRecords.status,
  name: companyRecords.name,
  phone: companyRecords.phone,
  chatId: companyRecords.chatId,
  payload: companyRecords.payload,
  referral: companyRecords.referral,
} as const;

function pgTx(tx: Tx): LeadStoreTx {
  const findOne = async (where: ReturnType<typeof and>) => {
    const [row] = await tx.select(LEAD_COLUMNS).from(companyRecords).where(where).limit(1);
    return row ?? null;
  };
  return {
    findByChat: (companyId, chatId) =>
      findOne(and(eq(companyRecords.companyId, companyId), eq(companyRecords.chatId, chatId))),
    findByPhone: (companyId, phone) =>
      findOne(and(eq(companyRecords.companyId, companyId), eq(companyRecords.phone, phone))),
    insert: async (lead, agentId) => {
      const [row] = await tx
        .insert(companyRecords)
        .values({ ...lead, entityType: "person", status: "gathered" })
        .returning(LEAD_COLUMNS);
      await insertLeadEvent(tx, {
        companyId: lead.companyId,
        recordId: row.id,
        fromStatus: null,
        toStatus: "gathered",
        actor: { agentId },
      });
      return row;
    },
    update: async (id, companyId, patch) => {
      await tx
        .update(companyRecords)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(companyRecords.id, id), eq(companyRecords.companyId, companyId)));
    },
    transition: async (id, companyId, from, to, agentId) => {
      const result = await transitionLeadStatus(tx, {
        companyId,
        recordId: id,
        toStatus: to,
        actor: { agentId },
        guard: inArray(companyRecords.status, from),
      });
      return result.changed;
    },
    bindClickToRecord: (input) => bindClickToRecord(tx, input),
    savepoint: (fn) => tx.transaction((sp) => fn(pgTx(sp))),
  };
}

export const pgLeadStore: LeadStore = {
  async loadChat(scope) {
    const chat = await db.query.chats.findFirst({
      where: and(
        eq(chats.id, scope.chatId),
        eq(chats.companyId, scope.companyId),
        eq(chats.agentId, scope.agentId),
      ),
    });
    return chat
      ? {
          id: chat.id,
          channelType: chat.channelType,
          visitorId: chat.visitorId,
          title: chat.title,
        }
      : null;
  },
  async firstReferral(chatId) {
    const [row] = await db
      .select({ referral: sql<LeadReferral | null>`${messages.metadata}->'referral'` })
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.role, "user"),
          isNotNull(sql`${messages.metadata}->'referral'`),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(1);
    return row?.referral ?? null;
  },
  async firstInboundText(chatId) {
    const [row] = await db
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.role, "user")))
      .orderBy(asc(messages.createdAt))
      .limit(1);
    return row?.content ?? null;
  },
  withLocks(keys, fn) {
    return db.transaction(async (tx) => {
      // Sorted so two calls never take the same pair in opposite order.
      for (const key of [...keys].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      }
      return fn(pgTx(tx));
    });
  },
};
