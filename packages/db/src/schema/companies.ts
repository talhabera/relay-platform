import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  bigint,
  index,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    industry: text("industry"),
    description: text("description"),
    widgetId: text("widget_id").unique(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Company rate-limit settings: policy name to limit. Only keys missing
     * from here fall back to platform defaults. Always read through
     * `sanitizeCompanyOverrides` (`@relay/db/rate-limit`), which drops unknown
     * policies and clamps to each ceiling.
     */
    rateLimits: jsonb("rate_limits")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    /**
     * WhatsApp number (E.164, e.g. +905551234567) that receives one message
     * when a lead becomes qualified. Null means notifications are off.
     */
    leadNotifyWhatsapp: text("lead_notify_whatsapp"),
    /**
     * IANA timezone (e.g. Europe/Istanbul) the company's weeks, report periods
     * and default Schedule times are read in. Set from the owner's browser at
     * package install; `UTC` until then.
     */
    timezone: text("timezone").notNull().default("UTC"),
    /**
     * Ad settings (owner-editable, migration 0052). Money is kuruş (TRY
     * minor units); null means unset, which consumers treat as "no rule".
     * Capacities are won deals the team can take per calendar month for the
     * site package and the social package; 0 means no new deals.
     */
    adMonthlyTargetMinor: bigint("ad_monthly_target_minor", {
      mode: "number",
    }),
    adCplStopMinor: bigint("ad_cpl_stop_minor", { mode: "number" }),
    adDailyCapMinor: bigint("ad_daily_cap_minor", { mode: "number" }),
    adCapacitySiteMonthly: integer("ad_capacity_site_monthly"),
    adCapacitySocialMonthly: integer("ad_capacity_social_monthly"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("companies_owner_id_idx").on(table.ownerId),
    check(
      "companies_ad_monthly_target_minor_chk",
      sql`ad_monthly_target_minor IS NULL OR ad_monthly_target_minor >= 0`,
    ),
    check(
      "companies_ad_cpl_stop_minor_chk",
      sql`ad_cpl_stop_minor IS NULL OR ad_cpl_stop_minor >= 0`,
    ),
    check(
      "companies_ad_daily_cap_minor_chk",
      sql`ad_daily_cap_minor IS NULL OR ad_daily_cap_minor >= 0`,
    ),
    check(
      "companies_ad_capacity_site_monthly_chk",
      sql`ad_capacity_site_monthly IS NULL OR ad_capacity_site_monthly >= 0`,
    ),
    check(
      "companies_ad_capacity_social_monthly_chk",
      sql`ad_capacity_social_monthly IS NULL OR ad_capacity_social_monthly >= 0`,
    ),
  ]
);

export const widgetConfigs = pgTable("widget_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" })
    .unique(),
  primaryColor: text("primary_color").default("#6366f1"),
  position: text("position", { enum: ["bottom-right", "bottom-left"] }).default(
    "bottom-right"
  ),
  welcomeMessage: text("welcome_message"),
  title: text("title"),
  avatarUrl: text("avatar_url"),
  agentId: uuid("agent_id"),
  theme: text("theme", { enum: ["light", "dark", "auto"] }).default("auto"),
  showBranding: boolean("show_branding").default(true),
  customCss: text("custom_css"),
  autoOpen: boolean("auto_open").default(false),
  autoOpenDelay: integer("auto_open_delay").default(3000),
  persistThread: boolean("persist_thread").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const userPreferences = pgTable("user_preferences", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  activeCompanyId: uuid("active_company_id").references(() => companies.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
