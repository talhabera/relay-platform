"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { createCompany } from "./actions";

/** Figma 08c `companies-create`: name only; the creator becomes the owner. */
export function NewCompanyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const trimmed = name.trim();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed) return;
    setPending(true);
    try {
      await createCompany({ name: trimmed });
      toast.success(`${trimmed} created`);
      setOpen(false);
      setName("");
      router.refresh();
    } catch {
      toast.error("Couldn't create the company");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setName("");
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New company
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New company</DialogTitle>
            <DialogDescription>
              You become the owner of this company and can add members afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-company-name">Company name</Label>
            <Input
              id="new-company-name"
              placeholder="Company name"
              maxLength={100}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Create company
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
