"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { installPackage } from "@/app/(dashboard)/operator/package-actions";

// Operator-hub shortcut for the Lead engine package (spec 2026-10-02-packages). The full
// catalog and the owner-only install dialog live in Settings › Packages.
const LEAD_ENGINE_SLUG = "lead-engine";
const LEAD_ENGINE_NAME = "Lead engine";
const LEAD_ENGINE_DESCRIPTION =
  "Three agents gather accounts that fit, qualify them, and draft outreach a person approves before anything is sent.";
const LEAD_ENGINE_INSTALL_TOAST =
  "Add your offer under Knowledge so Lead engine does not invent pricing.";
const ALREADY_INSTALLED = `${LEAD_ENGINE_NAME} is already installed`;

type InstallPackageDialogProps = {
  companyId: string;
  variant: "empty" | "toolbar";
  /** First Lead engine agent when the package is installed. */
  leadEngineAgentId: string | null;
};

export function InstallPackageDialog({
  companyId,
  variant,
  leadEngineAgentId,
}: InstallPackageDialogProps) {
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const router = useRouter();
  const alreadyInstalled = Boolean(leadEngineAgentId);

  async function handleInstall() {
    setInstalling(true);
    try {
      const result = await installPackage({ companyId, slug: LEAD_ENGINE_SLUG });
      toast.success(LEAD_ENGINE_INSTALL_TOAST);
      setOpen(false);
      router.push(`/operator?agentId=${result.id}`);
      router.refresh();
    } catch (error) {
      const already =
        error instanceof Error && error.message === ALREADY_INSTALLED;
      if (already && leadEngineAgentId) {
        toast.error(ALREADY_INSTALLED);
        router.push(`/operator?agentId=${leadEngineAgentId}`);
        setOpen(false);
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Failed to install package",
      );
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Package className="mr-2 h-4 w-4" />
          {variant === "empty" ? `Install ${LEAD_ENGINE_NAME}` : "Install package"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install package</DialogTitle>
          <DialogDescription>
            Install a named operator package for this company.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold">{LEAD_ENGINE_NAME}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {LEAD_ENGINE_DESCRIPTION}
          </p>
        </div>
        <DialogFooter>
          {alreadyInstalled ? (
            <>
              <Button type="button" disabled>
                Install
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/operator?agentId=${leadEngineAgentId}`);
                }}
              >
                Open {LEAD_ENGINE_NAME}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={handleInstall} disabled={installing}>
              {installing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Install
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
