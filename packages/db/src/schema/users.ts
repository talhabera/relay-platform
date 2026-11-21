import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /**
   * E.164 WhatsApp number from the client profile (S107). Not synced from
   * NexAuth. The handoff primary-recipient picker lists it, and the portal
   * bell matches handoff requests addressed to this number.
   */
  whatsappNumber: text("whatsapp_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
