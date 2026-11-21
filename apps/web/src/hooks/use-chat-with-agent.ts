"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

interface UseChatWithAgentOptions {
  agentId?: string;
  chatId?: string;
  companyId?: string;
  initialMessages?: UIMessage[];
}

/**
 * Wrapper around the AI SDK `useChat` hook pre-configured for the
 * authenticated chat API route. Passes agent/company/chat context in the
 * request body so the server can load the right prompt and tools.
 */
export function useChatWithAgent({
  agentId,
  chatId,
  companyId,
  initialMessages = [],
}: UseChatWithAgentOptions = {}) {
  return useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { agentId, chatId, companyId },
    }),
    messages: initialMessages,
  });
}
