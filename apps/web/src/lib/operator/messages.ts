import type { UIMessage } from "ai";
import type { Message } from "@/types";

export function dbMessagesToUIMessages(messages: Message[]): UIMessage[] {
  const result: UIMessage[] = [];

  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      result.push({
        id: message.id,
        role: message.role,
        parts: (message.role === "assistant" ? savedTranscriptParts(message) : null) ?? [
          { type: "text", text: message.content },
        ],
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

/**
 * An operator turn's saved transcript (`metadata.transcript`): text and tool
 * parts in the order the agent produced them. Older rows have none.
 */
function savedTranscriptParts(message: Message): UIMessage["parts"] | null {
  const transcript = message.metadata?.transcript;
  if (!transcript?.length) return null;
  return transcript.map((part, index): UIMessage["parts"][number] => {
    if (part.type === "text") return { type: "text", text: part.text };
    const base = {
      type: `tool-${part.tool}` as const,
      toolCallId: part.toolCallId || `${message.id}-${index}`,
      input: part.input ?? {},
    };
    return (
      part.type === "tool-result"
        ? { ...base, state: "output-available", output: part.output }
        : { ...base, state: "output-error", errorText: part.errorText ?? "Tool failed" }
    ) as UIMessage["parts"][number];
  });
}
