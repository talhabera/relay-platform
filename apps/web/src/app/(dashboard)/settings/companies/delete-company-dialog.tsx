"use client";

import { useState } from "react";
import { Bot, CalendarClock, Loader2, MessagesSquare, Package, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  deleteImpactLines,
  needsTypedConfirm,
  typedNameMatches,
  type CompanyDeleteImpact,
  type DeleteImpactKey,
} from "./company-view";

const LINE_ICON: Record<DeleteImpactKey, typeof Bot> = {
  agents: Bot,
  conversations: MessagesSquare,
  schedules: CalendarClock,
  packages: Package,
  members: Users,
};

/**
 * Figma 08c `companies-delete` (nothing inside: plain confirm) and `companies-delete-typed`
 * (impact list + type the name). `impact` is null while it loads.
 */
export function DeleteCompanyDialog({
  company,
  impact,
  open,
  onOpenChange,
  onConfirm,
}: {
  company: { id: string; name: string } | null;
  impact: CompanyDeleteImpact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (confirmName: string) => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const name = company?.name ?? "";
  const lines = impact ? deleteImpactLines(impact) : [];
  const typedRequired = impact ? needsTypedConfirm(impact) : true;
  const canDelete = impact !== null && (!typedRequired || typedNameMatches(typed, name)) && !pending;

  async function confirm() {
    setPending(true);
    try {
      await onConfirm(typed);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle icon>Delete {name}?</DialogTitle>
          <DialogDescription>
            {impact === null || lines.length > 0
              ? `Everything in ${name} is deleted with it:`
              : `${name} has no agents, conversations or schedules. This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>

        {impact === null ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3" aria-busy="true">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-52" />
          </div>
        ) : lines.length > 0 ? (
          <>
            <ul className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3">
              {lines.map((line) => {
                const LineIcon = LINE_ICON[line.key];
                return (
                  <li key={line.key} className="flex items-center gap-2 type-small text-foreground">
                    <LineIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    {line.text}
                  </li>
                );
              })}
            </ul>
            <p className="type-small text-destructive">This cannot be undone.</p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="delete-company-confirm">Type {name} to confirm</Label>
              <Input
                id="delete-company-confirm"
                placeholder={name}
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          </>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={!canDelete}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Delete company
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
