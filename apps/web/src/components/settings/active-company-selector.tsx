"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Check, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setActiveCompany } from "@/app/(dashboard)/settings/companies/actions";
import type { Company } from "@/types";

type ActiveCompanySelectorProps = {
  companies: Company[];
  activeCompanyId: string | null;
};

export function ActiveCompanySelector({
  companies,
  activeCompanyId,
}: ActiveCompanySelectorProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);

  async function handleChange(companyId: string) {
    setIsUpdating(true);
    try {
      await setActiveCompany(companyId);
      const company = companies.find((c) => c.id === companyId);
      toast.success(`Switched to ${company?.name ?? "company"}`);
      router.refresh();
    } catch {
      toast.error("Failed to update active company");
    } finally {
      setIsUpdating(false);
    }
  }

  if (companies.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <Building2 className="h-5 w-5" />
        <p>
          No companies found. Create a company first to set your active
          workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Select
        defaultValue={activeCompanyId ?? undefined}
        onValueChange={handleChange}
        disabled={isUpdating}
      >
        <SelectTrigger className="w-full max-w-sm">
          <SelectValue placeholder="Select a company" />
        </SelectTrigger>
        <SelectContent>
          {companies.map((company) => (
            <SelectItem key={company.id} value={company.id}>
              <div className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5" />
                {company.name}
                {company.id === activeCompanyId && (
                  <Check className="h-3.5 w-3.5 text-primary" />
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isUpdating && <Loader2 className="h-4 w-4 animate-spin" />}
    </div>
  );
}
