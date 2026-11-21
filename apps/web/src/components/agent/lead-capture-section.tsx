"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateAgentLeadCapture } from "@/app/(dashboard)/agents/actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToolToggleRow } from "@/components/v2/canvas";
import { Chip, Icon } from "@/components/v2/primitives";

import { LeadNotifyForm } from "./lead-notify-form";
import { intakeSummary, intakeTitle, type LeadCapturePanelData } from "./lead-capture-model";

type LeadCaptureSectionProps = {
  agentId: string;
  data: LeadCapturePanelData;
  /** Owner only: toggle, pick the workflow, edit the intake and the notify number. */
  canManage: boolean;
  /** Opens the intake editor (Figma 07 `lead-capture-editing-intake`) in place of the inspector. */
  onEditIntake: () => void;
};

const HINT_ON =
  "Records a lead only when the person is a prospect. Support chats never become leads. Phone comes from the channel, never asked.";
const HINT_OFF =
  "Off: this agent answers and hands off, but never creates leads. Turn on to send prospects to the Lead engine.";

/**
 * Customer inspector Lead capture group under Bound sources (Figma 07 `agents-customer/lead-capture-on`
 * 698:88502, `lead-capture-off` 708:95861): the record_lead toggle, then (on) the workflow the
 * leads feed, its inbound stage, the intake card and the qualified-lead WhatsApp number.
 * The toggle and the workflow save as they change.
 */
export function LeadCaptureSection({ agentId, data, canManage, onEditIntake }: LeadCaptureSectionProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [enabled, setEnabled] = React.useState(data.enabled);
  const [workflowId, setWorkflowId] = React.useState(data.workflowId);
  const workflow = data.workflows.find((w) => w.id === workflowId) ?? null;

  function save(next: { enabled: boolean; workflowId: string | null }, done: string) {
    const prev = { enabled, workflowId };
    setEnabled(next.enabled);
    setWorkflowId(next.workflowId);
    startTransition(async () => {
      try {
        await updateAgentLeadCapture(agentId, next);
        toast.success(done);
        router.refresh();
      } catch {
        setEnabled(prev.enabled);
        setWorkflowId(prev.workflowId);
        toast.error("Could not update Lead capture");
      }
    });
  }

  return (
    <div data-slot="lead-capture" data-state={enabled ? "on" : "off"} className="mt-1 flex flex-col border-t border-border">
      <span className="pt-4 type-label text-muted-foreground">Lead capture</span>
      <ToolToggleRow
        className="mt-2 px-0"
        label="Create leads from conversations"
        icon="magnet"
        state={enabled ? "on" : "off"}
        disabled={!canManage || pending}
        onCheckedChange={(on) => save({ enabled: on, workflowId }, on ? "Lead capture is on" : "Lead capture is off")}
      />
      <p className="mt-2 type-caption text-muted-foreground">{enabled ? HINT_ON : HINT_OFF}</p>

      {enabled ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="type-body text-foreground">Feeds workflow</span>
            {data.workflows.length > 0 ? (
              <Select
                value={workflowId ?? undefined}
                onValueChange={(id) =>
                  save(
                    { enabled, workflowId: id },
                    `Leads feed ${data.workflows.find((w) => w.id === id)?.name ?? "the workflow"}`,
                  )
                }
                disabled={!canManage || pending}
              >
                <SelectTrigger size="sm" className="w-[170px]" aria-label="Feeds workflow">
                  <SelectValue placeholder="Pick a workflow" />
                </SelectTrigger>
                <SelectContent>
                  {data.workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="type-small text-muted-foreground">No workflows yet</span>
            )}
          </div>
          {workflow ? (
            <div className="flex items-center justify-between gap-3">
              <span className="type-body text-foreground">Enters at stage</span>
              <Chip asStatic size="sm" icon="workflow">
                {workflow.stageName ?? "First stage"}
              </Chip>
            </div>
          ) : null}
          <div
            data-slot="lead-intake"
            className="flex items-center gap-3 rounded-lg border border-border bg-background py-2 pr-2 pl-3"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
              <Icon name="clipboard-check" size={14} className="text-muted-foreground" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate type-body font-medium text-foreground">{intakeTitle(workflow?.name)}</span>
              <span className="truncate type-caption text-muted-foreground">{intakeSummary(data.intake)}</span>
            </div>
            {canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onEditIntake}
                disabled={!workflow || pending}
                title={workflow ? undefined : "Pick a workflow to edit its intake"}
              >
                Edit intake
              </Button>
            ) : null}
          </div>
          {canManage ? (
            <div className="flex flex-col gap-1 pt-1">
              <span className="type-body text-foreground">Notify on WhatsApp</span>
              <span className="type-caption text-muted-foreground">
                Qualified leads are sent to this number. Leave empty to turn notifications off.
              </span>
              <LeadNotifyForm agentId={agentId} initialNumber={data.notifyWhatsapp} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
