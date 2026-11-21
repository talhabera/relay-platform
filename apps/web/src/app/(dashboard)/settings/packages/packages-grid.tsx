"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BrandGlyph, Icon, type IconName } from "@/components/v2/primitives";
import { PackageCard } from "@/components/v2/work";

import { installCompanyPackage } from "./actions";
import type { InstallSummary, PackageCardModel } from "./package-view";

/** Figma 08c `packages` / `packages-available`: one Package card per catalog package. */
export function PackagesGrid({ companyId, models }: { companyId: string; models: PackageCardModel[] }) {
  const [installing, setInstalling] = useState<InstallSummary | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {models.map(({ slug, card, install }) => (
          <PackageCard
            key={slug}
            {...card}
            onAction={install ? () => setInstalling(install) : undefined}
          />
        ))}
      </div>
      <InstallPackageSheet
        key={installing?.slug ?? "none"}
        companyId={companyId}
        summary={installing}
        onClose={() => setInstalling(null)}
      />
    </>
  );
}

function AddsRow({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <span className="flex items-center gap-2 type-small text-muted-foreground">
        <Icon name={icon} size={14} />
        {label}
      </span>
      <div className="flex flex-col gap-1 type-small text-foreground">{children}</div>
    </div>
  );
}

/** Figma 08c `packages-install`: what the package adds, required connectors first. Owner only. */
function InstallPackageSheet({
  companyId,
  summary,
  onClose,
}: {
  companyId: string;
  summary: InstallSummary | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function install() {
    if (!summary) return;
    setPending(true);
    try {
      const result = await installCompanyPackage({ companyId, slug: summary.slug });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.waiting
          ? `${summary.name} installed. Its schedules wait for the required connectors.`
          : `${summary.name} installed`,
      );
      onClose();
      router.refresh();
    } catch {
      toast.error("Failed to install package");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={summary !== null} onOpenChange={(open) => (open ? null : onClose())}>
      {summary ? (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{summary.title}</DialogTitle>
            <DialogDescription>{summary.description}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <span className="type-label text-muted-foreground">This adds</span>
            <AddsRow icon="bot" label={summary.agents.length === 1 ? "Agent" : "Agents"}>
              {summary.agents.map((name) => (
                <span key={name} className="flex items-center gap-2">
                  {name}
                  <span className="rounded-full bg-status-live px-2 type-caption text-status-live-foreground">v1 Live</span>
                </span>
              ))}
            </AddsRow>
            <AddsRow icon="workflow" label="Workflows">
              {summary.workflows.map((name) => (
                <span key={name}>{name}</span>
              ))}
            </AddsRow>
            <AddsRow icon="calendar-clock" label="Schedules">
              {summary.schedules.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </AddsRow>
          </div>

          {summary.connectFirst.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="type-label text-muted-foreground">Connect first</span>
              {summary.connectFirst.map((c) => (
                <div
                  key={c.type}
                  data-slot="install-connect-first"
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  {c.brand ? <BrandGlyph brand={c.brand} size={24} /> : <Icon name="plug" size={20} />}
                  <div className="min-w-0 flex-1">
                    <p className="type-body-strong text-foreground">{c.name}</p>
                    <p className="flex items-center gap-1 type-caption text-warning">
                      <Icon name="circle-alert" size={12} />
                      Required · not connected
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/settings/connectors">Connect</Link>
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {summary.optionalNote ? (
            <p className="type-caption text-muted-foreground">{summary.optionalNote}</p>
          ) : null}

          <div className="flex items-start gap-2 rounded-lg bg-muted p-3 type-caption text-foreground">
            <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
            <span>
              Nothing leaves Relay without a checkpoint. Every outbound step waits for your approval before
              it goes out.
            </span>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={install} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Install package
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
