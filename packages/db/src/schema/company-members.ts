import {
  boolean,
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  unique,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";

export const PAGE_PERMISSION_KEYS = [
  "operator",
  "agents",
  "messaging",
  "analytics",
] as const;

// Role on the membership row (spec 2026-10-02-client-role-and-portal).
// Fixed at invite. A `client` row ignores pagePermissions and passes only
// the client portal helper (`requireClientAccess`).
export const COMPANY_MEMBER_ROLES = ["member", "client"] as const;

export type CompanyMemberRole = (typeof COMPANY_MEMBER_ROLES)[number];

export type PagePermissionKey = (typeof PAGE_PERMISSION_KEYS)[number];

export type PagePermissions = Record<PagePermissionKey, boolean>;

export const DEFAULT_PAGE_PERMISSIONS: PagePermissions = {
  operator: true,
  agents: false,
  messaging: false,
  analytics: false,
};

export const OWNER_PAGE_PERMISSIONS: PagePermissions = {
  operator: true,
  agents: true,
  messaging: true,
  analytics: true,
};

export function normalizePagePermissions(
  value: Partial<PagePermissions> | null | undefined,
): PagePermissions {
  return {
    operator: value?.operator === true,
    agents: value?.agents === true,
    messaging: value?.messaging === true,
    analytics: value?.analytics === true,
  };
}

export const companyMembers = pgTable(
  "company_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: COMPANY_MEMBER_ROLES })
      .notNull()
      .default("member"),
    pagePermissions: jsonb("page_permissions")
      .$type<PagePermissions>()
      .notNull()
      .default(DEFAULT_PAGE_PERMISSIONS),
    /**
     * Client portal Notifications (S107): the client user turned report emails
     * off. Report email delivery (S88) skips these rows. Ignored on `member`.
     */
    reportEmailOptOut: boolean("report_email_opt_out").notNull().default(false),
    /** Last time the client opened the portal bell; newer items show the dot. */
    notificationsSeenAt: timestamp("notifications_seen_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("company_members_company_id_user_id_idx").on(
      table.companyId,
      table.userId,
    ),
    index("company_members_user_id_idx").on(table.userId),
    // One membership per client user (migration 0030).
    uniqueIndex("company_members_client_user_uidx")
      .on(table.userId)
      .where(sql`${table.role} = 'client'`),
  ],
);
