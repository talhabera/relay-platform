"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlertIcon, CircleCheckIcon, ClockIcon } from "lucide-react";

import { requestAccess, type RequestAccessResult } from "@/app/(marketing)/actions";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/v2/primitives/segmented";
import { cn } from "@/lib/utils";

import type { RequestAccessPlan } from "./plans";

/**
 * Request access dialog (Figma 09 `request-access/*`, section `703:18785`; spec
 * 2026-10-02-pricing-and-access-requests §6-9 and "Dialog copy"). One dialog for every
 * marketing CTA; `plan` is the opening button's preset (enterprise = "Talk to sales").
 * States: default, talk-to-sales, submitting, error, rate-limited, success. Posts to the
 * S85 `requestAccess` server action.
 */

type RequestAccessDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: RequestAccessPlan;
};

/** Spec §7 values (`ACCESS_REQUEST_CLIENT_COUNTS`), labelled with en dashes as in Figma. */
const CLIENT_COUNTS = [
  { value: "1", label: "1" },
  { value: "2-5", label: "2–5" },
  { value: "6-20", label: "6–20" },
  { value: "20+", label: "20+" },
];

type RequestAccessStateName = "default" | "talk-to-sales" | "submitting" | "error" | "rate-limited" | "success";

function stateName(plan: RequestAccessPlan, result: RequestAccessResult | null, pending: boolean): RequestAccessStateName {
  if (pending) return "submitting";
  if (result?.ok) return "success";
  if (result?.error === "failed") return "error";
  if (result?.error === "rate_limited") return "rate-limited";
  return plan === "enterprise" ? "talk-to-sales" : "default";
}

function RequestAccessDialog({ open, onOpenChange, plan }: RequestAccessDialogProps) {
  const [result, setResult] = React.useState<RequestAccessResult | null>(null);
  const [clientCount, setClientCount] = React.useState<string | undefined>(undefined);
  const [pending, startTransition] = React.useTransition();

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        setResult(await requestAccess(data));
      } catch {
        setResult({ ok: false, error: "failed" });
      }
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setResult(null);
      setClientCount(undefined);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <RequestAccessDialogView
        plan={plan}
        result={result}
        pending={pending}
        clientCount={clientCount}
        onClientCountChange={setClientCount}
        onSubmit={onSubmit}
        onDone={() => handleOpenChange(false)}
      />
    </Dialog>
  );
}

type RequestAccessDialogViewProps = {
  plan: RequestAccessPlan;
  result: RequestAccessResult | null;
  pending: boolean;
  clientCount: string | undefined;
  onClientCountChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onDone: () => void;
};

/** The dialog content for one state; rendered inside a `Dialog` root. Exported for tests. */
function RequestAccessDialogView({
  plan,
  result,
  pending,
  clientCount,
  onClientCountChange,
  onSubmit,
  onDone,
}: RequestAccessDialogViewProps) {
  const state = stateName(plan, result, pending);
  const sales = plan === "enterprise";

  if (result?.ok) {
    return (
      <DialogContent data-slot="request-access-dialog" data-plan={plan} data-state-name={state}>
        <DialogHeader className="pr-10">
          <DialogTitle icon={<CircleCheckIcon />} tone="success">
            Request received
          </DialogTitle>
          <DialogDescription>
            Thanks, {result.name}. We review every request by hand and will email {result.email} when your
            workspace is ready.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter layout="inline">
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  const fieldErrors = result && !result.ok && result.error === "invalid" ? result.fieldErrors : {};
  const rateLimited = state === "rate-limited";
  const submitLabel = pending ? "Sending…" : state === "error" ? "Try again" : sales ? "Talk to sales" : "Request access";

  return (
    <DialogContent
      data-slot="request-access-dialog"
      data-plan={plan}
      data-state-name={state}
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      <DialogHeader className="pr-10">
        <DialogTitle>{sales ? "Talk to sales" : "Request access"}</DialogTitle>
        <DialogDescription>
          {sales
            ? "Tell us about your agency and what you need from Enterprise. We will reply by email."
            : "Relay is in closed beta. Tell us about your agency and we will reply by email."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="plan" value={plan} />
        <input type="hidden" name="clientCount" value={clientCount ?? ""} />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
        {state === "error" ? (
          <Banner tone="error">We could not send your request. Nothing was lost; try again in a moment.</Banner>
        ) : null}
        {rateLimited ? <Banner tone="warning">Too many requests from this network. Try again in an hour.</Banner> : null}
        <Field id="ra-name" label="Name" error={fieldErrors.name}>
          <Input
            id="ra-name"
            name="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            disabled={pending}
            aria-invalid={!!fieldErrors.name}
          />
        </Field>
        <Field id="ra-email" label="Work email" error={fieldErrors.email}>
          <Input
            id="ra-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@agency.com"
            disabled={pending}
            aria-invalid={!!fieldErrors.email}
          />
        </Field>
        <Field id="ra-agency" label="Agency name" error={fieldErrors.agencyName}>
          <Input
            id="ra-agency"
            name="agencyName"
            autoComplete="organization"
            placeholder="Northwind Studio"
            disabled={pending}
            aria-invalid={!!fieldErrors.agencyName}
          />
        </Field>
        <Field id="ra-clients" label="Clients you manage" error={fieldErrors.clientCount}>
          <Segmented
            id="ra-clients"
            aria-labelledby="ra-clients-label"
            aria-invalid={!!fieldErrors.clientCount}
            items={CLIENT_COUNTS}
            value={clientCount}
            onValueChange={onClientCountChange}
            disabled={pending}
          />
        </Field>
        <Field id="ra-message" label="Message (optional)">
          <Textarea
            id="ra-message"
            name="message"
            placeholder="Anything we should know about your clients or channels?"
            disabled={pending}
            className="h-24 resize-none"
          />
        </Field>
        <DialogFooter
          layout="stacked"
          note={
            <>
              By requesting access you agree to our{" "}
              <Link href="/privacy" className="text-primary underline underline-offset-2">
                Privacy policy
              </Link>
              .
            </>
          }
        >
          <Button type="submit" size="lg" className="w-full" disabled={pending || rateLimited}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Figma 02 `Banner` (`709:95556`), error and warning tones; no library component yet. */
function Banner({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  const Icon = tone === "error" ? CircleAlertIcon : ClockIcon;
  return (
    <div
      role="alert"
      data-slot="banner"
      data-tone={tone}
      className={cn(
        "flex items-start gap-2 rounded-md p-3",
        tone === "error"
          ? "bg-status-rejected text-status-rejected-foreground"
          : "bg-status-pending text-status-pending-foreground",
      )}
    >
      <Icon aria-hidden className="size-6 shrink-0" strokeWidth={1.75} />
      <p className="min-w-0 flex-1 type-small">{children}</p>
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label id={`${id}-label`} htmlFor={id}>
        {label}
      </Label>
      {children}
      {error ? <p className="type-caption text-destructive">{error}</p> : null}
    </div>
  );
}

export { RequestAccessDialog, RequestAccessDialogView };
export type { RequestAccessDialogProps, RequestAccessDialogViewProps };
