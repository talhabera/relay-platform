import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  hasToolCall,
  type UIMessage,
} from "ai";
import { convertToModelMessages } from "ai";
import { and, eq } from "drizzle-orm";
import {
  db,
  agents,
  channels,
  companies,
  integrations,
  knowledgeBase,
  widgetConfigs,
  chats,
  agentVersions,
} from "@relay/db";
import { getModel } from "./ai/provider";
import { buildSystemPrompt } from "./ai/system-prompt";
import { selectTools } from "./ai/tools";
import {
  createChatSession,
  getChatHistory,
  saveAssistantMessage,
  saveUserMessage,
} from "./ai/chat-persistence";
import { checkTokenBudget, recordTokenUsage } from "./ai/token-limiter";
import { dbMessagesToUIMessages } from "./operator/messages";
import { buildOperatorSystemPrompt } from "./operator/system-prompt";
import { selectOperatorTools } from "./operator/tools";
import { markRunFinished, markRunStarted } from "./operator/active-runs";
import { transcriptFromSteps } from "./operator/tool-history";
import { loadLeadCapture } from "./leads/lead-capture";
import {
  ASK_OPERATOR_TOOL,
  answerOpenChatQuestions,
} from "./operator/ask-operator";
import {
  handoffTurnOptions,
  loadHandoffRuntime,
  type HandoffRuntime,
} from "./handoff/runtime";

/** Header telling the caller the agent is paused because a person took over. */
export const HANDOFF_STATE_HEADER = "X-Handoff-State";

/**
 * A person has taken over: the agent says nothing. The stream is empty but
 * well-formed, so a widget that only knows the old protocol simply shows no
 * reply. The person's own messages reach the customer separately.
 */
function pausedForTakeoverResponse(): Response {
  const response = createUIMessageStreamResponse({
    stream: createUIMessageStream({ execute: () => {} }),
  });
  response.headers.set(HANDOFF_STATE_HEADER, "taken_over");
  return response;
}

export type ChatKind = "customer" | "operator" | "widget";

export type InternalChatBody = {
  kind: ChatKind;
  messages: UIMessage[];
  chatId?: string;
  agentId?: string;
  companyId?: string;
  userId?: string;
  visitorId?: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

function extractTextFromParts(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function isContinueOnlyMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "continue" || normalized === "continue.";
}

function filterValidMessages(
  messages: UIMessage[],
  includeDynamicTool = false,
): UIMessage[] {
  return messages.filter((msg) => {
    const hasText = msg.parts.some(
      (p) => p.type === "text" && p.text.trim().length > 0,
    );
    const hasToolParts = msg.parts.some((p) =>
      includeDynamicTool
        ? p.type === "tool-invocation" || p.type === "dynamic-tool"
        : p.type === "tool-invocation",
    );
    return hasText || hasToolParts;
  });
}

export async function handleInternalChat(
  body: InternalChatBody,
): Promise<Response> {
  switch (body.kind) {
    case "customer":
      return handleCustomerChat(body);
    case "operator":
      return handleOperatorChat(body);
    case "widget":
      return handleWidgetChat(body);
    default:
      return new Response("Invalid kind", { status: 400 });
  }
}

async function handleCustomerChat(body: InternalChatBody): Promise<Response> {
  const { messages, agentId, companyId, chatId, userId } = body;

  if (!userId) {
    return new Response("User ID is required", { status: 400 });
  }

  const budget = await checkTokenBudget(userId, "user");
  if (!budget.allowed) {
    return Response.json(
      {
        error: "Weekly token limit reached",
        used: budget.used,
        limit: budget.limit,
        resetsAt: budget.resetsAt,
      },
      { status: 429 },
    );
  }

  if (!companyId) {
    return new Response("Company ID is required", { status: 400 });
  }

  if (!messages || messages.length === 0) {
    return new Response("Messages are required", { status: 400 });
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });

  if (!company) {
    return new Response("Company not found", { status: 404 });
  }

  const agent = agentId
    ? await db.query.agents.findFirst({
        where: eq(agents.id, agentId),
      })
    : null;

  if (agent && agent.kind === "operator") {
    return new Response("Operator agents cannot be used on this endpoint", {
      status: 400,
    });
  }

  const enabledIntegrations = agentId
    ? await db.query.integrations.findMany({
        where: eq(integrations.companyId, companyId),
      })
    : [];

  const integrationTypes = enabledIntegrations
    .filter((i) => i.status === "connected")
    .map((i) => i.type);

  const knowledgeEntries = agent
    ? await db.query.knowledgeBase.findMany({
        where: and(
          eq(knowledgeBase.agentId, agent.id),
          eq(knowledgeBase.status, "ready"),
        ),
      })
    : [];

  const agentConfig = agent ?? {
    name: "Assistant",
    description: null,
    instructions: null,
    persona: "professional" as const,
    responseLength: "medium" as const,
    language: "en" as const,
  };

  const agentChannels = agent
    ? await db.query.channels.findMany({
        where: eq(channels.agentId, agent.id),
      })
    : [];

  const lastUserMessage = messages.filter((m) => m.role === "user").at(-1);
  if (chatId && lastUserMessage) {
    const content = extractTextFromParts(lastUserMessage);
    if (content) {
      await saveUserMessage(chatId, content);
    }
  }

  // Test chat runs the full handoff path (spec decision 7).
  const scope = agent ? { id: agent.id, companyId: company.id } : null;
  const handoff: HandoffRuntime | null = scope
    ? await loadHandoffRuntime(scope, chatId ?? null)
    : null;
  if (handoff?.paused) return pausedForTakeoverResponse();
  const handoffTurn =
    scope && handoff
      ? handoffTurnOptions(handoff, scope, company.name, () => chatId ?? null)
      : { handoffSection: "" };

  // The dashboard test chat is an authenticated owner driving their own
  // agent, so a send from their own channel is a send they asked for.
  const tools = agent
    ? selectTools(integrationTypes, agent.id, agentChannels, {
        allowSendTools: true,
        askHuman: handoffTurn.askHuman,
      })
    : {};
  const toolNames = Object.keys(tools);

  const systemPrompt = buildSystemPrompt({
    agent: agentConfig,
    company,
    knowledgeEntries,
    toolNames,
    handoffSection: handoffTurn.handoffSection,
  });

  const validMessages = filterValidMessages(messages);
  const modelMessages = await convertToModelMessages(validMessages);

  const result = streamText({
    model: getModel(agent?.model),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
    },
    onFinish: async ({ text, usage }) => {
      if (chatId && text) {
        await saveAssistantMessage(chatId, text);
      }
      const totalTokens = usage.totalTokens ?? 0;
      if (totalTokens > 0) {
        await recordTokenUsage(userId, "user", totalTokens);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}

async function handleOperatorChat(body: InternalChatBody): Promise<Response> {
  const { chatId, messages, userId } = body;

  if (!userId) {
    return new Response("User ID is required", { status: 400 });
  }

  if (!chatId) {
    return new Response("Chat ID is required", { status: 400 });
  }

  if (!messages || messages.length === 0) {
    return new Response("Messages are required", { status: 400 });
  }

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (!chat) {
    return new Response("Chat not found", { status: 404 });
  }

  if (chat.channelType !== "operator" || !chat.versionId) {
    return new Response("Invalid operator session", { status: 400 });
  }

  if (!chat.agentId) {
    return new Response("Invalid operator session", { status: 400 });
  }

  const budget = await checkTokenBudget(userId, "user");
  if (!budget.allowed) {
    return Response.json(
      {
        error: "Weekly token limit reached",
        used: budget.used,
        limit: budget.limit,
        resetsAt: budget.resetsAt,
      },
      { status: 429 },
    );
  }

  const version = await db.query.agentVersions.findFirst({
    where: eq(agentVersions.id, chat.versionId),
  });

  if (!version) {
    return new Response("Version not found", { status: 404 });
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, chat.agentId),
  });

  if (!agent || agent.kind !== "operator") {
    return new Response("Agent not found", { status: 404 });
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, chat.companyId),
  });

  if (!company) {
    return new Response("Company not found", { status: 404 });
  }

  const knowledgeEntries = await db.query.knowledgeBase.findMany({
    where: and(
      eq(knowledgeBase.agentId, agent.id),
      eq(knowledgeBase.status, "ready"),
    ),
  });

  const tools = selectOperatorTools({
    version,
    chatId,
    agentId: agent.id,
    companyId: company.id,
    packageSlug: agent.packageSlug,
    userId,
  });

  const systemPrompt = buildOperatorSystemPrompt({
    agent,
    company,
    versionInstructions: version.instructions,
    knowledgeEntries,
    toolToggles: version.toolToggles,
  });

  const history = await getChatHistory(chatId);
  let uiMessages = dbMessagesToUIMessages(history);

  const lastClientUserMessage = messages.filter((m) => m.role === "user").at(-1);
  if (lastClientUserMessage) {
    const content = extractTextFromParts(lastClientUserMessage);
    const lastPersistedUser = history.filter((m) => m.role === "user").at(-1);
    const isNewUserMessage =
      content.length > 0 && content !== lastPersistedUser?.content;

    if (isNewUserMessage) {
      const lastPersistedRole = history.at(-1)?.role;
      const skipContinueAfterTool =
        isContinueOnlyMessage(content) && lastPersistedRole === "tool";

      if (!skipContinueAfterTool) {
        await saveUserMessage(chatId, content);
        // A composer reply answers the session's open agent questions.
        await answerOpenChatQuestions({ chatId, userId, answer: content });
        uiMessages = [
          ...uiMessages,
          {
            id: lastClientUserMessage.id,
            role: "user" as const,
            parts: [{ type: "text" as const, text: content }],
          },
        ];
      }
    }
  }

  const validMessages = filterValidMessages(uiMessages, true);
  const modelMessages = await convertToModelMessages(validMessages);

  const result = streamText({
    model: getModel(version.model),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    // An agent question ends the turn (checkpoints spec decision 9).
    stopWhen: [stepCountIs(10), hasToolCall(ASK_OPERATOR_TOOL)],
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
    },
    onFinish: async ({ usage, steps }) => {
      // Every step's text plus the tool calls between them, so a reload shows
      // the turn as it streamed. A tool-only turn is saved with empty text
      // (filtered out of model context).
      const { text, transcript, hasTools } = transcriptFromSteps(steps);
      if (text || hasTools) {
        await saveAssistantMessage(chatId, text, hasTools ? { transcript } : undefined);
      }
      const totalTokens = usage.totalTokens ?? 0;
      if (totalTokens > 0) {
        await recordTokenUsage(userId, "user", totalTokens);
      }
    },
  });

  // Run to the end even if the browser leaves (refresh, closed tab): without
  // this the stream stalls when nobody reads it and onFinish never saves.
  markRunStarted(chatId);
  void Promise.resolve(
    result.consumeStream({ onError: (error) => console.error("[OperatorChat] run failed", error) }),
  ).finally(() => markRunFinished(chatId));

  return result.toUIMessageStreamResponse();
}

async function handleWidgetChat(body: InternalChatBody): Promise<Response> {
  const { messages, visitorId, chatId, companyId } = body;

  const tokenIdentifier = visitorId ?? "unknown";
  const budget = await checkTokenBudget(tokenIdentifier, "widget");
  if (!budget.allowed) {
    return new Response(
      JSON.stringify({
        error: "Weekly usage limit reached. Please try again later.",
        used: budget.used,
        limit: budget.limit,
        resetsAt: budget.resetsAt,
      }),
      {
        status: 429,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  if (!messages || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "Messages are required" }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  if (!companyId) {
    return new Response(
      JSON.stringify({ error: "Company ID is required" }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });

  if (!company) {
    return new Response(
      JSON.stringify({ error: "Widget not found" }),
      {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }

  const widgetConfig = await db.query.widgetConfigs.findFirst({
    where: eq(widgetConfigs.companyId, company.id),
  });

  let agent: Awaited<
    ReturnType<typeof db.query.agents.findFirst>
  > = undefined;

  if (widgetConfig?.agentId) {
    const configuredAgent = await db.query.agents.findFirst({
      where: eq(agents.id, widgetConfig.agentId),
    });

    if (!configuredAgent || configuredAgent.kind === "operator") {
      return new Response(
        JSON.stringify({ error: "Widget agent is invalid" }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    agent = configuredAgent;
  } else {
    const agentList = await db.query.agents.findMany({
      where: and(
        eq(agents.companyId, company.id),
        eq(agents.kind, "customer"),
      ),
    });

    const customerAgents = agentList.filter((a) => a.kind === "customer");
    agent =
      customerAgents.find((a) => a.isActive) ?? customerAgents[0] ?? undefined;
  }

  const enabledIntegrations = await db.query.integrations.findMany({
    where: eq(integrations.companyId, company.id),
  });

  const integrationTypes = enabledIntegrations
    .filter((i) => i.status === "connected")
    .map((i) => i.type);

  const knowledgeEntries = agent
    ? await db.query.knowledgeBase.findMany({
        where: and(
          eq(knowledgeBase.agentId, agent.id),
          eq(knowledgeBase.status, "ready"),
        ),
      })
    : [];

  const agentConfig = agent ?? {
    name: "Assistant",
    description: null,
    instructions: null,
    persona: "professional" as const,
    responseLength: "medium" as const,
    language: "en" as const,
  };

  const agentChannels = agent
    ? await db.query.channels.findMany({
        where: eq(channels.agentId, agent.id),
      })
    : [];

  // The chatId in the body comes from the browser. It is only kept when it
  // names this visitor's widget chat with this company (and agent); anything
  // else is dropped and a new session starts below, so neither messages nor
  // leads can be written onto someone else's conversation.
  let activeChatId: string | undefined = undefined;
  if (chatId) {
    const requestedChat = await db.query.chats.findFirst({
      where: and(eq(chats.id, chatId), eq(chats.companyId, company.id)),
    });
    const isOwnWidgetChat =
      !!requestedChat &&
      requestedChat.companyId === company.id &&
      requestedChat.channelType === "widget" &&
      !!visitorId &&
      requestedChat.visitorId === visitorId &&
      (!requestedChat.agentId || requestedChat.agentId === agent?.id);
    if (isOwnWidgetChat) {
      activeChatId = chatId;
    }
  }

  if (!activeChatId && visitorId) {
    activeChatId = await createChatSession(
      null,
      company.id,
      agent?.id,
      "Widget Chat",
      visitorId,
      "widget",
    );
  }

  const lastUserMessage = messages.filter((m) => m.role === "user").at(-1);
  if (activeChatId && lastUserMessage) {
    const content = extractTextFromParts(lastUserMessage);
    if (content) {
      await saveUserMessage(activeChatId, content);
    }
  }

  // A person has taken over: the visitor's message is stored for them and
  // the agent stays quiet until hand-back.
  const scope = agent ? { id: agent.id, companyId: company.id } : null;
  const handoff: HandoffRuntime | null = scope
    ? await loadHandoffRuntime(scope, activeChatId ?? null)
    : null;
  if (handoff?.paused) {
    const paused = pausedForTakeoverResponse();
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      paused.headers.set(key, value);
    }
    if (activeChatId) paused.headers.set("X-Chat-Id", activeChatId);
    return paused;
  }
  const handoffTurn =
    scope && handoff
      ? handoffTurnOptions(handoff, scope, company.name, () => activeChatId ?? null)
      : { handoffSection: "" };

  // The widget is public: the person on the other end is a stranger, so the
  // agent answers them and never gets a tool that sends somewhere else.
  const tools = agent
    ? selectTools(integrationTypes, agent.id, agentChannels, {
        allowSendTools: false,
        leadCapture: await loadLeadCapture(agent, () => activeChatId ?? null),
        askHuman: handoffTurn.askHuman,
      })
    : {};
  const toolNames = Object.keys(tools);

  const systemPrompt = buildSystemPrompt({
    agent: agentConfig,
    company,
    knowledgeEntries,
    toolNames,
    handoffSection: handoffTurn.handoffSection,
  });

  const validMessages = filterValidMessages(messages);
  const modelMessages = await convertToModelMessages(validMessages);

  const result = streamText({
    model: getModel(agent?.model),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    providerOptions: {
      anthropic: {
        cacheControl: { type: "ephemeral" },
      },
    },
    onFinish: async ({ text, usage }) => {
      if (activeChatId && text) {
        await saveAssistantMessage(activeChatId, text);
      }
      const totalTokens = usage.totalTokens ?? 0;
      if (totalTokens > 0) {
        await recordTokenUsage(tokenIdentifier, "widget", totalTokens);
      }
    },
  });

  const response = result.toUIMessageStreamResponse();

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  if (activeChatId) {
    response.headers.set("X-Chat-Id", activeChatId);
  }

  return response;
}
