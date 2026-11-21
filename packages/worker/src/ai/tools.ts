import { tool, type Tool } from "ai";
import { z } from "zod";
import { channels, db, knowledgeBase, type ChannelConfig } from "@relay/db";
import { and, eq } from "drizzle-orm";
import type { MessagePlatform } from "../integrations/messaging";
import type { InstagramCredentials } from "../integrations/instagram";
import { whatsappCredentials } from "./channel-credentials";
import { makeInstagramCommentTools } from "./instagram-tools";
import {
  makeRecordLeadTool,
  RECORD_LEAD_TOOL_NAME,
  type LeadCaptureContext,
} from "./record-lead-tool";
import {
  makeAskHumanTool,
  type AskHumanContext,
} from "../handoff/ask-human-tool";
import { ASK_HUMAN_TOOL_NAME } from "../handoff/prompt";

/** The channel fields tool selection needs, as loaded by the chat handler. */
export type AgentChannelSummary = {
  type: string;
  status: string | null;
  config: ChannelConfig | null;
};

/**
 * Extract a complete Instagram credential pair from a channel config.
 * Returns null when either field is missing, so a half-configured channel
 * never reaches the API.
 */
function instagramCredentials(
  config: ChannelConfig | null | undefined
): InstagramCredentials | null {
  const accountId = config?.accountId;
  const accessToken = config?.accessToken;
  if (!accountId || !accessToken) return null;
  return { accountId, accessToken };
}

/** Platforms with a real send implementation and a matching `channels.type`. */
type SendablePlatform = Extract<MessagePlatform, "whatsapp" | "instagram">;

/**
 * Score a knowledge entry against a search query.
 * Splits the query into individual terms and scores based on:
 * - Exact phrase match (highest)
 * - Individual term matches across name, description, content
 * Returns a score >= 0. Higher is better.
 */
function scoreEntry(
  entry: { name: string; description: string | null; content: string | null },
  query: string
): number {
  const lowerQuery = query.toLowerCase();
  const terms = lowerQuery
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const name = entry.name.toLowerCase();
  const description = (entry.description ?? "").toLowerCase();
  const content = (entry.content ?? "").toLowerCase();

  let score = 0;

  // Exact phrase match bonus
  if (name.includes(lowerQuery)) score += 20;
  if (description.includes(lowerQuery)) score += 15;
  if (content.includes(lowerQuery)) score += 10;

  // Individual term matches
  for (const term of terms) {
    if (name.includes(term)) score += 5;
    if (description.includes(term)) score += 3;
    if (content.includes(term)) score += 1;
  }

  return score;
}

/**
 * Search the company's knowledge base for relevant information.
 * Uses scored multi-term matching. Returns the best matches with
 * larger content snippets for useful context.
 */
export const searchKnowledgeBase = tool({
  description:
    "Search the knowledge base for relevant information to answer customer questions. Use when you need specific details not covered in the knowledge base context provided in your instructions.",
  inputSchema: z.object({
    query: z.string().describe("Search query — use specific keywords"),
    agentId: z.string().describe("Agent ID to search knowledge for"),
  }),
  execute: async ({ query, agentId }) => {
    const entries = await db.query.knowledgeBase.findMany({
      where: eq(knowledgeBase.agentId, agentId),
    });

    const scored = entries
      .filter((entry) => entry.status === "ready")
      .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return {
      results: scored.slice(0, 5).map(({ entry, score }) => ({
        name: entry.name,
        description: entry.description,
        content: entry.content?.substring(0, 1500),
        type: entry.type,
        relevanceScore: score,
      })),
      totalMatches: scored.length,
    };
  },
});

/**
 * Search Shopify products by various filters.
 * Delegates to the Shopify integration module.
 */
export const getShopifyProducts = tool({
  description:
    "Search Shopify products by collection, price, tags, or availability",
  inputSchema: z.object({
    collection: z
      .string()
      .optional()
      .describe("Collection handle to filter by"),
    minPrice: z.number().optional().describe("Minimum price filter"),
    maxPrice: z.number().optional().describe("Maximum price filter"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Product tags to filter by"),
    inStock: z.boolean().optional().describe("Filter by stock availability"),
  }),
  execute: async (params) => {
    const { searchProducts } = await import("../integrations/shopify");
    return searchProducts(params);
  },
});

/**
 * Get Shopify collections.
 * Delegates to the Shopify integration module.
 */
export const getShopifyCollections = tool({
  description: "Get all Shopify product collections",
  inputSchema: z.object({}),
  execute: async () => {
    const { getCollections } = await import("../integrations/shopify");
    return getCollections();
  },
});

/**
 * Get recent conversations from a messaging platform.
 */
export const getConversations = tool({
  description: "Get recent conversations from a messaging platform",
  inputSchema: z.object({
    platform: z
      .enum(["whatsapp", "instagram", "facebook"])
      .describe("Messaging platform"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of conversations to return"),
  }),
  execute: async ({ platform, limit }) => {
    const messaging = await import("../integrations/messaging");
    return messaging.getConversations(platform, limit);
  },
});

/**
 * Build the send tool bound to one agent.
 * `agentId` is captured in the closure rather than exposed on the input
 * schema, so the model cannot send from another agent's account. The platform
 * enum lists only what the agent has configured, so the model is never
 * offered a platform whose send would fail.
 * Credentials are read at call time so a rotated token is picked up.
 */
export function makeSendPlatformMessage(
  agentId: string,
  availablePlatforms: readonly SendablePlatform[]
) {
  const [first, ...rest] = availablePlatforms;
  if (!first) {
    throw new Error("makeSendPlatformMessage needs at least one platform");
  }

  return tool({
    description: "Send a message to a recipient on a messaging platform",
    inputSchema: z.object({
      platform: z.enum([first, ...rest]).describe("Messaging platform"),
      recipientId: z.string().describe("Recipient identifier"),
      content: z.string().describe("Message content to send"),
    }),
    execute: async ({ platform, recipientId, content }) => {
      const messaging = await import("../integrations/messaging");

      const channel = await db.query.channels.findFirst({
        where: and(
          eq(channels.agentId, agentId),
          eq(channels.type, platform),
          eq(channels.status, "active")
        ),
      });

      const credentials =
        platform === "whatsapp"
          ? whatsappCredentials(channel?.config)
          : instagramCredentials(channel?.config);

      if (!credentials) {
        return {
          success: false,
          messageId: null,
          error: `This agent has no active ${platform} channel with complete credentials`,
          platform,
        };
      }

      return messaging.sendMessage(platform, recipientId, content, credentials);
    },
  });
}

/**
 * Get message history for a specific conversation.
 */
export const getMessageHistory = tool({
  description:
    "Get message history for a specific conversation on a messaging platform",
  inputSchema: z.object({
    platform: z
      .enum(["whatsapp", "instagram", "facebook"])
      .describe("Messaging platform"),
    conversationId: z.string().describe("Conversation identifier"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of messages to return"),
  }),
  execute: async ({ platform, conversationId, limit }) => {
    const messaging = await import("../integrations/messaging");
    return messaging.getMessageHistory(platform, conversationId, limit);
  },
});

/**
 * Returns the full set of available tools keyed by name.
 * The chat route can pick a subset based on agent integrations.
 */
export function getAllTools(agentId: string) {
  return {
    searchKnowledgeBase,
    getShopifyProducts,
    getShopifyCollections,
    getConversations,
    sendPlatformMessage: makeSendPlatformMessage(agentId, [
      "whatsapp",
      "instagram",
    ]),
    getMessageHistory,
    ...makeInstagramCommentTools(agentId),
  } as const;
}

export type SelectToolsOptions = {
  /**
   * Register the tools that write to the outside world — a WhatsApp message
   * from the business number, a public Instagram reply, a private reply that
   * can be spent only once per comment.
   *
   * Off by default. The widget chat is public, and the inbound and comment
   * runs are driven by text an anonymous stranger wrote, so on those paths a
   * send tool is a way to make the business say something it never chose to
   * say. Only a call site whose input is already trusted turns this on.
   */
  allowSendTools?: boolean;
  /**
   * Register `record_lead`, bound to this conversation. Pass it only when
   * the agent's Lead capture toggle is on (`loadLeadCapture`). Separate from
   * `allowSendTools` because it only writes to our own database: a public
   * widget visitor may describe their project, but still cannot make the
   * business send a message.
   */
  leadCapture?: LeadCaptureContext;
  /**
   * Register `ask_human`, bound to this conversation. Like `record_lead` it
   * only writes to our own database (and notifies the company's own
   * recipient), so public paths may have it. Pass it only when at least one
   * handoff trigger is on.
   */
  askHuman?: AskHumanContext;
};

/**
 * Select a subset of tools based on which integrations are enabled and which
 * channels the agent has configured.
 */
export function selectTools(
  enabledIntegrations: string[],
  agentId: string,
  agentChannels: AgentChannelSummary[] = [],
  options: SelectToolsOptions = {}
) {
  const all = getAllTools(agentId);

  // Knowledge base is always available when an agent exists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selected: Record<string, Tool<any, any>> = {
    searchKnowledgeBase: all.searchKnowledgeBase,
  };

  if (enabledIntegrations.includes("shopify")) {
    selected.getShopifyProducts = all.getShopifyProducts;
    selected.getShopifyCollections = all.getShopifyCollections;
  }

  // Messaging is driven by the agent's channels, not the integrations table —
  // the integrations type enum never contains a messaging platform.
  const configuredPlatforms: SendablePlatform[] = [];
  for (const channel of agentChannels) {
    if (channel.status !== "active") continue;
    if (channel.type === "whatsapp" && whatsappCredentials(channel.config)) {
      configuredPlatforms.push("whatsapp");
    }
    if (channel.type === "instagram" && instagramCredentials(channel.config)) {
      configuredPlatforms.push("instagram");
    }
  }

  // Reading is safe for every caller; sending is not. A tool that writes to a
  // verified business number or to a public timeline is registered only when
  // the call site asks for it, so a new caller is safe by default and a new
  // send tool cannot reach an untrusted path just by being added here.
  if (configuredPlatforms.includes("instagram")) {
    selected.listInstagramComments =
      makeInstagramCommentTools(agentId).listInstagramComments;
  }

  if (options.leadCapture) {
    selected[RECORD_LEAD_TOOL_NAME] = makeRecordLeadTool(options.leadCapture);
  }

  if (options.askHuman) {
    selected[ASK_HUMAN_TOOL_NAME] = makeAskHumanTool(options.askHuman);
  }

  if (!options.allowSendTools) return selected;

  // Only the send path is real. getConversations and getMessageHistory still
  // return mock data, so they stay unselected rather than feeding a live agent
  // fabricated customer history.
  if (configuredPlatforms.length > 0) {
    selected.sendPlatformMessage = makeSendPlatformMessage(
      agentId,
      configuredPlatforms
    );
  }

  if (configuredPlatforms.includes("instagram")) {
    const commentTools = makeInstagramCommentTools(agentId);
    selected.replyToInstagramComment = commentTools.replyToInstagramComment;
    selected.sendInstagramPrivateReply = commentTools.sendInstagramPrivateReply;
  }

  return selected;
}
