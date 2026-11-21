"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Icon } from "@/components/v2/primitives/icon";
import { AuthCard } from "@/components/v2/shell/system-states";

type FormAction = (formData: FormData) => void | Promise<void>;

export type SignInState = "default" | "redirect-pending" | "provider-error";

type SignInPanelProps = {
  state: SignInState;
  oidc: boolean;
  localDev: boolean;
  devUser: string;
  onNexAuth: FormAction;
  onDev: FormAction;
  /** Called on NexAuth submit, before the redirect lands. */
  onRedirectStart?: () => void;
};

const COPY = {
  default: "Relay is in closed beta. Sign in with your NexAuth account.",
  pending: "Redirecting to NexAuth. Keep this tab open.",
  none: "This instance has no sign-in provider configured.",
};

/**
 * Figma `03/sign-in/{default, redirect-pending, provider-error, dev-credentials}`
 * (`376:2213`, `376:24006`, `376:24029`, `376:24311`). Presentational; `SignInCard` owns state.
 */
export function SignInPanel({
  state,
  oidc,
  localDev,
  devUser,
  onNexAuth,
  onDev,
  onRedirectStart,
}: SignInPanelProps) {
  const pending = state === "redirect-pending";
  const failed = state === "provider-error";
  const description = !oidc && !localDev ? COPY.none : pending ? COPY.pending : COPY.default;

  return (
    <AuthCard title="Sign in to Relay" description={description}>
      {failed ? (
        <div
          data-slot="sign-in-alert"
          role="alert"
          className="flex gap-3 rounded-xl border border-destructive/60 bg-destructive/5 px-4 py-3"
        >
          <Icon name="circle-alert" size={20} className="mt-px text-destructive" />
          <div className="flex flex-col gap-1">
            <p className="type-body-strong text-foreground">Sign-in failed</p>
            <p className="type-small text-muted-foreground">
              Sign-in was cancelled or failed. Try again.
            </p>
          </div>
        </div>
      ) : null}

      {oidc ? (
        <form action={onNexAuth} onSubmit={onRedirectStart}>
          {pending ? (
            <Button
              type="submit"
              size="lg"
              disabled
              className="w-full disabled:bg-primary-soft disabled:text-primary"
            >
              <Icon name="loader-circle" size={16} className="animate-spin" />
              Redirecting to NexAuth…
            </Button>
          ) : (
            <Button type="submit" size="lg" className="w-full">
              <Icon name="key-round" size={16} />
              {failed ? "Try again with NexAuth" : "Continue with NexAuth"}
            </Button>
          )}
        </form>
      ) : null}

      {localDev ? (
        <>
          {oidc ? (
            <div className="flex items-center gap-3" aria-hidden>
              <Separator className="flex-1" />
              <span className="type-label text-muted-foreground uppercase">Localhost only</span>
              <Separator className="flex-1" />
            </div>
          ) : null}
          <form action={onDev} className="flex flex-col gap-3">
            <Input
              name="username"
              type="text"
              aria-label="Username"
              autoComplete="username"
              defaultValue={devUser}
              required
            />
            <Input
              name="password"
              type="password"
              aria-label="Password"
              placeholder="Password"
              autoComplete="current-password"
              required
            />
            <Button type="submit" variant="outline" className="w-full">
              <Icon name="user" size={16} />
              Dev sign-in (localhost)
            </Button>
          </form>
        </>
      ) : null}

      {!oidc && !localDev ? (
        <p className="type-small text-center text-muted-foreground">
          No sign-in provider is configured. For local development set AUTH_DEV_ENABLED=true
          with AUTH_URL=http://localhost:3000.
        </p>
      ) : (
        <p className="type-caption text-center text-muted-foreground">
          {localDev
            ? "Dev sign-in appears only when AUTH_DEV_ENABLED is set on localhost."
            : "Need access? Ask a company owner to add you by email."}
        </p>
      )}
    </AuthCard>
  );
}

type SignInCardProps = Omit<SignInPanelProps, "state" | "onRedirectStart"> & {
  error: boolean;
};

/** Client wrapper: switches to `redirect-pending` once the NexAuth form submits. */
export function SignInCard({ error, ...props }: SignInCardProps) {
  const [redirecting, setRedirecting] = useState(false);
  const state: SignInState = redirecting ? "redirect-pending" : error ? "provider-error" : "default";
  return <SignInPanel {...props} state={state} onRedirectStart={() => setRedirecting(true)} />;
}
