"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useTransition,
  type ReactNode,
} from "react";
import type { Company } from "@/types";
import {
  normalizePagePermissions,
  type PagePermissionKey,
  type PagePermissions,
} from "@/db/schema";

type CompanyContextValue = {
  companies: Company[];
  activeCompanyId: string | null;
  activeCompany: Company | null;
  setActiveCompany: (companyId: string) => void;
  hasCompanies: boolean;
  isLoading: boolean;
  isActiveCompanyOwner: boolean;
  pagePermissions: PagePermissions;
  hasPageAccess: (page: PagePermissionKey) => boolean;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

async function updateActiveCompanyAction(companyId: string) {
  const response = await fetch("/api/user/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeCompanyId: companyId }),
  });
  if (!response.ok) {
    throw new Error("Failed to update active company");
  }
}

export function CompanyContextProvider({
  children,
  companies,
  initialActiveCompanyId,
  userId,
  permissionsByCompanyId,
}: {
  children: ReactNode;
  companies: Company[];
  initialActiveCompanyId?: string | null;
  userId: string;
  permissionsByCompanyId: Record<string, PagePermissions>;
}) {
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(
    initialActiveCompanyId ?? companies[0]?.id ?? null
  );
  const [isPending, startTransition] = useTransition();

  const activeCompany =
    companies.find((c) => c.id === activeCompanyId) ?? null;

  const isActiveCompanyOwner =
    activeCompany !== null && activeCompany.ownerId === userId;

  const pagePermissions = useMemo(() => {
    if (!activeCompanyId) {
      return normalizePagePermissions(undefined);
    }
    return normalizePagePermissions(permissionsByCompanyId[activeCompanyId]);
  }, [activeCompanyId, permissionsByCompanyId]);

  const hasPageAccess = useCallback(
    (page: PagePermissionKey) => pagePermissions[page] === true,
    [pagePermissions],
  );

  const setActiveCompany = useCallback(
    (companyId: string) => {
      setActiveCompanyId(companyId);
      startTransition(async () => {
        try {
          await updateActiveCompanyAction(companyId);
        } catch {
          // Revert on error — the UI already updated optimistically
          setActiveCompanyId(activeCompanyId);
        }
      });
    },
    [activeCompanyId]
  );

  return (
    <CompanyContext.Provider
      value={{
        companies,
        activeCompanyId,
        activeCompany,
        setActiveCompany,
        hasCompanies: companies.length > 0,
        isLoading: isPending,
        isActiveCompanyOwner,
        pagePermissions,
        hasPageAccess,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error("useCompany must be used within a CompanyContextProvider");
  }
  return context;
}
