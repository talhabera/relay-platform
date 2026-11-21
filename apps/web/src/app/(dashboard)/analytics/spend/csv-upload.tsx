"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/v2/primitives";
import { minorToTryLabel } from "@/lib/ad-spend/money";

import { importSpendCsv, type ImportSpendCsvResult } from "./actions";

const PLATFORM_LABELS = { google: "Google Ads", meta: "Meta" } as const;

function dayLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

/**
 * Google Ads / Meta CSV: first a dry run that shows what would be written
 * (or why the file is rejected), then an explicit confirm writes it.
 */
export function CsvUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportSpendCsvResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(mode: "preview" | "write" | "write-over-api") {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    if (mode === "preview") form.set("dryRun", "1");
    if (mode === "write-over-api") form.set("allowOverApi", "1");
    startTransition(async () => setResult(await importSpendCsv(form)));
  }

  const preview = result && result.ok ? result.preview : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="spend-csv">Google Ads veya Meta CSV dosyası (TRY, en fazla 2 MB)</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="spend-csv"
            type="file"
            accept=".csv,text/csv"
            className="max-w-sm"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
          <Button type="button" variant="outline" disabled={!file || pending} onClick={() => submit("preview")}>
            <Icon name="eye" />
            Önizle
          </Button>
        </div>
      </div>

      {result && !result.ok ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 type-small">
          Dosya yüklenmedi: {result.message}
        </div>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 type-small">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Kaynak</dt>
            <dd>{PLATFORM_LABELS[preview.platform]}</dd>
            <dt className="text-muted-foreground">Satır</dt>
            <dd>{preview.rows}</dd>
            <dt className="text-muted-foreground">Tarih aralığı</dt>
            <dd>
              {dayLabel(preview.from)} ile {dayLabel(preview.to)} arası
            </dd>
            <dt className="text-muted-foreground">Toplam</dt>
            <dd>{minorToTryLabel(preview.totalMinor)}</dd>
            <dt className="text-muted-foreground">Tekrarlanan satır</dt>
            <dd>{preview.duplicates} (son satır geçerli)</dd>
            <dt className="text-muted-foreground">Atlanan toplam satırı</dt>
            <dd>{preview.skippedSummary}</dd>
          </dl>

          {result && result.ok && result.dryRun ? (
            <div>
              <Button type="button" disabled={pending} onClick={() => submit("write")}>
                <Icon name="upload" />
                Onayla ve kaydet
              </Button>
            </div>
          ) : null}

          {result && result.ok && !result.dryRun ? (
            <p>
              Kaydedildi: {result.written} satır ({result.overwritten} güncellendi, {result.duplicates} tekrar,{" "}
              {result.skippedApi} API kaydı atlandı).
            </p>
          ) : null}

          {result && result.ok && !result.dryRun && result.skippedApi > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <span>{result.skippedApi} satır için API&apos;den gelen kayıt var ve değiştirilmedi.</span>
              <Button type="button" variant="outline" disabled={pending} onClick={() => submit("write-over-api")}>
                API kayıtlarının üzerine yaz
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
