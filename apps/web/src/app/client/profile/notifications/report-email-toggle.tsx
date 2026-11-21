"use client";

import * as React from "react";

import { Switch } from "@/components/ui/switch";

type ReportEmailToggleProps = {
  /** Null for the owner / member preview: only client users get report emails. */
  enabled: boolean | null;
  save?: (enabled: boolean) => Promise<{ ok: boolean }>;
};

/** Report emails on / off (spec client-role-and-portal, decision 8). Off = opted out. */
export function ReportEmailToggle({ enabled, save }: ReportEmailToggleProps) {
  const [on, setOn] = React.useState(enabled ?? false);
  const [error, setError] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const readOnly = enabled === null || !save;

  const onCheckedChange = (next: boolean) => {
    if (!save) return;
    const previous = on;
    setOn(next);
    setError(false);
    startTransition(async () => {
      try {
        await save(next);
      } catch {
        setOn(previous);
        setError(true);
      }
    });
  };

  return (
    <div className="flex items-start gap-4" data-slot="report-email-toggle">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor="report-emails" className="type-body-strong text-foreground">
          Report emails
        </label>
        <p className="type-small text-muted-foreground">
          {readOnly
            ? "Only client users get report emails. This is the read-only portal preview."
            : "Daily and weekly reports by email, with the headline numbers and a link to the full report."}
        </p>
        {error ? (
          <p role="alert" className="type-caption text-destructive">
            Could not save. Try again.
          </p>
        ) : null}
      </div>
      <Switch
        id="report-emails"
        checked={on}
        disabled={readOnly || pending}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
