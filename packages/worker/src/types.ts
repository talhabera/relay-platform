import type { InferSelectModel } from "drizzle-orm";
import type {
  agents,
  companies,
  knowledgeBase,
  messages,
} from "@relay/db";

export type Agent = InferSelectModel<typeof agents>;
export type Company = InferSelectModel<typeof companies>;
export type KnowledgeEntry = InferSelectModel<typeof knowledgeBase>;
export type Message = InferSelectModel<typeof messages>;

export type AgentPersona = "friendly" | "professional" | "casual" | "expert";
export type ResponseLength = "short" | "medium" | "long";
export type ChatChannelType =
  | "whatsapp"
  | "instagram"
  | "telegram"
  | "messenger"
  | "widget"
  | "web"
  | "operator"
  | "master";
