"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateLeadNotifyNumber } from "@/app/(dashboard)/agents/[id]/leads/actions";

export function LeadNotifyForm({
  agentId,
  initialNumber,
}: {
  agentId: string;
  initialNumber: string | null;
}) {
  const [value, setValue] = useState(initialNumber ?? "");
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      try {
        const { whatsapp } = await updateLeadNotifyNumber(agentId, { whatsapp: value });
        toast.success(whatsapp ? "Notification number saved" : "Notifications turned off");
      } catch {
        toast.error("Use international format, e.g. +905551234567");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="+905551234567"
        inputMode="tel"
        className="w-64"
        aria-label="WhatsApp number for qualified-lead notifications"
      />
      <Button type="submit" disabled={isPending}>
        Save
      </Button>
    </form>
  );
}
