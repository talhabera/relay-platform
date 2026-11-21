"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GitFork, Loader2 } from "lucide-react";

import { forkOperatorVersion } from "@/app/(dashboard)/operator/actions";
import { nextVersionName } from "@/app/(dashboard)/agents/operator/_canvas/operator-inspector-model";
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
import { Textarea } from "@/components/ui/textarea";
import { Icon, Segmented } from "@/components/v2/primitives";

export type ForkableVersion = {
  id: string;
  name: string;
  status: "live" | "draft";
  /** Tool labels that are on, for the "Copy from" summary. */
  tools: string[];
  modelLabel: string;
};

type ForkVersionDialogProps = {
  agentId: string;
  /** Default Fork from version. */
  versionId: string;
  agentName?: string;
  /** Every version of the agent (newest first). Without it the dialog asks for a name. */
  versions?: ForkableVersion[];
  /** Custom trigger; defaults to a small outline "Fork" button. */
  trigger?: React.ReactNode;
};

const statusLabel = (status: "live" | "draft") => (status === "live" ? "Live" : "Draft");

function CopiedItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-1 type-body text-foreground">
      <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-primary text-primary-foreground">
        <Icon name="check" size={12} strokeWidth={3} />
      </span>
      {children}
    </li>
  );
}

/**
 * Fork a new version (Figma 07 `agents-operator/versions-fork`, `639:15792`): Fork from, change
 * note and what the fork copies. The fork is named after the highest version (v3 after v2) and
 * starts as a draft; the live version keeps serving until it is promoted.
 */
export function ForkVersionDialog({ agentId, versionId, agentName, versions, trigger }: ForkVersionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [parentId, setParentId] = React.useState(versionId);
  const [note, setNote] = React.useState("");
  const [customName, setCustomName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const parent = versions?.find((v) => v.id === parentId);
  const live = versions?.find((v) => v.status === "live");
  const name = versions ? nextVersionName(versions.map((v) => v.name)) : customName.trim();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setParentId(versionId);
      setNote("");
      setCustomName("");
    }
  }

  async function handleFork() {
    if (!name) {
      toast.error("Version name is required");
      return;
    }
    setSubmitting(true);
    try {
      const result = await forkOperatorVersion(agentId, parentId, name, note.trim() || undefined);
      toast.success(`${name} Draft created`);
      setOpen(false);
      router.push(`/agents/operator?agent=${agentId}&version=${result.id}`, { scroll: false });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to fork version");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <GitFork className="mr-2 h-4 w-4" />
            Fork
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Fork a new version</DialogTitle>
          <DialogDescription>
            {versions
              ? `Creates ${name} Draft${agentName ? ` of ${agentName}` : ""}.${live ? ` ${live.name} stays live while you edit the fork.` : ""}`
              : "Create a draft with the same instructions, tools and model."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {versions && versions.length > 1 ? (
            <div className="flex flex-col gap-2">
              <span className="type-label text-muted-foreground">Fork from</span>
              <Segmented
                aria-label="Fork from"
                items={versions.slice(0, 5).map((v) => ({ value: v.id, label: `${v.name} ${statusLabel(v.status)}` }))}
                value={parentId}
                onValueChange={setParentId}
              />
            </div>
          ) : null}

          {versions ? null : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="fork-version-name">New version name</Label>
              <Input
                id="fork-version-name"
                placeholder="v2"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="fork-change-note" className="type-label text-muted-foreground">
              Change note
            </Label>
            <Textarea
              id="fork-change-note"
              rows={3}
              maxLength={500}
              placeholder="What this version changes"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {parent ? (
            <div className="flex flex-col gap-1">
              <span className="type-label text-muted-foreground">Copy from {parent.name}</span>
              <ul className="flex flex-col gap-1">
                <CopiedItem>Instructions</CopiedItem>
                <CopiedItem>Tools · {parent.tools.length > 0 ? parent.tools.join(", ") : "none on"}</CopiedItem>
                <CopiedItem>Model · {parent.modelLabel}</CopiedItem>
              </ul>
            </div>
          ) : null}

          {live ? (
            <p className="type-caption text-muted-foreground">
              Sessions keep using {live.name} Live until you promote the fork.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleFork} disabled={submitting || !name}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {versions ? `Fork as ${name} Draft` : "Fork"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
