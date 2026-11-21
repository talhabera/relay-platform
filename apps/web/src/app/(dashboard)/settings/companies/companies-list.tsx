"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CompanyRow } from "@/components/v2/data";
import { IconButton } from "@/components/v2/primitives";

import { setActiveCompany } from "./actions";
import { currentCompanyDeleteHint, type CompanyDeleteImpact, type CompanyListItem } from "./company-view";
import { DeleteCompanyDialog } from "./delete-company-dialog";
import { deleteCompanyConfirmed, getCompanyDeleteImpact } from "./delete-actions";

/** Figma 08c `companies`: one Company row per accessible company, owner rows get a menu. */
export function CompaniesList({ companies }: { companies: CompanyListItem[] }) {
  const router = useRouter();
  const [switching, startSwitch] = useTransition();
  const [target, setTarget] = useState<CompanyListItem | null>(null);
  const [impact, setImpact] = useState<CompanyDeleteImpact | null>(null);

  function switchTo(company: CompanyListItem) {
    startSwitch(async () => {
      try {
        await setActiveCompany(company.id);
        router.refresh();
      } catch {
        toast.error(`Couldn't switch to ${company.name}`);
      }
    });
  }

  function openDelete(company: CompanyListItem) {
    setTarget(company);
    setImpact(null);
    getCompanyDeleteImpact(company.id)
      .then(setImpact)
      .catch(() => {
        toast.error("Couldn't load what this company holds");
        setTarget(null);
      });
  }

  async function confirmDelete(confirmName: string) {
    if (!target) return;
    const result = await deleteCompanyConfirmed({ companyId: target.id, confirmName });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`${target.name} deleted`);
    setTarget(null);
    router.refresh();
  }

  return (
    <TooltipProvider>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="min-w-[760px] [&>[data-slot=company-row]:last-child]:border-b-0">
          {companies.map((company) => (
            <CompanyRow
              key={company.id}
              state={company.current ? "current" : "default"}
              name={company.name}
              description={company.description}
              role={company.role}
              meta={company.meta}
              aria-busy={switching || undefined}
              onSwitch={() => switchTo(company)}
              actions={
                company.role === "Owner" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton icon="ellipsis" label={`Actions for ${company.name}`} size="sm" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem asChild>
                        <Link href={`/settings/companies/${company.id}`}>Edit details</Link>
                      </DropdownMenuItem>
                      {company.current ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="block">
                              <DropdownMenuItem disabled>Delete company</DropdownMenuItem>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{currentCompanyDeleteHint(company.name)}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <DropdownMenuItem variant="destructive" onSelect={() => openDelete(company)}>
                          Delete company
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="size-8 shrink-0" aria-hidden />
                )
              }
            />
          ))}
        </div>
      </div>

      <DeleteCompanyDialog
        key={target?.id ?? "none"}
        company={target}
        impact={impact}
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        onConfirm={confirmDelete}
      />
    </TooltipProvider>
  );
}
