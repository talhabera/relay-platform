import Link from "next/link";

import { AD_CHANNELS, type AdChannel } from "@relay/db";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/v2/primitives";
import { NoCompanyState, PageRestricted, SystemStateFrame } from "@/components/v2/shell";
import { requireSession } from "@/lib/auth-server";
import { minorToTryLabel } from "@/lib/ad-spend/money";
import { buildMonthGrid, capWarnings } from "@/lib/ad-spend/spend-grid";
import { getDailyCap, listSpendForMonth } from "@/lib/ad-spend/spend-queries";

import { resolveAnalyticsAccess } from "../_overview/analytics-access";
import { CsvUpload } from "./csv-upload";
import { SpendEntryForm } from "./spend-entry-form";
import { CHANNEL_LABELS, SpendGridView } from "./spend-grid-view";

const SPEND_TIME_ZONE = "Europe/Istanbul";

const MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

type SpendPageProps = {
  searchParams: Promise<{ month?: string; date?: string }>;
};

/** Civil date (`YYYY-MM-DD`) of `at` in Istanbul. */
function istanbulDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SPEND_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function shiftMonth(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}

function isCivilDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftDate(value, 0) === value;
}

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function title(subtitle: string) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="type-h1 text-foreground">Reklam harcaması</h1>
        <p className="truncate type-small text-muted-foreground">{subtitle}</p>
      </div>
      <Button asChild variant="outline">
        <Link href="/analytics">
          <Icon name="arrow-left" />
          Analytics
        </Link>
      </Button>
    </div>
  );
}

export default async function AdSpendPage({ searchParams }: SpendPageProps) {
  const session = await requireSession();
  const params = await searchParams;

  const access = await resolveAnalyticsAccess(session.user.id);
  if (access.kind === "no-company") {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={access.isOwner} />
      </SystemStateFrame>
    );
  }
  if (access.kind === "restricted") {
    return (
      <div className="space-y-6">
        {title(`${access.company.name} için günlük reklam harcaması`)}
        <div className="flex justify-center">
          <PageRestricted
            title="Analytics isn't available"
            description="Ask an owner to grant you Analytics access for this company."
          />
        </div>
      </div>
    );
  }

  const company = access.company;
  const today = istanbulDate(new Date());
  const thisMonth = today.slice(0, 7);
  const date = isCivilDate(params.date) && params.date <= today ? params.date : shiftDate(today, -1);
  const month =
    params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) && params.month <= thisMonth
      ? params.month
      : date.slice(0, 7);

  const [rows, capMinor] = await Promise.all([listSpendForMonth(company.id, month), getDailyCap(company.id)]);
  const dateRows = date.startsWith(month) ? rows : await listSpendForMonth(company.id, date.slice(0, 7));

  const existing: Partial<Record<AdChannel, number>> = {};
  for (const row of dateRows) {
    if (row.spendDate === date) existing[row.channel] = (existing[row.channel] ?? 0) + row.amountMinor;
  }

  const grid = buildMonthGrid(rows, month, AD_CHANNELS, month === thisMonth ? today : undefined);
  const actualWarnings = capWarnings({
    configuredDailyMinor: null,
    days: grid.days,
    capMinor,
    monthMinor: grid.enteredMinor,
  });
  const dayWarnings = actualWarnings.filter((w) => w.kind === "actual-day-over-cap");
  const monthWarning = actualWarnings.find((w) => w.kind === "month-over-cap");
  const overCapDates = new Set(dayWarnings.map((w) => w.date));

  return (
    <div className="flex flex-col gap-6">
      {title(`${company.name} için günlük reklam harcaması, günlük sınır ${minorToTryLabel(capMinor)}`)}

      <section className="flex flex-col gap-3 rounded-xl border border-border p-5">
        <h2 className="type-h3 text-foreground">Günlük giriş</h2>
        <SpendEntryForm
          date={date}
          today={today}
          capMinor={capMinor}
          channels={AD_CHANNELS}
          channelLabels={CHANNEL_LABELS}
          existing={existing}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border p-5">
        <h2 className="type-h3 text-foreground">CSV yükle</h2>
        <CsvUpload />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="type-h3 flex-1 text-foreground">{monthTitle(month)}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={`/analytics/spend?month=${shiftMonth(month, -1)}&date=${date}`}>
              <Icon name="chevron-left" />
              Önceki ay
            </Link>
          </Button>
          {month < thisMonth ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/analytics/spend?month=${shiftMonth(month, 1)}&date=${date}`}>
                Sonraki ay
                <Icon name="chevron-right" />
              </Link>
            </Button>
          ) : null}
        </div>

        {dayWarnings.length > 0 ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 type-small">
            <Icon name="triangle-alert" className="mt-0.5 size-4 shrink-0" />
            <span>
              Gerçekleşen harcama {dayWarnings.length} günde günlük sınırı ({minorToTryLabel(capMinor)}) aştı:{" "}
              {dayWarnings.map((w) => `${w.date.slice(8)}.${w.date.slice(5, 7)} ${minorToTryLabel(w.actualMinor)}`).join(", ")}.
              Tek gün aşabilir; ay toplamı aşmamalı.
            </span>
          </div>
        ) : null}

        {monthWarning ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 type-small">
            <Icon name="circle-alert" className="mt-0.5 size-4 shrink-0" />
            <span>
              Ay toplamı {minorToTryLabel(monthWarning.monthMinor)}, aylık sınırı ({minorToTryLabel(monthWarning.limitMinor)})
              aştı.
            </span>
          </div>
        ) : null}

        <SpendGridView grid={grid} capMinor={capMinor} overCapDates={overCapDates} />
      </section>
    </div>
  );
}
