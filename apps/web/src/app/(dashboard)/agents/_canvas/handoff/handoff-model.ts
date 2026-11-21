import type {
  HandoffExpiryMinutes,
  HandoffHandBackReason,
  HandoffIfNobodyAnswers,
  HandoffMode,
  HandoffReplyMode,
  HandoffRequestStatus,
  TeamChatGroupStatus,
} from "@/db/schema";
import { HANDOFF_TAKEOVER_IDLE_MINUTES } from "@/db/schema";
import type { HandoffSettingsInput } from "@/lib/handoff/validators";

// Pure view model for the Handoff node and the Handoff settings inspector (Figma 07
// `agents-customer/handoff-settings` 489:10446, `-mode-menu`, `-takeover`, `-team-chat`,
// `-unconfirmed`, node labels board `07/_local/handoff node labels` 695:89749).

export type HandoffSettingsView = {
  mode: HandoffMode;
  triggers: {
    priceNotListed: boolean;
    asksForPerson: boolean;
    complaintOrRefund: boolean;
    lowConfidence: boolean;
  };
  recipientName: string | null;
  recipientWhatsapp: string | null;
  recipientConfirmed: boolean;
  expiryMinutes: HandoffExpiryMinutes;
  defaultReply: HandoffReplyMode;
  recipientCanTakeOver: boolean;
  waitingText: string | null;
  ifNobodyAnswers: HandoffIfNobodyAnswers;
};

export type TeamChatGroupView = {
  status: TeamChatGroupStatus;
  subject: string;
  inviteLink: string | null;
};

/** The agent's most recent handoff request; only its end state is shown. */
export type LatestHandoffView = {
  status: HandoffRequestStatus;
  recipientName: string | null;
  handedBackAt: Date | null;
  handBackReason: HandoffHandBackReason | null;
};

export type HandoffPanelData = {
  settings: HandoffSettingsView;
  group: TeamChatGroupView | null;
  latest: LatestHandoffView | null;
};

/** Whether Team chat may be chosen. `unknown` until the worker has answered. */
export type TeamChatAvailability = "available" | "needs_oba" | "unknown";

export const HANDOFF_NEEDS_OBA = "Needs an Official Business Account";

export const HANDOFF_TRIGGER_ROWS = [
  { key: "priceNotListed", label: "Price is not in the price list" },
  { key: "asksForPerson", label: "Customer asks for a person" },
  { key: "complaintOrRefund", label: "Complaint or refund" },
  { key: "lowConfidence", label: "Agent is not sure (below 60% confidence)" },
] as const satisfies readonly { key: keyof HandoffSettingsView["triggers"]; label: string }[];

export const HANDOFF_EXPIRY_OPTIONS: readonly HandoffExpiryMinutes[] = [30, 60, 120, 240];

/** Settings rows store a plain integer; anything off the menu reads as the 2 h default. */
export function toExpiryMinutes(minutes: number): HandoffExpiryMinutes {
  return (HANDOFF_EXPIRY_OPTIONS as readonly number[]).includes(minutes)
    ? (minutes as HandoffExpiryMinutes)
    : 120;
}

export function expiryLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** `+4915112345847` -> `+49 151 •••• 5847`: enough to recognise, not to copy. */
export function maskWhatsapp(number: string): string {
  const digits = number.replace(/^\+/, "");
  if (!/^\d{8,}$/.test(digits)) return number;
  // Display only: NANP (1) and Russia/Kazakhstan (7) have one-digit codes, most others two.
  const cc = /^[17]/.test(digits) ? digits.slice(0, 1) : digits.slice(0, 2);
  const rest = digits.slice(cc.length);
  return `+${cc} ${rest.slice(0, 3)} •••• ${rest.slice(-4)}`;
}

export const HANDOFF_MODE_LABEL: Record<HandoffMode, string> = {
  quick_answer: "Quick answer",
  takeover: "Takeover",
  team_chat: "Team chat",
};

export type HandoffModeOption = {
  value: HandoffMode;
  label: string;
  description: string;
  disabled: boolean;
};

/** The Handoff mode menu (Figma `handoff-settings-mode-menu`). */
export function handoffModeOptions(
  recipientName: string | null,
  teamChat: TeamChatAvailability,
): HandoffModeOption[] {
  const who = firstName(recipientName) ?? "Your recipient";
  return [
    {
      value: "quick_answer",
      label: HANDOFF_MODE_LABEL.quick_answer,
      description: `${who} answers once through a quick link. The agent carries on.`,
      disabled: false,
    },
    {
      value: "takeover",
      label: HANDOFF_MODE_LABEL.takeover,
      description: `${who} takes over the chat live. The agent pauses.`,
      disabled: false,
    },
    {
      value: "team_chat",
      label: HANDOFF_MODE_LABEL.team_chat,
      description:
        teamChat === "needs_oba"
          ? HANDOFF_NEEDS_OBA
          : "Your team answers in a WhatsApp group. The agent rephrases the answer.",
      disabled: teamChat === "needs_oba",
    },
  ];
}

export type HandoffNodeView = {
  title: string;
  expiry: string;
  /** Who answers: a person on WhatsApp, the Team chat group, or a warning in its place. */
  who:
    | { kind: "person"; name: string }
    | { kind: "group"; label: string }
    | { kind: "warning"; label: string; name?: string };
  fallback: string;
};

/** Labels of the Handoff node per mode and recipient state (07 `_local/handoff node labels`). */
export function handoffNodeView(data: Pick<HandoffPanelData, "settings" | "group">): HandoffNodeView {
  const { settings, group } = data;
  const after = expiryLabel(settings.expiryMinutes);
  const fallback = `Fallback: Inbox, if there is no answer in ${after}`;

  if (settings.mode === "team_chat") {
    const ready = group?.status === "active";
    return {
      title: "Human handoff · Team chat",
      expiry: `Expires after ${after}`,
      who: ready
        ? { kind: "group", label: group.subject }
        : { kind: "warning", label: group?.status === "pending" ? "Group is being created" : "Group not set up" },
      fallback: ready ? fallback : "Requests go to the Inbox until the group is ready",
    };
  }

  const title = settings.mode === "takeover" ? "Human handoff · Takeover" : "Human handoff";
  const expiry = `Link expires after ${after}`;
  if (!settings.recipientName && !settings.recipientWhatsapp) {
    return {
      title,
      expiry,
      who: { kind: "warning", label: "No recipient yet" },
      fallback: "Requests go to the Inbox",
    };
  }
  if (!settings.recipientConfirmed) {
    const who = firstName(settings.recipientName) ?? "the recipient";
    return {
      title,
      expiry,
      who: settings.recipientName
        ? { kind: "warning", label: "Recipient not confirmed", name: settings.recipientName }
        : { kind: "warning", label: "Recipient not confirmed" },
      fallback: `Requests go to the Inbox until ${who} confirms`,
    };
  }
  return {
    title,
    expiry,
    who: { kind: "person", name: settings.recipientName ?? maskWhatsapp(settings.recipientWhatsapp ?? "") },
    fallback,
  };
}

/** The Inbox fallback row's hint. */
export function inboxFallbackHint(settings: HandoffSettingsView): string {
  if (settings.mode !== "team_chat" && settings.recipientWhatsapp && !settings.recipientConfirmed) {
    return `until ${firstName(settings.recipientName) ?? "the recipient"} confirms`;
  }
  return `if there is no answer in ${expiryLabel(settings.expiryMinutes)}`;
}

/** The handed-back notice for the agent's latest request; null for any other state. */
export function handedBackNotice(latest: LatestHandoffView | null): string | null {
  if (!latest || latest.status !== "handed_back") return null;
  if (latest.handBackReason === "idle") {
    return `Handed back to the agent after ${HANDOFF_TAKEOVER_IDLE_MINUTES} min with no message. The agent resumed with the full transcript.`;
  }
  const who = firstName(latest.recipientName) ?? "The recipient";
  return `${who} handed the chat back to the agent. The agent resumed with the full transcript.`;
}

/** Editable form state: text fields as strings, as the inputs hold them. */
export type HandoffForm = {
  mode: HandoffMode;
  triggers: HandoffSettingsView["triggers"];
  recipientName: string;
  recipientWhatsapp: string;
  expiryMinutes: HandoffExpiryMinutes;
  defaultReply: HandoffReplyMode;
  recipientCanTakeOver: boolean;
  waitingText: string;
  ifNobodyAnswers: HandoffIfNobodyAnswers;
};

export function handoffFormFromSettings(settings: HandoffSettingsView): HandoffForm {
  return {
    mode: settings.mode,
    triggers: { ...settings.triggers },
    recipientName: settings.recipientName ?? "",
    recipientWhatsapp: settings.recipientWhatsapp ?? "",
    expiryMinutes: settings.expiryMinutes,
    defaultReply: settings.defaultReply,
    recipientCanTakeOver: settings.recipientCanTakeOver,
    waitingText: settings.waitingText ?? "",
    ifNobodyAnswers: settings.ifNobodyAnswers,
  };
}

export function handoffInputFromForm(form: HandoffForm): HandoffSettingsInput {
  return {
    mode: form.mode,
    triggers: { ...form.triggers },
    recipientName: form.recipientName,
    recipientWhatsapp: form.recipientWhatsapp,
    expiryMinutes: form.expiryMinutes,
    defaultReply: form.defaultReply,
    recipientCanTakeOver: form.recipientCanTakeOver,
    waitingText: form.waitingText,
    ifNobodyAnswers: form.ifNobodyAnswers,
  };
}

export function handoffFormDirty(saved: HandoffSettingsView, form: HandoffForm): boolean {
  return JSON.stringify(handoffFormFromSettings(saved)) !== JSON.stringify(form);
}

/** What the "Save changes" toast says after the recipient confirmation step. */
export function confirmationToast(
  outcome: "sent" | "not_needed" | "not_found" | "failed" | "unavailable" | null,
  recipientName: string | null,
): { tone: "success" | "error"; text: string } | null {
  if (outcome === null) return null;
  const who = firstName(recipientName) ?? "the recipient";
  if (outcome === "sent") {
    return { tone: "success", text: `Confirmation sent to ${who} on WhatsApp` };
  }
  return {
    tone: "error",
    text: `Could not send the confirmation to ${who}. Requests go to the Inbox until they confirm.`,
  };
}
