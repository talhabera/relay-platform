"use client";

import { useState } from "react";
import { Mail, MailPlus } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSessionSteer } from "@/components/operator/session-steer";
import { Icon } from "@/components/v2/primitives/icon";
import { IconButton } from "@/components/v2/primitives/icon-button";
import { WorkPaneHeader } from "@/components/v2/session/work-pane-header";
import { EmailStepCard } from "@/components/v2/work/email-step-card";

import {
  accordionLayout,
  dayLabel,
  initialRecipientId,
  mailPaneMeta,
  mailPaneState,
  renderStep,
  renderedPlainText,
  stepChecks,
  stepSummary,
  stepVariables,
  toggleStep,
  type MailSequence,
} from "./mail-pane-model";

export type MailPaneProps = {
  /** Google Workspace (Gmail) connected for the company. */
  gmailConnected: boolean;
  /** Null until the sequence model lands (phase 2); fixtures fill it in dev. */
  sequence: MailSequence | null;
  /** ISO "now" from the server, so "edited 2 min ago" matches between renders. */
  now: string;
  /** Viewer may steer the session (Templates, Add step). */
  canAct: boolean;
  /** Where "Connect Gmail" goes. */
  connectHref?: string;
};

/**
 * Mail work pane (05 session-mail/default): Work pane header, an accordion of
 * Email step cards (one open, full width; the rest in a row with Add step),
 * and "Preview as" that re-renders the open step for a recipient. Without
 * Gmail it is a Connect empty state.
 */
export function MailPane({
  gmailConnected,
  sequence,
  now,
  canAct,
  connectHref = "/settings/connectors",
}: MailPaneProps) {
  const state = mailPaneState({ gmailConnected, sequence });

  return (
    <section
      aria-label="Email sequence"
      data-slot="mail-pane"
      data-state={state}
      className="flex min-h-0 w-full flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-elevation-1"
    >
      {state === "connect" ? (
        <EmptyState
          icon={Mail}
          className="my-auto py-12"
          title="Connect Gmail to send this sequence"
          description="The Mail Marketer drafts the emails here and sends them from your Gmail once you approve. Connect Google Workspace to see the steps."
          action={{ label: "Connect Gmail", href: connectHref }}
        />
      ) : state === "empty" || !sequence ? (
        <EmptyState
          icon={MailPlus}
          className="my-auto py-12"
          title="No sequence yet"
          description="The Mail Marketer writes the sequence in this session. The steps show up here once the first one is drafted."
        />
      ) : (
        <Sequence sequence={sequence} now={now} canAct={canAct} />
      )}
    </section>
  );
}

function Sequence({ sequence, now, canAct }: { sequence: MailSequence; now: string; canAct: boolean }) {
  const steer = useSessionSteer();
  const [openId, setOpenId] = useState<string | null>(() => sequence.steps[0]?.id ?? null);
  const [recipientId, setRecipientId] = useState<string | null>(() => initialRecipientId(sequence));

  const recipient = sequence.recipients.find((r) => r.id === recipientId) ?? null;
  const { open, rest } = accordionLayout(sequence.steps, openId);
  const rendered = open ? renderStep(open.step, recipient) : null;
  const variables = Array.from(new Set(sequence.steps.flatMap(stepVariables)));
  const canSteer = canAct && steer.send !== null;

  function steerWith(text: string) {
    steer.send?.(text);
  }

  async function copyOpenStep() {
    if (!rendered) return;
    try {
      await navigator.clipboard.writeText(renderedPlainText(rendered));
      toast.success("Step copied");
    } catch {
      toast.error("Could not copy the step");
    }
  }

  return (
    <>
      <WorkPaneHeader
        icon="mail"
        title="Email sequence"
        meta={mailPaneMeta(sequence, new Date(now))}
        actions={
          <>
            {canSteer ? (
              <Button
                variant="outline"
                size="md"
                disabled={steer.isStreaming}
                onClick={() => steerWith("Show me the email templates I can start from")}
              >
                <Icon name="file-text" size={16} />
                Templates
              </Button>
            ) : null}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="md">
                  <Icon name="braces" size={16} />
                  Variables
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <p className="type-small text-muted-foreground">
                  {recipient ? `Values for ${recipient.label}` : "Variables in this sequence"}
                </p>
                <dl data-slot="mail-variables" className="mt-2 flex flex-col gap-1">
                  {variables.map((name) => (
                    <div key={name} className="flex items-baseline justify-between gap-3 type-small">
                      <dt className="font-mono text-muted-foreground">{name}</dt>
                      <dd className="min-w-0 truncate text-foreground">{recipient?.values[name] ?? "Missing"}</dd>
                    </div>
                  ))}
                </dl>
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon="ellipsis" variant="outline" label="More" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!rendered} onSelect={() => void copyOpenStep()}>
                  Copy open step
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div data-slot="mail-sequence" className="flex min-h-0 flex-col gap-2 overflow-auto">
        {open && rendered ? (
          <EmailStepCard
            stepNumber={open.number}
            day={dayLabel(open.step.day)}
            subject={rendered.subject}
            expanded
            onExpandedChange={() => setOpenId((id) => toggleStep(id, open.step.id))}
            previewOptions={sequence.recipients.map((r) => ({ value: r.id, label: r.label }))}
            previewValue={recipientId ?? undefined}
            onPreviewChange={setRecipientId}
            body={rendered.body}
            checks={stepChecks(open.step, rendered)}
          />
        ) : null}

        <div data-slot="mail-next-steps" className="flex flex-col gap-2 md:flex-row md:items-stretch">
          {rest.map(({ step, number }) => (
            <EmailStepCard
              key={step.id}
              className="min-w-0 md:flex-1"
              stepNumber={number}
              day={dayLabel(step.day)}
              subject={stepSummary(step, recipient)}
              onExpandedChange={() => setOpenId((id) => toggleStep(id, step.id))}
            />
          ))}
          {canSteer ? (
            <Button
              variant="outline"
              size="md"
              className="h-auto min-h-10 shrink-0 self-stretch"
              disabled={steer.isStreaming}
              onClick={() => steerWith("Add a step to the email sequence")}
            >
              <Icon name="plus" size={16} />
              Add step
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
