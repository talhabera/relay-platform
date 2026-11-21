"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";
import { BrandLockup } from "./brand";

type AuthCardProps = {
  title: string;
  description?: ReactNode;
  /** Small mono line above the title (e.g. "404"). */
  eyebrow?: string;
  children?: ReactNode;
  className?: string;
};

/**
 * Figma 03 auth card (`03/sign-in/*`, `03/sign-up/invite-only`, `03/not-found/public`,
 * `03/error/global`): 480px card, primary glow, Brand lockup, centered h2 title + body.
 */
function AuthCard({ title, description, eyebrow, children, className }: AuthCardProps) {
  return (
    <section
      data-slot="auth-card"
      className={cn(
        "flex w-full max-w-120 flex-col gap-6 rounded-2xl border border-primary/30 bg-card p-10 shadow-glow-primary",
        className,
      )}
    >
      <BrandLockup href={null} className="self-center" />
      <div className="flex flex-col items-center gap-2 text-center">
        {eyebrow ? <p className="type-mono text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="type-h2 text-foreground">{title}</h1>
        {description ? <p className="type-body text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Full-viewport centered stage for auth-card screens. */
function AuthStage({ children }: { children: ReactNode }) {
  return (
    <main
      data-slot="auth-stage"
      className="flex min-h-svh w-full flex-col items-center justify-center bg-canvas px-4 py-10"
    >
      {children}
    </main>
  );
}

/** Figma `03/not-found/public` (`530:1626`). */
function PublicNotFound() {
  return (
    <AuthCard
      eyebrow="404"
      title="This page is not here"
      description="The URL does not match a Relay route. Open home or sign in."
    >
      <div className="flex justify-center gap-2">
        <Button asChild size="lg">
          <Link href="/">Home</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </AuthCard>
  );
}

type StateBlockProps = {
  slot: string;
  icon: IconName;
  title: string;
  description: string;
  children?: ReactNode;
};

/** Figma `Empty state` (02 `10:94`) as used on page 03: 48px icon tile, h3, body, actions. */
function StateBlock({ slot, icon, title, description, children }: StateBlockProps) {
  return (
    <section
      data-slot={slot}
      className="mx-auto flex w-full max-w-140 flex-col items-center gap-3 px-6 py-6 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-secondary">
        <Icon name={icon} size={24} className="text-muted-foreground" />
      </span>
      <h2 className="type-h3 text-foreground">{title}</h2>
      <p className="type-body text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

/** Figma `03/not-found/in-app` (`530:73867`). */
function InAppNotFound() {
  return (
    <StateBlock
      slot="in-app-not-found"
      icon="link"
      title="This page is not here"
      description="The link may be old, or the page moved."
    >
      <div className="flex justify-center gap-2">
        <Button asChild>
          <Link href="/home">Go to Home</Link>
        </Button>
        <Button variant="outline" onClick={() => window.history.back()}>
          <Icon name="arrow-left" size={16} />
          Go back
        </Button>
      </div>
    </StateBlock>
  );
}

type InAppErrorProps = {
  digest?: string;
  onRetry: () => void;
};

/** Figma `03/error/in-app` (`530:74005`): 64px destructive tile, copy, mono error id, actions. */
function InAppError({ digest, onRetry }: InAppErrorProps) {
  return (
    <section
      data-slot="in-app-error"
      role="alert"
      className="mx-auto flex w-full max-w-140 flex-col items-center gap-3 px-6 text-center"
    >
      <span className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <Icon name="circle-alert" size={32} className="text-destructive" />
      </span>
      <h2 className="type-h3 mt-3 text-foreground">Something went wrong</h2>
      <p className="type-body text-muted-foreground">
        An unexpected error occurred. Please try again.
      </p>
      {digest ? <p className="type-mono text-muted-foreground">Error ID: {digest}</p> : null}
      <div className="mt-2 flex justify-center gap-2">
        <Button onClick={onRetry}>Try again</Button>
        <Button asChild variant="ghost">
          <Link href="/home">Go to Home</Link>
        </Button>
      </div>
    </section>
  );
}

type NoCompanyStateProps = {
  /** Owners can create a company; members can only ask for an invite. */
  isOwner: boolean;
};

/** Figma `03/no-company/{owner,member}` (`378:24597`, `378:24723`). */
function NoCompanyState({ isOwner }: NoCompanyStateProps) {
  if (isOwner) {
    return (
      <StateBlock
        slot="no-company"
        icon="building-2"
        title="No company selected"
        description="Pick a company to work in, or create one in Settings → Companies."
      >
        <Button asChild>
          <Link href="/settings/companies">Go to Settings</Link>
        </Button>
      </StateBlock>
    );
  }
  return (
    <StateBlock
      slot="no-company"
      icon="building-2"
      title="No company yet"
      description="Ask a company owner to add you to a company, then reload this page."
    />
  );
}

/** Centers a system state in the app content area (below the App header). */
function SystemStateFrame({ children }: { children: ReactNode }) {
  return (
    <div data-slot="system-state-frame" className="flex min-h-[60vh] items-center justify-center">
      {children}
    </div>
  );
}

export {
  AuthCard,
  AuthStage,
  InAppError,
  InAppNotFound,
  NoCompanyState,
  PublicNotFound,
  SystemStateFrame,
};
export type { AuthCardProps, InAppErrorProps, NoCompanyStateProps };
