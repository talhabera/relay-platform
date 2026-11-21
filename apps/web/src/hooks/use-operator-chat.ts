"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

interface UseOperatorChatOptions {
  chatId: string;
  initialMessages?: UIMessage[];
}

export function useOperatorChat({
  chatId,
  initialMessages = [],
}: UseOperatorChatOptions) {
  return useChat({
    transport: new DefaultChatTransport({
      api: "/api/operator/chat",
      body: { chatId },
    }),
    messages: initialMessages,
  });
}
