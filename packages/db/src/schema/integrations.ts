import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { agents } from "./agents";

export type IntegrationConfig = {
  webhookUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  workspaceId?: string;
  channelId?: string;
  customDomain?: string;
  mcpEndpoint?: string;
  mcpHeaders?: Record<string, string>;
  hunter?: { apiKey: string };
  snov?: { clientId: string; clientSecret: string };
  googlePlaces?: { apiKey: string };
  /**
   * Google Workspace (S73), Gmail send-only. The refresh token is the secret; `email` is the
   * mailbox it sends from and never leaves the server except as the row's note.
   */
  googleWorkspace?: GoogleWorkspaceConfig;
};

export type GoogleWorkspaceConfig = {
  refreshToken: string;
  email: string;
  scope: string;
};

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    type: text("type", {
      enum: [
        "slack",
        "discord",
        "zendesk",
        "shopify",
        "mcp_custom",
        "hunter",
        "snov",
        "google_places",
        "google_workspace",
        "meta",
        "google_business_profile",
        "linkedin",
        "trustpilot",
      ],
    }).notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["connected", "disconnected", "pending", "error"],
    }).default("pending"),
    config: jsonb("config").$type<IntegrationConfig>().default({}),
    error: text("error"),
    lastSyncAt: timestamp("last_sync_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("integrations_company_id_idx").on(table.companyId),
    index("integrations_agent_id_idx").on(table.agentId),
  ]
);
