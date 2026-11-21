"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createOperatorAgentFromDialog } from "@/app/(dashboard)/operator/actions";
import { FieldError } from "@/components/agent/create-agent-dialog";
import {
  MODEL_OPTIONS,
  OPERATOR_ROSTER,
  modelLabel,
  operatorRole,
  type AgentModel,
  type OperatorRoleId,
} from "@/components/agent/agent-templates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Icon, Segmented } from "@/components/v2/primitives";
import { createOperatorAgentDialogSchema } from "@/lib/validators/operator";

type StartFrom = "blank" | "predefined";

/**
 * Create operator agent (Figma 07 `agents-operator/create-agent` 600:81042): Name + Model,
 * Description, Start from Blank / Pre-defined (roster of five roles with their default model).
 * Picking a role fills name, description and model; its instructions go into v1. No source picker.
 */
export function CreateOperatorAgentDialog({
  companyId,
  variant = "default",
}: {
  companyId: string;
  variant?: "default" | "ghost";
}) {
  const router = useRouter();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [model, setModel] = React.useState<AgentModel>("sonnet");
  const [startFrom, setStartFrom] = React.useState<StartFrom>("blank");
  const [role, setRole] = React.useState<OperatorRoleId | null>(null);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setName("");
    setDescription("");
    setModel("sonnet");
    setStartFrom("blank");
    setRole(null);
    setNameError(null);
  }

  function pickRole(next: OperatorRoleId) {
    const picked = operatorRole(next);
    if (!picked) return;
    setRole(next);
    setName(picked.name);
    setDescription(picked.description);
    setModel(picked.model);
    setNameError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createOperatorAgentDialogSchema.safeParse({
      companyId,
      name,
      description,
      model,
      role: startFrom === "predefined" ? role : null,
    });
    if (!parsed.success) {
      setNameError(parsed.error.issues.find((i) => i.path[0] === "name")?.message ?? "Check the form.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createOperatorAgentFromDialog(parsed.data);
      toast.success(`${parsed.data.name} created`);
      setOpen(false);
      reset();
      router.push(`/agents/operator?agent=${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the operator agent");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant === "ghost" ? "ghost" : "default"}>
          <Icon name="plus" size={16} />
          Create operator agent
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]" showCloseButton={false}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create operator agent</DialogTitle>
            <DialogDescription>
              Add a new operator agent for your team to use. The kind cannot be changed after the agent is created.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label htmlFor={`${id}-name`} className="type-label text-foreground">
                  Name
                </Label>
                <Input
                  id={`${id}-name`}
                  placeholder="e.g. Social Media Manager"
                  value={name}
                  maxLength={100}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? `${id}-name-error` : undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                />
                {nameError ? <FieldError id={`${id}-name-error`}>{nameError}</FieldError> : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label htmlFor={`${id}-model`} className="type-label text-foreground">
                  Model
                </Label>
                <Select value={model} onValueChange={(v) => setModel(v as AgentModel)}>
                  <SelectTrigger id={`${id}-model`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-description`} className="type-label text-foreground">
                Description
              </Label>
              <Textarea
                id={`${id}-description`}
                rows={3}
                maxLength={500}
                placeholder="What does this agent do for your team?"
                className="min-h-24"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span id={`${id}-start`} className="type-label text-foreground">
                Start from
              </span>
              <Segmented
                aria-labelledby={`${id}-start`}
                className="self-start"
                items={[
                  { value: "blank", label: "Blank" },
                  { value: "predefined", label: "Pre-defined" },
                ]}
                value={startFrom}
                onValueChange={(v) => setStartFrom(v as StartFrom)}
              />
              {startFrom === "predefined" ? (
                <RadioGroup
                  aria-label="Pre-defined agents"
                  value={role ?? ""}
                  onValueChange={(v) => pickRole(v as OperatorRoleId)}
                  className="flex flex-col gap-0 rounded-md border border-border px-3 py-1"
                >
                  {OPERATOR_ROSTER.map((r) => (
                    <label
                      key={r.id}
                      htmlFor={`${id}-role-${r.id}`}
                      className="flex cursor-pointer items-center gap-3 py-2"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2 px-1 type-body text-foreground">
                        <RadioGroupItem id={`${id}-role-${r.id}`} value={r.id} />
                        {r.name}
                      </span>
                      <span className="shrink-0 type-small text-muted-foreground">{modelLabel(r.model)}</span>
                    </label>
                  ))}
                </RadioGroup>
              ) : null}
            </div>

            <p className="type-caption text-muted-foreground">
              A new agent starts as v1. Fork a version in Versions to try changes before they go live.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || (startFrom === "predefined" && !role)}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
