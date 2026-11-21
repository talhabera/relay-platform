import type { InferSelectModel } from "drizzle-orm";
import type { UIMessage } from "ai";
import type { cronRunMessages } from "@relay/db";

export type CronRunMessage = InferSelectModel<typeof cronRunMessages>;

export function cronRunMessagesToUIMessages(
  messages: CronRunMessage[],
): UIMessage[] {
  const result: UIMessage[] = [];

  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      result.push({
        id: message.id,
        role: message.role,
        parts: [{ type: "text", text: message.content }],
      });
      continue;
    }

    if (message.role === "tool") {
      let output: unknown;
      try {
        output = JSON.parse(message.content);
      } catch {
        output = { raw: message.content };
      }

      result.push({
        id: message.id,
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "toolResult",
            toolCallId: message.id,
            state: "output-available",
            input: {},
            output,
          },
        ],
      });
    }
  }

  return result;
}
