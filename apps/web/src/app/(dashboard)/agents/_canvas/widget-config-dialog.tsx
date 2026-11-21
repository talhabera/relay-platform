"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { generateWidgetId, updateWidgetConfig } from "@/app/(dashboard)/settings/companies/actions";
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
import { Textarea } from "@/components/ui/textarea";
import { Icon, IconButton, Segmented } from "@/components/v2/primitives";

import {
  widgetEmbedSnippet,
  widgetFormDefaults,
  widgetFormErrors,
  widgetPreviewTitle,
  widgetReassignNote,
  widgetSaveInput,
  type AgentsWidget,
  type WidgetFormValues,
  type WidgetPosition,
} from "./widget-config-model";

type WidgetConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widget: AgentsWidget;
  agentId: string;
  agentName: string;
};

const POSITIONS: { value: WidgetPosition; label: string }[] = [
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
];

/**
 * Website widget dialog (Figma 07 `agents-customer/widget-config`, 411:31887): widget color,
 * greeting, launcher position and embed code beside a live preview. Saving points the company's
 * widget at this agent. Moved here from /settings/companies/[id] (S57).
 */
export function WidgetConfigDialog({ open, onOpenChange, widget, agentId, agentName }: WidgetConfigDialogProps) {
  const router = useRouter();
  const [values, setValues] = React.useState<WidgetFormValues>(() => widgetFormDefaults(widget));
  const [widgetId, setWidgetId] = React.useState(widget.widgetId);
  const [saving, startSaving] = React.useTransition();
  const [generating, startGenerating] = React.useTransition();
  const errors = widgetFormErrors(values);
  const note = widgetReassignNote(widget, agentId);
  const title = widgetPreviewTitle(widget);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.relay.ai";
  const snippet = widgetId ? widgetEmbedSnippet(appUrl, widgetId) : null;
  const ids = { color: React.useId(), greeting: React.useId() };

  const set = <K extends keyof WidgetFormValues>(key: K, value: WidgetFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function save() {
    if (Object.keys(errors).length > 0) return;
    startSaving(async () => {
      try {
        await updateWidgetConfig(widget.companyId, widgetSaveInput(values, agentId));
        toast.success("Widget saved");
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error("Could not save the widget");
      }
    });
  }

  function generate() {
    startGenerating(async () => {
      try {
        const result = await generateWidgetId(widget.companyId);
        setWidgetId(result.widgetId);
        toast.success("Embed code ready");
      } catch {
        toast.error("Could not create the embed code");
      }
    });
  }

  async function copy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success("Embed code copied");
    } catch {
      toast.error("Could not copy the embed code");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[960px]">
        <DialogHeader>
          <DialogTitle>Website widget</DialogTitle>
          <DialogDescription>
            Configure the chat widget on your website. It answers through {agentName}. Changes go live when you
            save.
          </DialogDescription>
          {note ? <p className="type-small text-warning">{note}</p> : null}
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div data-slot="widget-config-form" className="flex min-w-0 flex-col gap-5">
            <Field label="Widget color" htmlFor={ids.color} error={errors.primaryColor}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick widget color"
                  value={errors.primaryColor ? "#000000" : values.primaryColor}
                  onChange={(e) => set("primaryColor", e.target.value.toUpperCase())}
                  className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0"
                />
                <Input
                  id={ids.color}
                  value={values.primaryColor}
                  onChange={(e) => set("primaryColor", e.target.value.trim())}
                  aria-invalid={Boolean(errors.primaryColor)}
                  className="flex-1 type-mono"
                />
              </div>
            </Field>

            <Field label="Greeting" htmlFor={ids.greeting} error={errors.welcomeMessage}>
              <Textarea
                id={ids.greeting}
                value={values.welcomeMessage}
                onChange={(e) => set("welcomeMessage", e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Hi, how can we help?"
              />
            </Field>

            <Field label="Launcher position">
              <Segmented
                aria-label="Launcher position"
                items={POSITIONS}
                value={values.position}
                onValueChange={(v) => set("position", v as WidgetPosition)}
              />
            </Field>

            <Field label="Embed code">
              {snippet ? (
                <>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 type-mono whitespace-pre-wrap break-all text-foreground">
                    {snippet}
                  </pre>
                  <Button variant="outline" size="md" className="w-fit" onClick={copy}>
                    <Icon name="copy" size={16} />
                    Copy code
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <p className="type-small text-muted-foreground">No embed code yet. Create one to add the widget to your site.</p>
                  <Button variant="outline" size="md" onClick={generate} disabled={generating}>
                    Create embed code
                  </Button>
                </div>
              )}
            </Field>
          </div>

          <WidgetPreview title={title} values={values} />
        </div>

        <DialogFooter>
          <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="md" onClick={save} disabled={saving || Object.keys(errors).length > 0}>
            Save widget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="type-label text-muted-foreground">
          {label}
        </label>
      ) : (
        <span className="type-label text-muted-foreground">{label}</span>
      )}
      {children}
      {error ? <span className="type-caption text-destructive">{error}</span> : null}
    </div>
  );
}

/** Preview column: the open widget as a visitor sees it, tinted with the chosen color. */
function WidgetPreview({ title, values }: { title: string; values: WidgetFormValues }) {
  const [heading, ...rest] = (values.welcomeMessage || "Hi, how can we help?").split("\n");
  const color = /^#[0-9a-fA-F]{6}$/.test(values.primaryColor) ? values.primaryColor : undefined;
  return (
    <div
      data-slot="widget-preview"
      className="flex min-h-[420px] flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4"
    >
      <span className="text-center type-caption text-muted-foreground">Preview</span>
      <div
        className={`flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevation-2 ${
          values.position === "bottom-left" ? "md:mr-6" : "md:ml-6"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full type-caption text-primary-foreground"
            style={{ backgroundColor: color }}
          >
            {title.slice(0, 2).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate type-body-strong text-foreground">{title}</span>
            <span className="type-caption text-muted-foreground">Usually replies in under a minute</span>
          </span>
          <IconButton icon="x" label="Close preview" size="sm" tabIndex={-1} />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <span className="type-h3 text-foreground">{heading}</span>
          {rest.length > 0 ? (
            <p className="type-small whitespace-pre-wrap text-muted-foreground">{rest.join("\n").trim()}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1 type-small text-muted-foreground">Write a message…</span>
          <span
            className="rounded-md px-3 py-1.5 type-small text-primary-foreground"
            style={{ backgroundColor: color }}
          >
            Send
          </span>
        </div>
      </div>
    </div>
  );
}
