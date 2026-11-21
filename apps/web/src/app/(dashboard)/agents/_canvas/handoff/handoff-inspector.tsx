"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BrandGlyph, Icon, IconButton, StatusChip } from "@/components/v2/primitives";
import { initials } from "@/components/v2/shell/initials";
import { updateHandoffSettings } from "@/lib/handoff/actions";
import { handoffSettingsSchema } from "@/lib/handoff/validators";
import type { TeamChatGroupOutcome } from "@/lib/worker-proxy";
import { cn } from "@/lib/utils";

import { getTeamChatAvailability, resendRecipientConfirmation, setUpTeamChatGroup } from "./actions";
import {
  confirmationToast,
  expiryLabel,
  firstName,
  handedBackNotice,
  HANDOFF_EXPIRY_OPTIONS,
  HANDOFF_MODE_LABEL,
  HANDOFF_NEEDS_OBA,
  HANDOFF_TRIGGER_ROWS,
  handoffFormDirty,
  handoffFormFromSettings,
  handoffInputFromForm,
  handoffModeOptions,
  inboxFallbackHint,
  maskWhatsapp,
  type HandoffForm,
  type HandoffPanelData,
  type TeamChatAvailability,
  type TeamChatGroupView,
} from "./handoff-model";

type HandoffInspectorProps = {
  agentId: string;
  agentName: string;
  data: HandoffPanelData;
  /** Owner only: edit and save. */
  canManage: boolean;
  onClose: () => void;
  onTestChat: () => void;
};

/**
 * Handoff settings inspector (Figma 07 `agents-customer/handoff-settings` 489:10446, with the
 * `-mode-menu`, `-takeover`, `-team-chat` and `-unconfirmed` variants): Handoff mode, the four
 * trigger toggles, who answers (primary recipient or the Team chat group, with the Inbox as
 * fallback), link expiry and reply options, the waiting text and the expiry message.
 */
export function HandoffInspector({ agentId, agentName, data, canManage, onClose, onTestChat }: HandoffInspectorProps) {
  const router = useRouter();
  const [form, setForm] = React.useState<HandoffForm>(() => handoffFormFromSettings(data.settings));
  const [group, setGroup] = React.useState<TeamChatGroupView | null>(data.group);
  const [teamChat, setTeamChat] = React.useState<TeamChatAvailability>(
    data.group && data.group.status !== "failed" ? "available" : "unknown",
  );
  const [editingRecipient, setEditingRecipient] = React.useState(
    !data.settings.recipientName && !data.settings.recipientWhatsapp,
  );
  const [saving, startSaving] = React.useTransition();
  const [working, startWorking] = React.useTransition();

  React.useEffect(() => {
    if (!canManage || teamChat !== "unknown") return;
    let cancelled = false;
    getTeamChatAvailability(agentId)
      .then((next) => {
        if (!cancelled) setTeamChat(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentId, canManage, teamChat]);

  const parsed = handoffSettingsSchema.safeParse(handoffInputFromForm(form));
  const numberError = parsed.success
    ? null
    : (parsed.error.issues.find((i) => i.path[0] === "recipientWhatsapp")?.message ?? null);
  const dirty = handoffFormDirty(data.settings, form);
  const canSave = canManage && dirty && parsed.success && !saving;
  const isTeamChat = form.mode === "team_chat";
  const recipientName = form.recipientName.trim() || null;
  const recipientFirst = firstName(recipientName) ?? "the recipient";
  const numberChanged = form.recipientWhatsapp.replace(/[\s-]/g, "") !== (data.settings.recipientWhatsapp ?? "");
  const confirmed = data.settings.recipientConfirmed && !numberChanged;
  const handedBack = handedBackNotice(data.latest);

  const patch = (next: Partial<HandoffForm>) => setForm((f) => ({ ...f, ...next }));

  function save() {
    startSaving(async () => {
      try {
        const result = await updateHandoffSettings(agentId, handoffInputFromForm(form));
        toast.success("Handoff settings saved");
        const note = confirmationToast(result.confirmation, recipientName);
        if (note) (note.tone === "success" ? toast.success : toast.error)(note.text);
        setEditingRecipient(false);
        router.refresh();
      } catch {
        toast.error("Could not save the handoff settings");
      }
    });
  }

  function resend() {
    startWorking(async () => {
      const outcome = await resendRecipientConfirmation(agentId).catch(() => "failed" as const);
      const note = confirmationToast(outcome, recipientName);
      if (note) (note.tone === "success" ? toast.success : toast.error)(note.text);
    });
  }

  function applyGroupOutcome(outcome: TeamChatGroupOutcome) {
    const subject = group?.subject ?? `${agentName} handoff`;
    switch (outcome.status) {
      case "active":
        setGroup({ status: "active", subject, inviteLink: outcome.inviteLink });
        setTeamChat("available");
        return;
      case "pending":
        setGroup({ status: "pending", subject, inviteLink: null });
        setTeamChat("available");
        toast("WhatsApp is creating the group. The invite link appears here when it is ready.");
        return;
      case "needs_oba":
      case "no_sender":
        setTeamChat("needs_oba");
        if (data.settings.mode !== "team_chat") patch({ mode: data.settings.mode });
        toast.error(`Team chat: ${HANDOFF_NEEDS_OBA}`);
        return;
      default:
        toast.error("Could not set up the Team chat group. Try again in a moment.");
    }
  }

  function setUpGroup() {
    startWorking(async () => {
      try {
        applyGroupOutcome(await setUpTeamChatGroup(agentId));
        router.refresh();
      } catch {
        toast.error("Could not set up the Team chat group. Try again in a moment.");
      }
    });
  }

  function copyInviteLink(link: string) {
    navigator.clipboard.writeText(link).then(
      () => toast.success("Invite link copied"),
      () => toast.error("Could not copy the link"),
    );
  }

  return (
    <aside
      data-slot="handoff-inspector"
      data-mode={form.mode}
      aria-label={`Human handoff for ${agentName}`}
      className="flex w-full max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevation-2 lg:w-[440px] lg:self-stretch"
    >
      <header className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon name="hand-helping" size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate type-body-strong text-foreground">Human handoff</h2>
          <span className="truncate type-caption text-muted-foreground">{agentName} · customer agent</span>
        </div>
        <IconButton icon="x" label="Close handoff settings" size="sm" onClick={onClose} />
      </header>

      <div data-slot="inspector-content" className="flex flex-1 flex-col gap-2 overflow-y-auto px-5 py-3">
        <Row label="Handoff mode">
          <ModeMenu
            value={form.mode}
            recipientName={recipientName}
            teamChat={teamChat}
            disabled={!canManage}
            onChange={(mode) => {
              patch({ mode });
              if (mode === "team_chat" && !group && canManage) setUpGroup();
            }}
          />
        </Row>

        <SectionLabel>When to hand off</SectionLabel>
        {HANDOFF_TRIGGER_ROWS.map((row) => (
          <Row key={row.key} label={row.label} htmlFor={`handoff-trigger-${row.key}`}>
            <Switch
              id={`handoff-trigger-${row.key}`}
              checked={form.triggers[row.key]}
              disabled={!canManage}
              onCheckedChange={(on) => patch({ triggers: { ...form.triggers, [row.key]: on } })}
            />
          </Row>
        ))}

        {isTeamChat ? (
          <>
            <SectionLabel>Team chat group</SectionLabel>
            <TeamChatGroupCard
              group={group}
              teamChat={teamChat}
              canManage={canManage}
              working={working}
              onSetUp={setUpGroup}
              onCopy={copyInviteLink}
            />
            <InboxFallbackRow hint={inboxFallbackHint({ ...data.settings, mode: "team_chat", expiryMinutes: form.expiryMinutes })} />
            <Row label="Question expires after">
              <ExpirySelect value={form.expiryMinutes} disabled={!canManage} onChange={(expiryMinutes) => patch({ expiryMinutes })} />
            </Row>
          </>
        ) : (
          <>
            <SectionLabel>Who answers</SectionLabel>
            {editingRecipient || !canManage ? null : (
              <RecipientCard
                name={recipientName}
                whatsapp={form.recipientWhatsapp}
                confirmed={confirmed}
                pendingSave={numberChanged}
                working={working}
                onEdit={() => setEditingRecipient(true)}
                onResend={resend}
              />
            )}
            {editingRecipient && canManage ? (
              <div data-slot="handoff-recipient-editor" className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <label className="flex flex-col gap-1">
                  <span className="type-caption text-muted-foreground">Name</span>
                  <Input
                    value={form.recipientName}
                    onChange={(e) => patch({ recipientName: e.target.value })}
                    placeholder="Markus Albrecht · Sales"
                    maxLength={120}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="type-caption text-muted-foreground">WhatsApp number</span>
                  <Input
                    value={form.recipientWhatsapp}
                    onChange={(e) => patch({ recipientWhatsapp: e.target.value })}
                    placeholder="+49 151 23456789"
                    inputMode="tel"
                    aria-invalid={numberError ? true : undefined}
                  />
                  {numberError ? <span className="type-caption text-destructive">{numberError}</span> : null}
                </label>
                <p className="type-caption text-muted-foreground">
                  Saving a new number sends a one-time WhatsApp message to confirm. Until then, requests go to the Inbox.
                </p>
              </div>
            ) : null}
            {!canManage && !recipientName && !form.recipientWhatsapp ? (
              <p className="type-small text-muted-foreground">No recipient yet. Requests go to the Inbox.</p>
            ) : null}
            {!canManage && (recipientName || form.recipientWhatsapp) ? (
              <RecipientCard name={recipientName} whatsapp={form.recipientWhatsapp} confirmed={confirmed} />
            ) : null}
            <InboxFallbackRow
              hint={inboxFallbackHint({
                ...data.settings,
                recipientName,
                recipientConfirmed: confirmed,
                expiryMinutes: form.expiryMinutes,
              })}
            />

            <SectionLabel>Link</SectionLabel>
            <Row label="Expires after">
              <ExpirySelect value={form.expiryMinutes} disabled={!canManage} onChange={(expiryMinutes) => patch({ expiryMinutes })} />
            </Row>
            {form.mode === "takeover" ? (
              <>
                <Row label="Hands back to the agent">
                  <span className="type-caption text-muted-foreground">after 30 min with no message</span>
                </Row>
                <p className="type-caption text-muted-foreground">
                  {firstName(recipientName) ?? "The recipient"} writes to the customer live and the agent pauses. The
                  agent resumes with the full transcript.
                </p>
              </>
            ) : (
              <>
                <Row label="Recipient can take over the chat" htmlFor="handoff-can-take-over">
                  <Switch
                    id="handoff-can-take-over"
                    checked={form.recipientCanTakeOver}
                    disabled={!canManage}
                    onCheckedChange={(recipientCanTakeOver) => patch({ recipientCanTakeOver })}
                  />
                </Row>
                <Row label="Default reply">
                  <Select
                    value={form.defaultReply}
                    disabled={!canManage}
                    onValueChange={(v) => patch({ defaultReply: v as HandoffForm["defaultReply"] })}
                  >
                    <SelectTrigger size="sm" aria-label="Default reply">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="agent">Let the agent phrase it</SelectItem>
                      <SelectItem value="person">Send as {recipientFirst}</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
              </>
            )}
          </>
        )}

        {handedBack ? (
          <div
            data-slot="handoff-handed-back"
            className="mt-1 flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3"
          >
            <Icon name="history" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="type-small font-medium text-foreground">Latest handoff</span>
                <StatusChip tone="neutral">Handed back</StatusChip>
              </span>
              <span className="type-caption text-muted-foreground">{handedBack}</span>
            </div>
          </div>
        ) : null}

        <SectionLabel>Customer sees while waiting</SectionLabel>
        <Textarea
          aria-label="Customer sees while waiting"
          value={form.waitingText}
          onChange={(e) => patch({ waitingText: e.target.value })}
          readOnly={!canManage}
          maxLength={500}
          rows={2}
          placeholder="A colleague will get back to you in a few minutes."
          className="type-body"
        />

        <SectionLabel>{isTeamChat ? "If nobody answers" : "If the link expires"}</SectionLabel>
        <Select
          value={form.ifNobodyAnswers}
          disabled={!canManage}
          onValueChange={(v) => patch({ ifNobodyAnswers: v as HandoffForm["ifNobodyAnswers"] })}
        >
          <SelectTrigger className="w-full" aria-label={isTeamChat ? "If nobody answers" : "If the link expires"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reply_here">Tell the customer the team will reply here</SelectItem>
            <SelectItem value="reply_by_email">Tell the customer the team will reply by email</SelectItem>
          </SelectContent>
        </Select>

        {!canManage ? (
          <p className="pt-1 type-small text-muted-foreground">Only the company owner can change handoff settings.</p>
        ) : null}
      </div>

      <footer data-slot="inspector-footer" className="flex items-start gap-3 border-t border-border px-5 py-4">
        <Button variant="outline" size="md" className="min-w-0 flex-1" onClick={onTestChat}>
          Test chat
        </Button>
        <Button size="md" className="min-w-0 flex-1" onClick={save} disabled={!canSave}>
          Save changes
        </Button>
      </footer>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="pt-2 type-label text-muted-foreground">{children}</span>;
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="min-w-0 type-body text-foreground">
          {label}
        </label>
      ) : (
        <span className="min-w-0 type-body text-foreground">{label}</span>
      )}
      {children}
    </div>
  );
}

function ExpirySelect({
  value,
  disabled,
  onChange,
}: {
  value: HandoffForm["expiryMinutes"];
  disabled: boolean;
  onChange: (value: HandoffForm["expiryMinutes"]) => void;
}) {
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(v) => onChange(Number(v) as HandoffForm["expiryMinutes"])}
    >
      <SelectTrigger size="sm" aria-label="Expires after">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {HANDOFF_EXPIRY_OPTIONS.map((m) => (
          <SelectItem key={m} value={String(m)}>
            {expiryLabel(m)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModeMenu({
  value,
  recipientName,
  teamChat,
  disabled,
  onChange,
}: {
  value: HandoffForm["mode"];
  recipientName: string | null;
  teamChat: TeamChatAvailability;
  disabled: boolean;
  onChange: (mode: HandoffForm["mode"]) => void;
}) {
  const options = handoffModeOptions(recipientName, teamChat);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="outline" size="sm" aria-label={`Handoff mode: ${HANDOFF_MODE_LABEL[value]}`}>
          {HANDOFF_MODE_LABEL[value]}
          <Icon name="chevron-down" size={16} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[300px]">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            disabled={o.disabled}
            data-mode={o.value}
            onSelect={() => onChange(o.value)}
            className="flex items-start gap-2 py-2"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="type-body text-foreground">{o.label}</span>
              <span className="type-caption text-muted-foreground">{o.description}</span>
            </span>
            {o.disabled ? (
              <Icon name="lock" size={16} className="mt-0.5 text-muted-foreground" />
            ) : o.value === value ? (
              <Icon name="check" size={16} className="mt-0.5 text-foreground" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RecipientCard({
  name,
  whatsapp,
  confirmed,
  pendingSave = false,
  working = false,
  onEdit,
  onResend,
}: {
  name: string | null;
  whatsapp: string;
  confirmed: boolean;
  /** The number changed in the form and is not saved yet. */
  pendingSave?: boolean;
  working?: boolean;
  onEdit?: () => void;
  onResend?: () => void;
}) {
  const label = name ?? (whatsapp ? maskWhatsapp(whatsapp) : "Recipient");
  return (
    <div
      data-slot="handoff-recipient"
      data-confirmed={confirmed ? "true" : "false"}
      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
    >
      <span
        aria-hidden
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft type-caption text-primary-soft-foreground"
      >
        {initials(label)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-body-strong text-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-1 type-caption text-muted-foreground">
          <BrandGlyph brand="whatsapp" size={16} />
          {confirmed || !whatsapp ? (
            <span className="truncate">WhatsApp {whatsapp ? maskWhatsapp(whatsapp) : "number missing"}</span>
          ) : pendingSave ? (
            <span className="truncate">Confirmation is sent when you save</span>
          ) : (
            <span className="truncate">
              Confirmation sent
              {onResend ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                    onClick={onResend}
                    disabled={working}
                  >
                    Resend
                  </button>
                </>
              ) : null}
            </span>
          )}
        </span>
      </div>
      {confirmed ? (
        <StatusChip tone="live" dot={false}>
          Primary
        </StatusChip>
      ) : (
        <StatusChip tone="pending" className="uppercase">
          Not confirmed
        </StatusChip>
      )}
      {onEdit ? <IconButton icon="pencil" label="Edit recipient" size="sm" onClick={onEdit} /> : null}
    </div>
  );
}

function InboxFallbackRow({ hint }: { hint: string }) {
  return (
    <div data-slot="handoff-inbox-fallback" className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon name="inbox" size={14} className="text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="type-body-strong text-foreground">Inbox</span>{" "}
        <span className="type-caption text-muted-foreground">{hint}</span>
      </span>
      <StatusChip tone="neutral" dot={false}>
        Fallback
      </StatusChip>
    </div>
  );
}

function TeamChatGroupCard({
  group,
  teamChat,
  canManage,
  working,
  onSetUp,
  onCopy,
}: {
  group: TeamChatGroupView | null;
  teamChat: TeamChatAvailability;
  canManage: boolean;
  working: boolean;
  onSetUp: () => void;
  onCopy: (link: string) => void;
}) {
  const active = group?.status === "active";
  return (
    <div data-slot="handoff-team-chat" data-status={group?.status ?? "none"} className="flex flex-col gap-2">
      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <Icon name="users" size={14} className="text-muted-foreground" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body-strong text-foreground">{group?.subject ?? "WhatsApp group"}</span>
          <span className="flex min-w-0 items-center gap-1 type-caption text-muted-foreground">
            <BrandGlyph brand="whatsapp" size={16} />
            <span className="truncate">WhatsApp group · up to 8 participants</span>
          </span>
        </div>
        {active ? (
          <StatusChip tone="live" dot={false}>
            Active
          </StatusChip>
        ) : group?.status === "pending" ? (
          <StatusChip tone="pending">Creating</StatusChip>
        ) : group?.status === "failed" ? (
          <StatusChip tone="error">Failed</StatusChip>
        ) : null}
      </div>

      {active && group.inviteLink ? (
        <div data-slot="handoff-invite-link" className="flex items-center gap-2">
          <Input readOnly value={group.inviteLink} aria-label="Group invite link" className="min-w-0 flex-1" />
          <Button variant="outline" size="md" onClick={() => onCopy(group.inviteLink as string)}>
            Copy link
          </Button>
        </div>
      ) : null}

      {teamChat === "needs_oba" && !active ? (
        <p className="type-caption text-muted-foreground">
          {HANDOFF_NEEDS_OBA}. Requests go to the Inbox until the company&apos;s WhatsApp sender is verified.
        </p>
      ) : !group || group.status === "failed" || (active && !group.inviteLink) ? (
        canManage ? (
          <Button variant="outline" size="md" className="w-full" onClick={onSetUp} disabled={working}>
            {group ? "Set up the group again" : "Create group"}
          </Button>
        ) : null
      ) : null}

      <p className={cn("type-caption text-muted-foreground")}>
        People join through the invite link, up to 8. The first reply that quotes the agent&apos;s question is the
        answer; other messages are ignored.
      </p>
    </div>
  );
}
