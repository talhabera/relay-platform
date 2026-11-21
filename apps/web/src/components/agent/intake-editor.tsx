"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { WorkflowIntakeField } from "@relay/db";
import { updateAgentLeadIntake } from "@/app/(dashboard)/agents/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Chip, Icon, IconButton } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import {
  INTAKE_FIELDS_MAX,
  INTAKE_LABEL_MAX,
  intakeEditorSubtitle,
  intakeFromDraft,
  moveIntakeField,
  toIntakeDraft,
  type IntakeDraftField,
} from "./lead-capture-model";

type IntakeEditorProps = {
  agentId: string;
  workflowName: string;
  /** Customer agents feeding the workflow; the intake is shared by all of them. */
  sharedBy: number;
  intake: readonly WorkflowIntakeField[];
  onClose: () => void;
};

const HINT =
  "The customer agent asks for these in order and writes the answers onto the lead. The qualify agent scores against the same fields. A lead is intake complete when every required field is filled.";

/**
 * Intake editor (Figma 07 `agents-customer/lead-capture-editing-intake` 698:89422): replaces the
 * customer inspector while open. Phone is locked first (from the channel, never asked); the other
 * fields are renamed, reordered by drag or arrow keys on the handle, marked required, removed or
 * added. Save intake writes the workflow's list, shared by every agent that feeds it.
 */
export function IntakeEditor({ agentId, workflowName, sharedBy, intake, onClose }: IntakeEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<IntakeDraftField[]>(() => toIntakeDraft(intake));
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [saving, startSaving] = React.useTransition();
  const nextId = React.useRef(0);

  const update = (id: string, patch: Partial<IntakeDraftField>) =>
    setDraft((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  function addField() {
    nextId.current += 1;
    setDraft((rows) => [...rows, { id: `new:${nextId.current}`, key: null, label: "", required: false }]);
  }

  function save() {
    const result = intakeFromDraft(draft);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    startSaving(async () => {
      try {
        await updateAgentLeadIntake(agentId, result.fields);
        toast.success("Intake saved");
        router.refresh();
        onClose();
      } catch {
        toast.error("Could not save the intake");
      }
    });
  }

  return (
    <aside
      data-slot="intake-editor"
      aria-label="Intake editor"
      className="flex w-full max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevation-2 lg:w-[400px] lg:self-stretch"
    >
      <div className="flex w-full items-center gap-3 border-b border-border px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon name="clipboard-check" size={18} className="text-primary" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body font-medium text-foreground">Intake</span>
          <span className="truncate type-caption text-muted-foreground">
            {intakeEditorSubtitle(workflowName, sharedBy)}
          </span>
        </div>
        <IconButton icon="x" label="Close intake editor" size="sm" onClick={onClose} />
      </div>

      <div className="flex w-full flex-1 flex-col gap-2 overflow-y-auto p-5">
        <p className="type-small text-muted-foreground">{HINT}</p>
        <div className="mt-1 grid grid-cols-[16px_minmax(0,1fr)_112px_32px] items-center gap-2 type-label text-muted-foreground">
          <span />
          <span>Field (asked in this order)</span>
          <span>Required</span>
          <span />
        </div>
        <ol className="flex flex-col gap-1.5">
          <li data-slot="intake-field" data-locked="" className="grid grid-cols-[16px_minmax(0,1fr)_112px_32px] items-center gap-2">
            <Icon name="lock" size={16} className="text-muted-foreground" />
            <Input value="Phone" readOnly aria-label="Phone (from the channel)" />
            <Chip asStatic size="sm" className="w-fit">
              From channel
            </Chip>
            <span />
          </li>
          {draft.map((row, index) => (
            <li
              key={row.id}
              data-slot="intake-field"
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) setDraft((rows) => moveIntakeField(rows, dragFrom, index));
                setDragFrom(null);
              }}
              className={cn(
                "grid grid-cols-[16px_minmax(0,1fr)_112px_32px] items-center gap-2 rounded-md",
                dragFrom === index && "opacity-50",
              )}
            >
              <span
                role="button"
                tabIndex={0}
                draggable
                aria-label={`Move ${row.label || "field"}; use the arrow keys`}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragFrom(index);
                }}
                onDragEnd={() => setDragFrom(null)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  setDraft((rows) => moveIntakeField(rows, index, index + (e.key === "ArrowUp" ? -1 : 1)));
                }}
                className="flex cursor-grab items-center justify-center rounded-sm outline-none focus-visible:shadow-focus-ring"
              >
                <Icon name="grip-vertical" size={16} className="text-muted-foreground" />
              </span>
              <Input
                value={row.label}
                onChange={(e) => update(row.id, { label: e.target.value })}
                maxLength={INTAKE_LABEL_MAX}
                placeholder="Field name"
                aria-label={`Field ${index + 1} name`}
              />
              <label className="flex items-center gap-2 type-body text-foreground">
                <Checkbox
                  checked={row.required}
                  onCheckedChange={(checked) => update(row.id, { required: checked === true })}
                  aria-label={`${row.label || "Field"} required`}
                />
                Required
              </label>
              <IconButton
                icon="x"
                size="sm"
                label={`Remove ${row.label || "field"}`}
                onClick={() => setDraft((rows) => rows.filter((r) => r.id !== row.id))}
              />
            </li>
          ))}
        </ol>
        <Button
          variant="outline"
          size="sm"
          className="mt-1 w-full"
          onClick={addField}
          disabled={draft.length >= INTAKE_FIELDS_MAX}
        >
          Add field
        </Button>
      </div>

      <div className="flex w-full items-start gap-3 border-t border-border px-5 py-4">
        <Button variant="outline" size="md" className="min-w-0 flex-1" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button size="md" className="min-w-0 flex-1" onClick={save} disabled={saving || draft.length === 0}>
          Save intake
        </Button>
      </div>
    </aside>
  );
}
