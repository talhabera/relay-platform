"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateIntegration } from "@/app/(dashboard)/agents/actions";
import { CreateIntegrationForm } from "@/components/agent/integrations-tab";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ToolToggleRow } from "@/components/v2/canvas";

import type { AgentsCanvasSelection } from "./agents-canvas-model";
import { INSTRUCTIONS_MAX, instructionsMeta, integrationRows } from "./inspector-model";

type InstructionsSectionProps = {
  selection: AgentsCanvasSelection;
  draft: string;
  onDraftChange: (value: string) => void;
  canManage: boolean;
};

/**
 * Inspector Instructions tab (Figma 07 `agents-customer/instructions`, 411:31861): the agent's
 * instructions in a tall textarea, saved with the footer Save changes.
 */
export function InstructionsSection({ selection, draft, onDraftChange, canManage }: InstructionsSectionProps) {
  const id = React.useId();
  return (
    <div data-slot="inspector-instructions" className="flex flex-col gap-2 pt-2">
      <label htmlFor={id} className="sr-only">
        Instructions for {selection.name}
      </label>
      <Textarea
        id={id}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        readOnly={!canManage}
        maxLength={INSTRUCTIONS_MAX}
        rows={12}
        placeholder={`Tell ${selection.name} who it answers for, what it should ask and when to hand off to a person.`}
        className="min-h-60 resize-y type-body"
      />
      <span className="type-caption text-muted-foreground" suppressHydrationWarning>
        {instructionsMeta(draft === selection.instructions ? selection.instructionsSavedAt : undefined, draft.length)}
      </span>
      {!canManage ? (
        <p className="type-small text-muted-foreground">Only the company owner can edit instructions.</p>
      ) : null}
    </div>
  );
}

type IntegrationsSectionProps = {
  selection: AgentsCanvasSelection;
  companyId: string;
  canManage: boolean;
};

/**
 * Inspector Integrations tab (Figma 07 `agents-customer/integrations`, 411:37385): tool toggle
 * rows. Knowledge base search is built in; company integrations toggle connected / disconnected
 * as they change. Owners add one in a dialog.
 */
export function IntegrationsSection({ selection, companyId, canManage }: IntegrationsSectionProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [adding, setAdding] = React.useState(false);

  function toggle(id: string, label: string, on: boolean) {
    startTransition(async () => {
      try {
        await updateIntegration(id, { status: on ? "connected" : "disconnected" });
        toast.success(on ? `${label} is on` : `${label} is off`);
        router.refresh();
      } catch {
        toast.error(`Could not update ${label}`);
      }
    });
  }

  return (
    <div data-slot="inspector-integrations" className="flex flex-col gap-1 pt-1">
      {integrationRows(selection.integrations).map((row) => (
        <ToolToggleRow
          key={row.id}
          className="px-0"
          label={row.label}
          icon={row.icon}
          state={row.on ? "on" : "off"}
          disabled={row.builtin || !canManage || pending}
          title={row.builtin ? "Always on for customer agents" : undefined}
          onCheckedChange={row.builtin ? undefined : (on) => toggle(row.id, row.label, on)}
        />
      ))}
      {canManage ? (
        <>
          <Button variant="outline" size="md" className="mt-2 w-full" onClick={() => setAdding(true)}>
            Add integration
          </Button>
          <Dialog open={adding} onOpenChange={setAdding}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add integration</DialogTitle>
                <DialogDescription>Connect a service {selection.name} can use.</DialogDescription>
              </DialogHeader>
              {adding ? (
                <CreateIntegrationForm
                  companyId={companyId}
                  agentId={selection.agentId}
                  onSuccess={() => setAdding(false)}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
