import { isToolUIPart, type UIMessage } from "ai";
import type { ChatStatus } from "@relay/db";

import { toolTreeRows, type ToolTreeRow } from "@/components/chat/tool-tree";
import { initials } from "@/components/v2/shell/initials";
import type { SessionHeaderProps } from "@/components/v2/session/session-header";
import { sessionStatusFromChat } from "@/components/v2/session/session-status";
import type { ToolChipState } from "@/components/v2/session/tool-chip";
import type { SteeringChip } from "@/components/v2/session/steering-composer";
import type { CheckpointCardView } from "@/lib/operator/checkpoint-card-view";

// Session layout A (05 session/*): header model and conversation pane items.

export const SESSIONS_HREF = "/operator?tab=sessions";

export type SessionHeaderModel = Pick<
  SessionHeaderProps,
  "title" | "status" | "crumbs" | "agent" | "startedLabel" | "backHref" | "needsYouCount"
>;

/** e.g. "Fri 25 Sep, 12:02" in the company timezone. */
function formatStarted(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** Session header (02 `375:22789`): Operator / Sessions / <title>, agent + version, status, start time. */
export function sessionHeaderModel(args: {
  title: string | null;
  status: ChatStatus;
  createdAt: Date;
  timeZone: string;
  agentName: string;
  version: { name: string; status: "live" | "draft" } | null;
  needsYouCount: number;
}): SessionHeaderModel {
  const title = args.title?.trim() || "Untitled session";
  return {
    title,
    status: sessionStatusFromChat(args.status),
    crumbs: [
      { label: "Operator", href: "/operator" },
      { label: "Sessions", href: SESSIONS_HREF },
      { label: title },
    ],
    agent: {
      kind: "operator",
      name: args.agentName,
      version: args.version?.name,
      status: args.version?.status ?? "none",
    },
    startedLabel: `Started ${formatStarted(args.createdAt, args.timeZone)}`,
    backHref: SESSIONS_HREF,
    needsYouCount: args.needsYouCount,
  };
}

/** Version pill on agent messages, e.g. "v1 Live". */
export function versionPill(version: { name: string; status: "live" | "draft" } | null): string | undefined {
  if (!version) return undefined;
  return `${version.name} ${version.status === "live" ? "Live" : "Draft"}`;
}

/** "searchPlaces" / "search_places" -> "Search places". */
export function toolLabel(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  if (!words) return "Tool";
  return words[0].toUpperCase() + words.slice(1);
}

const chipState: Record<ToolTreeRow["state"], ToolChipState> = {
  "in-progress": "running",
  done: "done",
  failed: "failed",
};

export type ConversationTool = {
  id: string;
  label: string;
  state: ToolChipState;
  summary: string | null;
  row: ToolTreeRow;
};

export type ConversationItem = {
  id: string;
  role: "agent" | "operator";
  text: string;
  tools: ConversationTool[];
  /** Parts of the turn, for the Checkpoint cards the agent proposed. */
  parts: UIMessage["parts"];
  state: "default" | "streaming" | "error";
};

function textOf(parts: UIMessage["parts"]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Conversation messages in the order the agent produced them: consecutive
 * assistant messages merge, then split into bubbles at tool boundaries, so
 * text written after a tool call starts a new bubble under that call's chips.
 * The last agent bubble streams while the chat is busy and shows the error
 * state when the stream failed.
 */
export function conversationItems(
  messages: UIMessage[],
  options: { isStreaming: boolean; streamFailed: boolean },
): ConversationItem[] {
  const items: ConversationItem[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const role = message.role === "user" ? "operator" : "agent";
    if (role === "operator") {
      items.push({
        id: message.id,
        role,
        text: textOf(message.parts),
        tools: [],
        parts: message.parts,
        state: "default",
      });
      continue;
    }
    let segment = 0;
    for (const part of message.parts) {
      const prev = items[items.length - 1];
      const startsBubble =
        prev?.role !== "agent" ||
        (part.type === "text" && part.text.trim().length > 0 && prev.parts.some(isToolUIPart));
      if (startsBubble) {
        items.push({
          id: segment === 0 ? message.id : `${message.id}-${segment}`,
          role,
          text: "",
          tools: [],
          parts: [],
          state: "default",
        });
        segment += 1;
      }
      const item = items[items.length - 1];
      item.parts = [...item.parts, part];
      if (part.type === "text" && part.text) {
        item.text = item.text ? `${item.text}\n\n${part.text}` : part.text;
      }
    }
  }

  for (const item of items) {
    if (item.role !== "agent") continue;
    item.tools = toolTreeRows(item.parts, { streamFailed: options.streamFailed }).map((row) => ({
      id: row.toolCallId,
      label: toolLabel(row.name),
      state: chipState[row.state],
      summary: row.summary,
      row,
    }));
  }

  const last = items[items.length - 1];
  if (last && options.streamFailed) last.state = "error";
  else if (last?.role === "agent" && options.isStreaming) last.state = "streaming";
  return items;
}

export function operatorInitials(name: string | null | undefined): string {
  return initials(name);
}

// Session layout B (05 session/*): steering chips and the Steering composer.

/** Contextual chips above the Steering composer, by agent package. */
export function steeringChips({ packageSlug }: { packageSlug: string | null }): SteeringChip[] {
  if (packageSlug === "revenue") {
    return [
      { label: "Search more", icon: "search" },
      { label: "Stricter criteria", icon: "filter" },
      { label: "Explain a score", icon: "gauge" },
      { label: "Find missing emails", icon: "mail" },
    ];
  }
  return [];
}

/**
 * The checkpoint quoted in the composer after Ask for changes. The quote drops
 * once the card no longer offers Ask for changes (resolved, superseded, gone).
 */
export function quotedCheckpoint(
  id: string | null,
  byId: ReadonlyMap<string, CheckpointCardView>,
): { id: string; text: string } | undefined {
  if (!id) return undefined;
  const view = byId.get(id);
  if (!view || !view.actions.includes("ask_for_changes")) return undefined;
  return { id, text: view.title };
}

export type SteeringSubmit =
  | { kind: "message"; text: string }
  | { kind: "ask_for_changes"; id: string; feedback: string }
  | { kind: "busy" }
  | { kind: "ignore" };

/** What a Steering composer send does: message the agent or request changes on the quoted card. */
export function steeringSubmit(args: {
  text: string;
  quoteId: string | undefined;
  isStarter: boolean;
  isStreaming: boolean;
}): SteeringSubmit {
  const text = args.text.trim();
  if (!text || !args.isStarter) return { kind: "ignore" };
  if (args.isStreaming) return { kind: "busy" };
  if (args.quoteId) return { kind: "ask_for_changes", id: args.quoteId, feedback: text };
  return { kind: "message", text };
}
