"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createAgentFromDialog } from "@/app/(dashboard)/agents/actions";
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
import { Icon } from "@/components/v2/primitives";
import { createCustomerAgentDialogSchema } from "@/lib/validators/agent";

import { CUSTOMER_STARTS, MODEL_OPTIONS, type AgentModel, type CustomerStartId } from "./agent-templates";

/** Inline field error (Figma: circle-alert 14 + caption in destructive). */
export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-center gap-1 type-caption text-destructive">
      <Icon name="circle-alert" size={14} className="shrink-0" />
      {children}
    </p>
  );
}

/**
 * Create customer agent (Figma 07 `agents-customer/create-agent` 599:15618): Name, Model and
 * Start from (Quote requests and site visits / Customer support and FAQs / Blank agent).
 * The new agent opens selected on the /agents canvas.
 */
export function CreateAgentDialog({ companyId }: { companyId: string }) {
  const router = useRouter();
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [model, setModel] = React.useState<AgentModel>("sonnet");
  const [start, setStart] = React.useState<CustomerStartId>("quotes");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setName("");
    setModel("sonnet");
    setStart("quotes");
    setNameError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createCustomerAgentDialogSchema.safeParse({ companyId, name, model, start });
    if (!parsed.success) {
      setNameError(parsed.error.issues.find((i) => i.path[0] === "name")?.message ?? "Check the form.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createAgentFromDialog(parsed.data);
      toast.success(`${parsed.data.name} created`);
      setOpen(false);
      reset();
      router.push(`/agents?agent=${result.id}`, { scroll: false });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the agent");
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
        <Button>
          <Icon name="plus" size={16} />
          Create customer agent
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]" showCloseButton={false}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create customer agent</DialogTitle>
            <DialogDescription>
              Customer agents answer your customers on the sources you bind. The kind cannot be changed after the agent
              is created.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-name`} className="type-label text-foreground">
                Name
              </Label>
              <Input
                id={`${id}-name`}
                placeholder="e.g. Acme Support Assistant"
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

            <div className="flex flex-col gap-2">
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

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 type-label text-foreground">Start from</legend>
              <RadioGroup
                value={start}
                onValueChange={(v) => setStart(v as CustomerStartId)}
                className="flex flex-col gap-3"
              >
                {CUSTOMER_STARTS.map((s) => (
                  <label
                    key={s.id}
                    htmlFor={`${id}-start-${s.id}`}
                    className="flex h-10 cursor-pointer items-center gap-2 px-1 type-body text-foreground"
                  >
                    <RadioGroupItem id={`${id}-start-${s.id}`} value={s.id} />
                    {s.label}
                  </label>
                ))}
              </RadioGroup>
            </fieldset>

            <p className="type-caption text-muted-foreground">
              Bind sources, add knowledge and connect integrations after the agent is created.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              Create agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
