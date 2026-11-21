"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ProfileActionResult } from "./actions";

type WhatsappFormProps = {
  initial: string | null;
  save: (value: string) => Promise<ProfileActionResult>;
};

/** WhatsApp number field + Save (Figma 11 `11/profile/default` `695:89346`). */
export function WhatsappForm({ initial, save }: WhatsappFormProps) {
  const [value, setValue] = React.useState(initial ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    startTransition(async () => {
      const result = await save(value);
      if (result.ok) {
        setError(null);
        setValue(result.value ?? "");
        setSaved(true);
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" data-slot="client-profile-whatsapp">
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-whatsapp">WhatsApp number</Label>
        <Input
          id="profile-whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+49 151 2345 6789"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby="profile-whatsapp-help"
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
        />
        <p id="profile-whatsapp-help" className="type-caption text-muted-foreground">
          Handoff requests for you arrive here. You confirm each one by WhatsApp. Agency staff see this number in
          the primary recipient picker.
        </p>
        {error ? (
          <p role="alert" className="type-caption text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        {saved ? (
          <span role="status" className="type-caption text-muted-foreground">
            Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}
