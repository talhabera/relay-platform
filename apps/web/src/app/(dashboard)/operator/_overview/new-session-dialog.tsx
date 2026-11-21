"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { AgentChip, Chip, Icon } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import { sessionHref } from "../_sessions/sessions-list";
import { startOperatorSession } from "./actions";
import type { SessionTargetGroup } from "./overview-model";

type NewSessionDialogProps = {
  groups: SessionTargetGroup[];
  /** Trigger button class (e.g. `shrink-0`). */
  className?: string;
};

const labelClass = "type-label uppercase text-muted-foreground";

/**
 * Figma 05 `operator-home/new-session` (`Dialog / New session`, 606:10055): workflow chips,
 * pre-defined agent radio options (stage, Agent chip, stage note), brief, checkpoint hint.
 */
export function NewSessionDialog({ groups, className }: NewSessionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [groupId, setGroupId] = React.useState<string | null>(groups[0]?.id ?? null);
  const group = groups.find((g) => g.id === groupId) ?? groups[0] ?? null;
  const [targetKey, setTargetKey] = React.useState<string | null>(group?.targets[0]?.key ?? null);
  const target = group?.targets.find((t) => t.key === targetKey) ?? group?.targets[0] ?? null;
  const [brief, setBrief] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  function selectGroup(id: string) {
    setGroupId(id);
    setTargetKey(groups.find((g) => g.id === id)?.targets[0]?.key ?? null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target || pending) return;
    startTransition(async () => {
      try {
        const result = await startOperatorSession({
          agentId: target.agentId,
          versionId: target.versionId,
          brief,
        });
        setOpen(false);
        setBrief("");
        router.push(sessionHref({ id: result.chatId }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to start session");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={className}>
          <Icon name="plus" size={16} />
          New session
        </Button>
      </DialogTrigger>
      <DialogContent data-slot="new-session-dialog" className="gap-5 sm:max-w-[560px]">
        <DialogHeader className="gap-1 pr-10">
          <DialogTitle className="type-h3">New session</DialogTitle>
          <DialogDescription className="type-small text-muted-foreground">
            One conversation with one pre-defined agent about one piece of work.
          </DialogDescription>
        </DialogHeader>

        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-6 text-center">
            <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-foreground">
              <Icon name="bot" size={18} />
            </span>
            <p className="type-body-strong text-foreground">No operator agents yet</p>
            <p className="type-small text-muted-foreground">
              Install a package or create an operator agent with a version to start a session.
            </p>
          </div>
        ) : (
          <form id="new-session-form" onSubmit={submit} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className={cn(labelClass, "mb-2")}>Workflow</legend>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => (
                  <Chip
                    key={g.id}
                    size="md"
                    icon={g.icon}
                    variant={g.id === group?.id ? "selected" : "default"}
                    onClick={() => selectGroup(g.id)}
                  >
                    {g.label}
                  </Chip>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-col gap-2">
              <span id="new-session-agent" className={labelClass}>
                Pre-defined agent
              </span>
              <RadioGroup
                aria-labelledby="new-session-agent"
                value={target?.key ?? ""}
                onValueChange={setTargetKey}
                className="gap-2"
              >
                {group?.targets.map((t) => {
                  const checked = t.key === target?.key;
                  const id = `new-session-${t.key}`;
                  return (
                    <label
                      key={t.key}
                      htmlFor={id}
                      data-slot="new-session-option"
                      data-state={checked ? "checked" : "unchecked"}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                        checked ? "border-primary bg-primary-soft" : "border-border hover:bg-muted",
                      )}
                    >
                      <span className="flex h-10 w-24 shrink-0 items-center gap-2 px-1">
                        <RadioGroupItem id={id} value={t.key} />
                        <span className="truncate type-body text-foreground">{t.label}</span>
                      </span>
                      <AgentChip
                        kind="operator"
                        name={t.agentName}
                        version={t.versionName}
                        status={t.versionStatus}
                        className="min-w-0"
                      />
                      <span className="min-w-0 flex-1 truncate text-right type-caption text-muted-foreground">
                        {t.note}
                      </span>
                    </label>
                  );
                })}
              </RadioGroup>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="new-session-brief" className={labelClass}>
                Brief
              </label>
              <Textarea
                id="new-session-brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                maxLength={4000}
                placeholder="What should the agent work on?"
                className="min-h-24"
              />
            </div>

            <p className="flex items-center gap-2 type-caption text-muted-foreground">
              <Icon name="shield" size={16} />
              Sends, posts and handoffs always stop at a checkpoint for your approval.
            </p>
          </form>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" form="new-session-form" disabled={!target || pending}>
            <Icon name={pending ? "loader-circle" : "play"} size={16} className={pending ? "animate-spin" : undefined} />
            Start session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
