"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createChannel } from "@/app/(dashboard)/agents/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { sourceLabel, type CanvasSource } from "@/components/v2/canvas";
import { BrandGlyph, StatusChip } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import type { AgentsCanvasSourceOption } from "./agents-canvas-model";
import { bindSourceInput, sourceCredentialFields, sourceOptionHint } from "./bind-source";

type AddSourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
  options: readonly AgentsCanvasSourceOption[];
  /** Preselected source (SourceNode Connect or source menu); defaults to the first option. */
  initialSource?: CanvasSource;
};

/**
 * Figma 07 `agents-customer/add-binding` (411:31835): bind a source to the selected customer
 * agent. Sources the agent already has are not listed. A source another agent answers stays
 * selectable: binding connects a further account, the other agent keeps its own.
 */
export function AddSourceDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  options,
  initialSource,
}: AddSourceDialogProps) {
  const router = useRouter();
  const fallback = options.some((o) => o.source === initialSource) ? initialSource : options[0]?.source;
  const [source, setSource] = React.useState<CanvasSource | undefined>(fallback);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [missing, setMissing] = React.useState<string[]>([]);
  const [pending, startTransition] = React.useTransition();

  const fields = source ? sourceCredentialFields[source] : [];

  function choose(next: string) {
    setSource(next as CanvasSource);
    setValues({});
    setMissing([]);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source) return;
    const result = bindSourceInput(source, agentId, values);
    if (!result.ok) {
      setMissing(result.missing);
      return;
    }
    startTransition(async () => {
      try {
        await createChannel(result.input);
        toast.success(`${sourceLabel[source]} is bound to ${agentName}`);
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error(`Could not bind ${sourceLabel[source]}. Check the credentials and try again.`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add source</DialogTitle>
            <DialogDescription>
              Bind a source to {agentName}. Each source answers through one customer agent.
            </DialogDescription>
          </DialogHeader>

          {options.length === 0 ? (
            <p className="type-small text-muted-foreground">
              Every source is already bound to {agentName}.
            </p>
          ) : (
            <RadioGroup
              aria-label="Source"
              value={source}
              onValueChange={choose}
              className="gap-2"
            >
              {options.map((option) => {
                const id = `add-source-${option.source}`;
                const checked = option.source === source;
                return (
                  <label
                    key={option.source}
                    htmlFor={id}
                    data-slot="add-source-option"
                    data-source={option.source}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors",
                      checked ? "border-primary bg-primary-soft" : "border-border hover:bg-accent",
                    )}
                  >
                    <RadioGroupItem id={id} value={option.source} />
                    <BrandGlyph brand={option.source} size={24} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate type-body-strong text-foreground">{sourceLabel[option.source]}</span>
                      <span className="truncate type-caption text-muted-foreground">
                        {sourceOptionHint(option.source, option.boundTo)}
                      </span>
                    </span>
                    {option.boundTo.length > 0 ? (
                      <StatusChip tone="neutral">Bound</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">Not connected</StatusChip>
                    )}
                  </label>
                );
              })}
            </RadioGroup>
          )}

          {source && fields.length > 0 ? (
            <div className="flex flex-col gap-3">
              {fields.map((field) => {
                const id = `add-source-${field.key}`;
                const invalid = missing.includes(field.key);
                return (
                  <div key={field.key} className="flex flex-col gap-2">
                    <label htmlFor={id} className="type-label text-muted-foreground">
                      {field.label}
                    </label>
                    <Input
                      id={id}
                      autoComplete="off"
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ""}
                      aria-invalid={invalid || undefined}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    />
                    {invalid ? (
                      <span className="type-caption text-destructive">{field.label} is required.</span>
                    ) : null}
                  </div>
                );
              })}
              <p className="type-caption text-muted-foreground">
                {sourceLabel[source]} messages then reach {agentName}.
              </p>
            </div>
          ) : null}
          {source === "website" ? (
            <p className="type-caption text-muted-foreground">
              The website widget answers through {agentName} once its embed snippet is on your site.
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!source || pending}>
              {pending ? "Binding..." : "Connect and bind"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
