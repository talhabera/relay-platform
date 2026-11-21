import { pgTable, text, uuid, timestamp, check } from "drizzle-orm/pg-core";
import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";

/**
 * Closed-beta access requests from the marketing site (spec
 * 2026-10-02-pricing-and-access-requests, decisions 5-11). No admin list: the
 * team triages from the notification email and sets `status` by hand.
 */
export const ACCESS_REQUEST_PLANS = ["free", "pro", "enterprise", "none"] as const;
export type AccessRequestPlan = (typeof ACCESS_REQUEST_PLANS)[number];

export const ACCESS_REQUEST_CLIENT_COUNTS = ["1", "2-5", "6-20", "20+"] as const;
export type AccessRequestClientCount = (typeof ACCESS_REQUEST_CLIENT_COUNTS)[number];

export const ACCESS_REQUEST_STATUSES = ["new", "invited", "declined"] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

/**
 * One row per email (stored lowercased). A repeat request updates the details
 * and `updated_at` and keeps `status`.
 */
export const accessRequests = pgTable(
  "access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique("access_requests_email_unique"),
    name: text("name").notNull(),
    agencyName: text("agency_name").notNull(),
    clientCount: text("client_count", { enum: ACCESS_REQUEST_CLIENT_COUNTS }).notNull(),
    plan: text("plan", { enum: ACCESS_REQUEST_PLANS }).notNull().default("none"),
    message: text("message"),
    status: text("status", { enum: ACCESS_REQUEST_STATUSES }).notNull().default("new"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  () => [
    check("access_requests_email_lower_chk", sql`email = lower(email)`),
    check("access_requests_client_count_chk", sql`client_count IN ('1', '2-5', '6-20', '20+')`),
    check("access_requests_plan_chk", sql`plan IN ('free', 'pro', 'enterprise', 'none')`),
    check("access_requests_status_chk", sql`status IN ('new', 'invited', 'declined')`),
  ],
);

export type AccessRequest = InferSelectModel<typeof accessRequests>;
export type NewAccessRequest = InferInsertModel<typeof accessRequests>;
