"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import type { RequestAccessPlan } from "./plans";
import { RequestAccessDialog } from "./request-access-dialog";

/**
 * Single entry point for every marketing CTA (spec 2026-10-02-pricing-and-access-requests §6):
 * Request access, Contact sales and the footer Contact link all call `openRequestAccess(plan)`.
 * The dialog itself lives in `request-access-dialog.tsx` (placeholder until S103).
 */

type RequestAccessContextValue = { openRequestAccess: (plan?: RequestAccessPlan) => void };

const RequestAccessContext = React.createContext<RequestAccessContextValue | null>(null);

/** Hashes that open the dialog: the nav fallback link and the footer Contact link. */
const REQUEST_ACCESS_HASHES = new Set(["#request-access", "#contact"]);
const FALLBACK_HREF = "/#request-access";

function RequestAccessProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = React.useState<RequestAccessPlan>("none");
  const [open, setOpen] = React.useState(false);

  const openRequestAccess = React.useCallback((next: RequestAccessPlan = "none") => {
    setPlan(next);
    setOpen(true);
  }, []);

  // Links that land on /#request-access or /#contact (footer, other pages) open the dialog.
  React.useEffect(() => {
    const onHash = () => {
      if (!REQUEST_ACCESS_HASHES.has(window.location.hash)) return;
      openRequestAccess("none");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [openRequestAccess]);

  const value = React.useMemo(() => ({ openRequestAccess }), [openRequestAccess]);

  return (
    <RequestAccessContext.Provider value={value}>
      {children}
      <RequestAccessDialog open={open} onOpenChange={setOpen} plan={plan} />
    </RequestAccessContext.Provider>
  );
}

/** `openRequestAccess(plan)`, or null outside a RequestAccessProvider. */
function useRequestAccess(): RequestAccessContextValue | null {
  return React.useContext(RequestAccessContext);
}

type RequestAccessButtonProps = Omit<React.ComponentProps<typeof Button>, "onClick" | "asChild"> & {
  plan?: RequestAccessPlan;
};

/** A Button that opens the Request access dialog; links to `/#request-access` without a provider. */
function RequestAccessButton({ plan = "none", children = "Request access", ...props }: RequestAccessButtonProps) {
  const ctx = useRequestAccess();
  if (!ctx) {
    return (
      <Button asChild data-plan={plan} {...props}>
        <Link href={FALLBACK_HREF}>{children}</Link>
      </Button>
    );
  }
  return (
    <Button type="button" data-plan={plan} onClick={() => ctx.openRequestAccess(plan)} {...props}>
      {children}
    </Button>
  );
}

export { RequestAccessButton, RequestAccessProvider, useRequestAccess };
export type { RequestAccessButtonProps };
