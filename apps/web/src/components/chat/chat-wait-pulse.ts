import type { UIMessage } from "ai";
import { toolTreeRows } from "@/components/chat/tool-tree";

export function showWaitPulse({
  messages,
  isStreaming,
  streamFailed,
}: {
  messages: UIMessage[];
  isStreaming: boolean;
  streamFailed: boolean;
}): boolean {
  if (!isStreaming) return false;

  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return true;

  const textContent = last.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
  const rows = toolTreeRows(last.parts, { streamFailed });
  return !textContent && rows.length === 0;
}
