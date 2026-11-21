"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AccessMatrixRow, type AccessMatrixKey } from "@/components/v2/data";
import type { PagePermissionKey, PagePermissions } from "@/db/schema";

import { setMemberPageAccess } from "../members/actions";

export type AccessMatrixPerson = {
  userId: string;
  name: string;
  email: string;
  kind: "owner" | "member";
  roleLabel: string;
  pagePermissions: PagePermissions;
  /** Read-only: approves on at least one operator agent (granted per agent, not here). */
  approvesAny: boolean;
};

/** Matrix columns that map to a stored page key. `home` is always on and never saved. */
function toPageKey(key: AccessMatrixKey): PagePermissionKey | null {
  return key === "home" ? null : key;
}

/**
 * Settings › Access & roles matrix (Figma 08c access). Owner row is fixed; member rows toggle
 * page keys (`operator`, `messaging`, `analytics`). Agents stays owner-only (locked). There is
 * no `chat` or `approve` key: the approve column mirrors per-agent `canApprove` read-only.
 */
export function AccessMatrix({
  companyId,
  people,
}: {
  companyId: string;
  people: AccessMatrixPerson[];
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, PagePermissions>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  async function onAccessChange(person: AccessMatrixPerson, key: AccessMatrixKey, granted: boolean) {
    const pageKey = toPageKey(key);
    if (!pageKey || person.kind === "owner") return;
    const current = overrides[person.userId] ?? person.pagePermissions;
    const next: PagePermissions = { ...current, [pageKey]: granted };

    setOverrides((prev) => ({ ...prev, [person.userId]: next }));
    setSavingUserId(person.userId);
    try {
      const result = await setMemberPageAccess(companyId, person.userId, next);
      if (!result.ok) throw new Error(result.message);
      toast.success("Page access updated");
      router.refresh();
    } catch (error) {
      setOverrides((prev) => ({ ...prev, [person.userId]: current }));
      toast.error(error instanceof Error && error.message ? error.message : "Failed to update access");
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <div role="table" aria-label="Page access by member" className="min-w-[56rem]">
        <AccessMatrixRow variant="header" />
        {people.map((person) => {
          const perms = overrides[person.userId] ?? person.pagePermissions;
          return person.kind === "owner" ? (
            <AccessMatrixRow
              key={person.userId}
              variant="owner"
              name={person.name}
              email={person.email}
              role={person.roleLabel}
              className="last:border-b-0"
            />
          ) : (
            <AccessMatrixRow
              key={person.userId}
              variant="member"
              name={person.name}
              email={person.email}
              role={person.roleLabel}
              access={{
                operator: perms.operator,
                messaging: perms.messaging,
                analytics: perms.analytics,
              }}
              readOnly={savingUserId === person.userId}
              onAccessChange={(key, granted) => onAccessChange(person, key, granted)}
              canApprove={person.approvesAny}
              // Approve rights are granted per agent (Agents › Access); this switch only mirrors them.
              approveReadOnly
              className="last:border-b-0"
            />
          );
        })}
      </div>
    </div>
  );
}
