import type { TranscriptPart } from "@relay/db";

// An operator turn as it happened: text and tool calls in order, saved on the
// assistant message so the transcript shows tool chips between bubbles after a
// reload. Display only: model context is built from message text.

/** Values past this size keep only their top-level scalar fields. */
const MAX_VALUE_CHARS = 8000;

type StepPart = {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

function compact(value: unknown): unknown {
  let size: number;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    return { truncated: true };
  }
  if (size <= MAX_VALUE_CHARS) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { truncated: true };
  const kept: Record<string, unknown> = { truncated: true };
  for (const [key, field] of Object.entries(value)) {
    if (field === null || ["string", "number", "boolean"].includes(typeof field)) {
      kept[key] = typeof field === "string" ? field.slice(0, 500) : field;
    }
  }
  return kept;
}

/**
 * The turn's transcript and its full text. `onFinish` gives only the last
 * step's text, so the text written before a tool call would otherwise be lost.
 */
export function transcriptFromSteps(steps: ReadonlyArray<{ content: ReadonlyArray<{ type: string }> }>): {
  text: string;
  transcript: TranscriptPart[];
  hasTools: boolean;
} {
  const transcript: TranscriptPart[] = [];
  for (const step of steps) {
    for (const raw of step.content) {
      const part = raw as StepPart;
      if (part.type === "text" && part.text?.trim()) {
        transcript.push({ type: "text", text: part.text });
      } else if (part.type === "tool-result" || part.type === "tool-error") {
        transcript.push({
          type: part.type,
          tool: part.toolName ?? "tool",
          toolCallId: part.toolCallId ?? "",
          input: compact(part.input ?? {}),
          ...(part.type === "tool-result"
            ? { output: compact(part.output) }
            : { errorText: part.error instanceof Error ? part.error.message : String(part.error) }),
        });
      }
    }
  }
  const text = transcript
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .join("\n\n");
  return { text, transcript, hasTools: transcript.some((part) => part.type !== "text") };
}
