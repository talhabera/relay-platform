"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { AdChannel } from "@relay/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/v2/primitives";
import { minorToTryLabel, parseTryToMinor } from "@/lib/ad-spend/money";
import { capWarnings } from "@/lib/ad-spend/spend-grid";

import { saveDailySpend, type SaveDailySpendResult } from "./actions";

type SpendEntryFormProps = {
  date: string;
  today: string;
  capMinor: number;
  channels: readonly AdChannel[];
  channelLabels: Record<AdChannel, string>;
  /** Spend already stored for `date`, per channel (absent = girilmedi). */
  existing: Partial<Record<AdChannel, number>>;
};

type Values = Record<AdChannel, string>;

function emptyValues(channels: readonly AdChannel[]): Values {
  return Object.fromEntries(channels.map((c) => [c, ""])) as Values;
}

/**
 * The two-minute path (K10): one row per channel for one Istanbul date, one
 * Save. Empty means "do not write"; a typed 0 is stored. The planned daily
 * budgets only drive the "ayarlı toplam" warning and are not stored.
 */
export function SpendEntryForm({ date, today, capMinor, channels, channelLabels, existing }: SpendEntryFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [amounts, setAmounts] = useState<Values>(() => emptyValues(channels));
  const [planned, setPlanned] = useState<Values>(() => emptyValues(channels));
  const [result, setResult] = useState<SaveDailySpendResult | null>(null);
  const [pending, startTransition] = useTransition();

  const plannedMinors = channels
    .map((c) => (planned[c].trim() === "" ? null : parseTryToMinor(planned[c])))
    .filter((v): v is number => v !== null);
  const configuredDailyMinor = plannedMinors.length > 0 ? plannedMinors.reduce((a, b) => a + b, 0) : null;
  const configuredWarning = capWarnings({ configuredDailyMinor, days: [], capMinor }).find(
    (w) => w.kind === "configured-over-cap",
  );

  function changeDate(next: string) {
    if (!next) return;
    setResult(null);
    setAmounts(emptyValues(channels));
    router.push(`${pathname}?date=${next}&month=${next.slice(0, 7)}`);
  }

  function save(allowOverApi: boolean) {
    startTransition(async () => {
      const res = await saveDailySpend({
        date,
        entries: channels.map((channel) => ({ channel, amount: amounts[channel] })),
        allowOverApi,
      });
      setResult(res);
      if (res.ok && res.apiConflicts.length === 0) setAmounts(emptyValues(channels));
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save(false);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="spend-date">Tarih</Label>
        <Input
          id="spend-date"
          type="date"
          className="w-[180px]"
          value={date}
          max={today}
          onChange={(event) => changeDate(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-[minmax(120px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)] items-center gap-x-3 gap-y-2">
        <span className="type-label text-muted-foreground">Kanal</span>
        <span className="type-label text-muted-foreground">Harcanan (TL)</span>
        <span className="type-label text-muted-foreground">Ayarlı günlük bütçe (TL)</span>
        {channels.map((channel) => {
          const stored = existing[channel];
          return (
            <div key={channel} className="contents">
              <Label htmlFor={`amount-${channel}`}>{channelLabels[channel]}</Label>
              <Input
                id={`amount-${channel}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder={stored === undefined ? "girilmedi" : `kayıtlı: ${minorToTryLabel(stored)}`}
                value={amounts[channel]}
                onChange={(event) => setAmounts((prev) => ({ ...prev, [channel]: event.target.value }))}
              />
              <Input
                id={`planned-${channel}`}
                aria-label={`${channelLabels[channel]} ayarlı günlük bütçe`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="isteğe bağlı"
                value={planned[channel]}
                onChange={(event) => setPlanned((prev) => ({ ...prev, [channel]: event.target.value }))}
              />
            </div>
          );
        })}
      </div>

      {configuredWarning ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 type-small">
          <Icon name="triangle-alert" className="mt-0.5 size-4 shrink-0" />
          <span>
            Ayarlı toplam: kampanyaların günlük bütçeleri toplamı {minorToTryLabel(configuredWarning.configuredMinor)},
            günlük sınır {minorToTryLabel(capMinor)}. Bütçeleri düşürün.
          </span>
        </div>
      ) : null}

      <p className="type-caption text-muted-foreground">
        Boş bırakılan kanal kaydedilmez. 0 yazarsanız 0 TL olarak kaydedilir. Aynı gün tekrar girilirse eski tutarın
        üzerine yazılır.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Icon name="check" />
          Kaydet
        </Button>
        {result && !result.ok ? <span className="type-small text-destructive">{result.message}</span> : null}
        {result && result.ok ? (
          <span className="type-small text-muted-foreground">
            Kaydedildi: {result.written} kanal ({result.overwritten} güncellendi).
          </span>
        ) : null}
      </div>

      {result && result.ok && result.apiConflicts.length > 0 ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3 type-small">
          <span>
            {result.apiConflicts.map((c) => channelLabels[c.channel]).join(", ")} için bu gün API&apos;den gelen kayıt
            var ve değiştirilmedi.
          </span>
          <Button type="button" variant="outline" disabled={pending} onClick={() => save(true)}>
            API kaydının üzerine yaz
          </Button>
        </div>
      ) : null}
    </form>
  );
}
