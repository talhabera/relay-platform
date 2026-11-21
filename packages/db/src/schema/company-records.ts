import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  index,
  uniqueIndex,
  check,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { agents } from "./agents";
import { chats } from "./chats";

/**
 * Record statuses (lead scoring spec). The research and outreach states come
 * from the Revenue flow; the lead states (`gathered` .. `delivered`) are the
 * Lead engine's. "Qualified" means fit score >= 70 (or a borderline lead a
 * person accepted), before outreach; the post-reply status that used to be
 * called `qualified` is `interested` since migration 0032.
 */
export const COMPANY_RECORD_STATUSES = [
  "pending",
  "processing",
  "failed",
  "researched",
  "gathered",
  "qualified",
  "borderline",
  "rejected",
  "outreach_pending",
  "outreach_approved",
  "contacted",
  "replied",
  "interested",
  "meeting",
  "proposal",
  "won",
  "unqualified",
  "delivered",
] as const;

export type CompanyRecordStatus = (typeof COMPANY_RECORD_STATUSES)[number];

/**
 * The Koleva sales funnel, in picker order: yeni, nitelikli, görüşme, teklif,
 * satış, kaybedildi, uygun değil. The other statuses are research and outreach
 * states, not funnel steps.
 */
export const KOLEVA_FUNNEL_STATUSES = [
  "gathered",
  "qualified",
  "meeting",
  "proposal",
  "won",
  "unqualified",
  "rejected",
] as const satisfies readonly CompanyRecordStatus[];

export type KolevaFunnelStatus = (typeof KOLEVA_FUNNEL_STATUSES)[number];

/**
 * The packages a `won` lead can be sold (design 3): `website` is
 * "Talep getiren site", `social` is "Konuşan operasyon Giriş". Mirrored by
 * the `company_records_sale_package_chk` CHECK (migration 0051).
 */
export const SALE_PACKAGES = ["website", "social"] as const;

export type SalePackage = (typeof SALE_PACKAGES)[number];

/**
 * Where a lead came from (decision 13). `telegram` and `messenger` exist
 * because leads migrated from the #18 `leads` table keep their channel type.
 */
export const LEAD_SOURCES = [
  "outbound",
  "whatsapp",
  "instagram",
  "widget",
  "shopify",
  "telegram",
  "messenger",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

/** Click-to-WhatsApp ad attribution carried on the first inbound message. */
export type LeadReferral = {
  sourceId?: string;
  sourceType?: string;
  sourceUrl?: string;
  headline?: string;
  body?: string;
  ctwaClid?: string;
};

export const companyRecords = pgTable(
  "company_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceAgentId: uuid("source_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    entityType: text("entity_type", {
      enum: ["account", "person"],
    }).notNull(),
    name: text("name").notNull(),
    domain: text("domain"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Fit score 0-100; null until the qualify agent scores the lead. */
    score: integer("score"),
    status: text("status", { enum: COMPANY_RECORD_STATUSES })
      .notNull()
      .default("pending"),
    researchedAt: timestamp("researched_at"),
    nextFollowUpAt: timestamp("next_follow_up_at"),
    researchAttemptCount: integer("research_attempt_count").notNull().default(0),
    researchLastError: text("research_last_error"),
    researchLockedAt: timestamp("research_locked_at"),
    /** E.164 (decision 13). Dedupe key per company, like `domain`. */
    phone: text("phone"),
    source: text("source", { enum: LEAD_SOURCES }),
    /** The customer conversation that produced the lead. */
    chatId: uuid("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    referral: jsonb("referral").$type<LeadReferral>(),
    /** 1-3 short free-text fit reasons (the Lead row "why" chips). */
    fitReasons: jsonb("fit_reasons").$type<string[]>().notNull().default([]),
    /** Exactly one when the fit score is under 50. */
    rejectReason: text("reject_reason"),
    /** Every required intake field is filled (decision 11). */
    intakeComplete: boolean("intake_complete").notNull().default(false),
    firstDeliveredAt: timestamp("first_delivered_at"),
    /** Claim for the qualified-lead WhatsApp notification (decision 16). */
    notifiedAt: timestamp("notified_at"),
    /** What was sold; required once the status is `won`. */
    salePackage: text("sale_package", { enum: SALE_PACKAGES }),
    /**
     * Sale amount in TRY minor units (kuruş, 1 TL = 100), VAT excluded (KDV
     * hariç). Integer, never a float; positive once the status is `won`.
     */
    saleAmountMinor: integer("sale_amount_minor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("company_records_company_id_idx").on(table.companyId),
    index("company_records_company_id_next_follow_up_at_idx").on(
      table.companyId,
      table.nextFollowUpAt,
    ),
    index("company_records_company_id_status_idx").on(
      table.companyId,
      table.status,
    ),
    uniqueIndex("company_records_company_domain_uidx")
      .on(table.companyId, table.domain)
      .where(sql`${table.domain} is not null`),
    uniqueIndex("company_records_company_phone_uidx")
      .on(table.companyId, table.phone)
      .where(sql`${table.phone} is not null`),
    uniqueIndex("company_records_chat_id_uidx")
      .on(table.chatId)
      .where(sql`${table.chatId} is not null`),
    check(
      "company_records_score_chk",
      sql`score IS NULL OR (score >= 0 AND score <= 100)`,
    ),
    check(
      "company_records_sale_package_chk",
      sql`sale_package IS NULL OR sale_package IN ('website','social')`,
    ),
    // Only a person marks a sale: a won row needs a package and an amount.
    check(
      "company_records_won_sale_chk",
      sql`status <> 'won' OR (sale_package IS NOT NULL AND sale_amount_minor IS NOT NULL AND sale_amount_minor > 0)`,
    ),
  ],
);
