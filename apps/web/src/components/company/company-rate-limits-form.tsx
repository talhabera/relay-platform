"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateCompanyRateLimits } from "@/app/(dashboard)/settings/companies/rate-limit-actions";
import type { RateLimitSettingGroup } from "@/lib/company/rate-limit-settings";

type Draft = Record<string, string>;

function initialDraft(groups: RateLimitSettingGroup[]): Draft {
  const draft: Draft = {};
  for (const group of groups) {
    for (const row of group.rows) {
      draft[row.name] = row.value === null ? "" : String(row.value);
    }
  }
  return draft;
}

export function CompanyRateLimitsForm({
  companyId,
  groups,
}: {
  companyId: string;
  groups: RateLimitSettingGroup[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(groups));
  const [saving, setSaving] = useState(false);

  const rows = groups.flatMap((group) => group.rows);
  const invalid = rows.filter((row) => {
    const raw = draft[row.name]?.trim() ?? "";
    if (raw === "") return false;
    const n = Number(raw);
    return !Number.isInteger(n) || n < 0 || n > row.ceiling;
  });

  async function onSave() {
    if (invalid.length > 0) return;
    const values: Record<string, number> = {};
    for (const row of rows) {
      const raw = draft[row.name]?.trim() ?? "";
      if (raw !== "") values[row.name] = Number(raw);
    }
    setSaving(true);
    try {
      await updateCompanyRateLimits(companyId, values);
      toast.success("Rate limits updated");
      router.refresh();
    } catch {
      toast.error("Failed to update rate limits");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Leave a field empty to use the platform default. 0 blocks the surface
        entirely. Changes apply within 30 seconds.
      </p>

      {groups.map((group) => (
        <Card key={group.id}>
          <CardHeader>
            <CardTitle>{group.label}</CardTitle>
            <CardDescription>
              {group.rows.length} limit{group.rows.length === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {group.rows.map((row) => {
              const isInvalid = invalid.includes(row);
              const inputId = `rate-limit-${row.name}`;
              return (
                <div
                  key={row.name}
                  className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="space-y-0.5">
                    <Label htmlFor={inputId}>{row.label}</Label>
                    <p className="text-xs text-muted-foreground">
                      {row.description} Default {row.defaultValue} {row.unit},
                      max {row.ceiling}.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      id={inputId}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={row.ceiling}
                      step={1}
                      placeholder={String(row.defaultValue)}
                      value={draft[row.name] ?? ""}
                      aria-invalid={isInvalid}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [row.name]: e.target.value }))
                      }
                      className="w-28"
                    />
                    <span className="w-20 text-xs text-muted-foreground">
                      {row.unit}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Reset ${row.label} to default`}
                      disabled={(draft[row.name] ?? "") === ""}
                      onClick={() =>
                        setDraft((d) => ({ ...d, [row.name]: "" }))
                      }
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                  {isInvalid && (
                    <p className="text-xs text-destructive sm:col-span-2">
                      Enter a whole number from 0 to {row.ceiling}.
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving || invalid.length > 0}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save rate limits
        </Button>
      </div>
    </div>
  );
}
