"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
import { updateCompanyAdSettings } from "@/app/(dashboard)/settings/companies/ad-settings-actions";

/** Numbers only: money in kuruş minor units, capacities as counts. */
export type CompanyAdSettingsValues = {
  adMonthlyTargetMinor: number | null;
  adCplStopMinor: number | null;
  adDailyCapMinor: number | null;
  adCapacitySiteMonthly: number | null;
  adCapacitySocialMonthly: number | null;
};

type MoneyKey = "adMonthlyTargetMinor" | "adCplStopMinor" | "adDailyCapMinor";
type CapacityKey = "adCapacitySiteMonthly" | "adCapacitySocialMonthly";

const MONEY_FIELDS: Array<{ key: MoneyKey; label: string; minLira: number }> = [
  { key: "adMonthlyTargetMinor", label: "Aylık hedef", minLira: 0 },
  { key: "adCplStopMinor", label: "Başvuru başı durdurma eşiği", minLira: 0 },
  { key: "adDailyCapMinor", label: "Günlük harcama tavanı", minLira: 0.01 },
];

const CAPACITY_FIELDS: Array<{ key: CapacityKey; label: string }> = [
  { key: "adCapacitySiteMonthly", label: "Aylık kapasite: site" },
  { key: "adCapacitySocialMonthly", label: "Aylık kapasite: sosyal medya" },
];

function liraDraft(minor: number | null): string {
  return minor === null ? "" : String(minor / 100);
}

/** Parses a lira draft (dot or comma decimals) to whole minor units. */
function parseLira(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

function parseCount(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}

export function CompanyAdSettingsForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: CompanyAdSettingsValues;
}) {
  const router = useRouter();
  const [money, setMoney] = useState<Record<MoneyKey, string>>({
    adMonthlyTargetMinor: liraDraft(initial.adMonthlyTargetMinor),
    adCplStopMinor: liraDraft(initial.adCplStopMinor),
    adDailyCapMinor: liraDraft(initial.adDailyCapMinor),
  });
  const [capacity, setCapacity] = useState<Record<CapacityKey, string>>({
    adCapacitySiteMonthly:
      initial.adCapacitySiteMonthly === null
        ? ""
        : String(initial.adCapacitySiteMonthly),
    adCapacitySocialMonthly:
      initial.adCapacitySocialMonthly === null
        ? ""
        : String(initial.adCapacitySocialMonthly),
  });
  const [saving, setSaving] = useState(false);

  const parsedMoney = MONEY_FIELDS.map((field) => ({
    field,
    minor: parseLira(money[field.key]),
  }));
  const parsedCapacity = CAPACITY_FIELDS.map((field) => ({
    field,
    count: parseCount(capacity[field.key]),
  }));
  const invalid =
    parsedMoney.some(
      ({ field, minor }) =>
        minor === undefined ||
        (minor !== null && minor < Math.round(field.minLira * 100)),
    ) || parsedCapacity.some(({ count }) => count === undefined);

  async function onSave() {
    if (invalid) return;
    setSaving(true);
    try {
      await updateCompanyAdSettings(companyId, {
        adMonthlyTargetMinor: parsedMoney[0]!.minor ?? null,
        adCplStopMinor: parsedMoney[1]!.minor ?? null,
        adDailyCapMinor: parsedMoney[2]!.minor ?? null,
        adCapacitySiteMonthly: parsedCapacity[0]!.count ?? null,
        adCapacitySocialMonthly: parsedCapacity[1]!.count ?? null,
      });
      toast.success("Reklam ayarları kaydedildi");
      router.refresh();
    } catch {
      toast.error("Reklam ayarları kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reklam ayarları</CardTitle>
        <CardDescription>
          Tutarlar lira olarak girilir, kuruş olarak saklanır. Boş alan kural
          yok demektir. Kapasite 0, o ürün için yeni satış alınmayacağı
          anlamına gelir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {parsedMoney.map(({ field, minor }) => {
          const inputId = `ad-setting-${field.key}`;
          const isInvalid =
            minor === undefined ||
            (minor !== null && minor < Math.round(field.minLira * 100));
          return (
            <div
              key={field.key}
              className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <Label htmlFor={inputId}>{field.label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={inputId}
                  type="text"
                  inputMode="decimal"
                  placeholder="—"
                  value={money[field.key]}
                  aria-invalid={isInvalid}
                  onChange={(e) =>
                    setMoney((d) => ({ ...d, [field.key]: e.target.value }))
                  }
                  className="w-36"
                />
                <span className="w-8 text-xs text-muted-foreground">TL</span>
              </div>
              {isInvalid && (
                <p className="text-xs text-destructive sm:col-span-2">
                  {field.minLira > 0
                    ? "0'dan büyük bir tutar girin ya da boş bırakın."
                    : "0 veya daha büyük bir tutar girin ya da boş bırakın."}
                </p>
              )}
            </div>
          );
        })}
        {parsedCapacity.map(({ field, count }) => {
          const inputId = `ad-setting-${field.key}`;
          const isInvalid = count === undefined;
          return (
            <div
              key={field.key}
              className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <Label htmlFor={inputId}>{field.label}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={inputId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="—"
                  value={capacity[field.key]}
                  aria-invalid={isInvalid}
                  onChange={(e) =>
                    setCapacity((d) => ({ ...d, [field.key]: e.target.value }))
                  }
                  className="w-36"
                />
                <span className="w-8 text-xs text-muted-foreground">adet</span>
              </div>
              {isInvalid && (
                <p className="text-xs text-destructive sm:col-span-2">
                  0 veya daha büyük bir tam sayı girin ya da boş bırakın.
                </p>
              )}
            </div>
          );
        })}
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving || invalid}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Kaydet
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
