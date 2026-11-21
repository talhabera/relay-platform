"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { promoteOperatorVersion } from "@/app/(dashboard)/operator/actions";
import {
  instructionDiff,
  promoteImpact,
} from "@/app/(dashboard)/agents/operator/_canvas/operator-inspector-model";
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
import { cn } from "@/lib/utils";

type PromoteVersion = { id: string; name: string; instructions: string | null };

type PromoteVersionDialogProps = {
  agentName: string;
  /** Current live version. */
  from: PromoteVersion;
  /** Draft being promoted. */
  to: PromoteVersion;
  /** Schedules pinned to the live version (they keep running it). */
  pinnedSchedules: number;
  trigger: React.ReactNode;
};

/**
 * Promote vN to live? (Figma 07 `agents-operator/versions-promote`, `640:15846`): instruction
 * diff of the draft against live, the impact on sessions and schedules, then the swap.
 */
export function PromoteVersionDialog({ agentName, from, to, pinnedSchedules, trigger }: PromoteVersionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const diff = instructionDiff(from.instructions, to.instructions);
  const impact = promoteImpact({ from: from.name, to: to.name, pinnedSchedules });

  async function handlePromote() {
    setSubmitting(true);
    try {
      await promoteOperatorVersion(to.id);
      toast.success(`${to.name} is live`);
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to promote version");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Promote {to.name} to live?</DialogTitle>
          <DialogDescription>
            {agentName} {to.name} Draft replaces {from.name} as the live version.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="type-label text-muted-foreground">What changes · Instructions</h3>
            {diff.length === 0 ? (
              <p className="type-small text-muted-foreground">Instructions are the same as {from.name}.</p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {diff.map((line, i) => (
                  <li
                    key={`${line.kind}-${i}`}
                    data-kind={line.kind}
                    className={cn(
                      "flex gap-2 rounded-md px-3 py-2 type-small",
                      line.kind === "removed"
                        ? "bg-status-rejected text-status-rejected-foreground"
                        : "bg-status-live text-status-live-foreground",
                    )}
                  >
                    <span aria-hidden>{line.kind === "removed" ? "−" : "+"}</span>
                    <span className="sr-only">{line.kind === "removed" ? "Removed:" : "Added:"}</span>
                    <span className="min-w-0 break-words">{line.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="type-label text-muted-foreground">Impact</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 type-small text-foreground">
              {impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handlePromote} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Promote {to.name} to live
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
