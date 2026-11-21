"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon, IconButton, Segmented, StatusChip } from "@/components/v2/primitives";
import { initials } from "@/components/v2/shell/initials";

import { inviteMember, removeMember } from "./actions";

export type MemberListRow = {
  userId: string;
  name: string;
  email: string;
  kind: "owner" | "member" | "client";
  roleLabel: string;
  approvesOn: string | null;
  /** "Company owner" or "Added 23 Sep 2026". */
  timeLabel: string;
  removeCopy: string | null;
};

type Role = "member" | "client";

const ROLE_HINT: Record<Role, string> = {
  member: "Members open the pages you grant in Access & roles.",
  client: "Client users see only the client portal (Reports, Live). They cannot belong to another company.",
};

/** Settings › Members (Figma 08c members, members-approves-on, members-add-role, members-unknown-email, members-remove). */
export function MembersPanel({
  companyId,
  companyName,
  rows,
  initialAddOpen = false,
}: {
  companyId: string;
  companyName: string;
  rows: MemberListRow[];
  initialAddOpen?: boolean;
}) {
  const [addOpen, setAddOpen] = useState(initialAddOpen);
  const [removing, setRemoving] = useState<MemberListRow | null>(null);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Members</h2>
          <p className="text-xs text-muted-foreground">
            People who can open {companyName} in Relay. Access &amp; roles decides which pages they see.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setAddOpen(true)}>
          <Icon name="plus" />
          Add member
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border" role="list" aria-label="Members">
        {rows.map((row) => (
          <MemberListItem key={row.userId} row={row} onRemove={() => setRemoving(row)} />
        ))}
      </div>

      <AddPersonDialog
        companyId={companyId}
        companyName={companyName}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
      <RemoveDialog
        companyId={companyId}
        companyName={companyName}
        row={removing}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

function MemberListItem({ row, onRemove }: { row: MemberListRow; onRemove: () => void }) {
  return (
    <div
      role="listitem"
      data-slot="member-list-row"
      data-kind={row.kind}
      className="flex w-full flex-wrap items-start gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0 md:flex-nowrap"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 md:w-70 md:flex-none">
        <Avatar size="md">
          <AvatarFallback>{initials(row.name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate type-body-strong text-foreground">{row.name}</span>
          <span className="truncate type-caption text-muted-foreground">{row.email}</span>
          {row.approvesOn !== null ? (
            <span className="type-caption text-muted-foreground" data-slot="member-approves-on">
              Approves on: <span className="text-foreground">{row.approvesOn}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 pt-1 md:contents">
        <div className="flex items-center md:w-30 md:shrink-0 md:pt-1">
          <StatusChip tone="neutral" dot={false}>
            {row.roleLabel}
          </StatusChip>
        </div>
        <div className="flex items-center md:w-30 md:shrink-0 md:pt-1">
          <StatusChip tone="success">Active</StatusChip>
        </div>
      </div>
      <span className="min-w-0 flex-1 type-small text-muted-foreground md:pt-1.5">{row.timeLabel}</span>
      <div className="w-8 shrink-0">
        {row.kind === "owner" ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon="ellipsis" label={`Actions for ${row.name}`} size="sm" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                Remove {row.kind === "client" ? "client" : "member"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function AddPersonDialog({
  companyId,
  companyName,
  open,
  onOpenChange,
}: {
  companyId: string;
  companyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>("member");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setRole("member");
    setEmail("");
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await inviteMember(companyId, email, role);
      if (result.ok) {
        toast.success(role === "client" ? "Client added" : "Member added");
        reset();
        onOpenChange(false);
        router.refresh();
      } else if (result.field === "email") {
        setError(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("Could not add this person. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-100">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
            <DialogDescription>
              Invite an existing Relay user to {companyName} by email. The role is fixed once added.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label id="add-person-role">Role</Label>
            <Segmented
              aria-labelledby="add-person-role"
              items={[
                { value: "member", label: "Member" },
                { value: "client", label: "Client" },
              ]}
              value={role}
              onValueChange={(v) => setRole(v === "client" ? "client" : "member")}
            />
            <p className="type-caption text-muted-foreground">{ROLE_HINT[role]}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="add-person-email">Email</Label>
            <Input
              id="add-person-email"
              type="email"
              required
              autoComplete="off"
              placeholder="name@company.com"
              value={email}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "add-person-email-error" : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
            />
            {error ? (
              <p id="add-person-email-error" className="type-caption text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <p className="type-caption text-muted-foreground">The person must already have signed in once.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || email.trim() === ""}>
              {role === "client" ? "Add client" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  companyId,
  companyName,
  row,
  onClose,
}: {
  companyId: string;
  companyName: string;
  row: MemberListRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const noun = row?.kind === "client" ? "client" : "member";

  async function onConfirm() {
    if (!row) return;
    setPending(true);
    try {
      const result = await removeMember(companyId, row.userId);
      if (result.ok) {
        toast.success(`Removed ${row.name}`);
        onClose();
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("Could not remove this person. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={row !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        {row ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Icon name="triangle-alert" size={18} className="shrink-0 text-destructive" />
                Remove {row.name} from {companyName}?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <Avatar size="md">
                <AvatarFallback>{initials(row.name)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-body-strong">{row.name}</span>
                <span className="truncate type-caption text-muted-foreground">{row.email}</span>
              </div>
              <StatusChip tone="neutral" dot={false}>
                {row.roleLabel}
              </StatusChip>
            </div>
            <AlertDialogDescription>{row.removeCopy}</AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button variant="destructive" disabled={pending} onClick={onConfirm}>
                Remove {noun}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
