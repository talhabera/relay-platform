import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { hasPendingCard } from "@/components/operator/checkpoint-block";

export type ToolTreeState = "in-progress" | "done" | "failed";

export type ToolTreeRow = {
  toolCallId: string;
  name: string;
  state: ToolTreeState;
  summary: string | null;
  downloadPath: string | null;
  filename: string | null;
};

const SUMMARY_MAX = 200;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasErrorField(output: unknown): boolean {
  const record = asRecord(output);
  if (!record) return false;
  return typeof record.error === "string" && record.error.length > 0;
}

function summaryFromOutput(
  output: unknown,
  state: ToolTreeState,
): string | null {
  const record = asRecord(output);
  if (!record) return null;
  const keys =
    state === "failed"
      ? (["error", "message", "status"] as const)
      : (["message", "status"] as const);
  for (const key of keys) {
    const value = stringField(record, key);
    if (!value) continue;
    if (value.length <= SUMMARY_MAX) return value;
    if (state === "failed") return value.slice(0, SUMMARY_MAX);
  }
  return null;
}

function errorTextFromPart(part: UIMessage["parts"][number]): string | null {
  if (!("errorText" in part) || typeof part.errorText !== "string") {
    return null;
  }
  if (part.errorText.length === 0) return null;
  return part.errorText.length <= SUMMARY_MAX
    ? part.errorText
    : part.errorText.slice(0, SUMMARY_MAX);
}

function downloadPathFromOutput(output: unknown): string | null {
  const record = asRecord(output);
  const path = record ? stringField(record, "downloadPath") : null;
  return path;
}

function filenameFromOutput(output: unknown): string | null {
  const record = asRecord(output);
  return record ? stringField(record, "filename") : null;
}

function toolCallIdOf(part: UIMessage["parts"][number]): string {
  if ("toolCallId" in part && typeof part.toolCallId === "string") {
    return part.toolCallId;
  }
  return "tool";
}

export function toolTreeRows(
  parts: UIMessage["parts"],
  options: { streamFailed: boolean },
): ToolTreeRow[] {
  const rows: ToolTreeRow[] = [];

  for (const item of parts) {
    if (!isToolUIPart(item)) continue;
    if (hasPendingCard(item)) continue;

    const stateName = item.state;
    let state: ToolTreeState;

    if (stateName === "output-error") {
      state = "failed";
    } else if (stateName === "output-available") {
      state = hasErrorField(item.output) ? "failed" : "done";
    } else if (
      stateName === "input-streaming" ||
      stateName === "input-available"
    ) {
      state = options.streamFailed ? "failed" : "in-progress";
    } else {
      state = options.streamFailed ? "failed" : "in-progress";
    }

    const output =
      "output" in item && stateName === "output-available"
        ? item.output
        : undefined;

    const downloadPath = downloadPathFromOutput(output);
    const filename =
      filenameFromOutput(output) ?? (downloadPath ? "Excel file" : null);
    const summary =
      summaryFromOutput(output, state) ??
      (state === "failed" ? errorTextFromPart(item) : null);

    rows.push({
      toolCallId: toolCallIdOf(item),
      name: getToolName(item),
      state,
      summary,
      downloadPath,
      filename,
    });
  }

  return rows;
}
