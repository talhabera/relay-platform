import Link from "next/link";

import { ProgressBar, StatusChip } from "@/components/v2/primitives";
import {
  dayLabelTr,
  formatSpend,
  formatTry,
  type AdChannelRow,
  type AdReportModel,
  type AdSpan,
  type AdSpendCell,
  type AdTotalSpan,
} from "@/lib/ads/ad-report-model";
import { cn } from "@/lib/utils";

import { HomeTile } from "./home-view";

const IMMATURE_TITLE = "Son 2 gunun verisi olgunlasmadi: reklam platformlari harcama ve donusumleri gec duzeltir.";
const COLUMNS = ["Kanal", "Harcama", "Basvuru", "Nitelikli", "Gorusme", "Teklif", "Satis", "Basvuru basi", "Tutar"];
const SPEND_ENTRY_HREF = "/analytics/spend";

function SpendCell({ cell }: { cell: AdSpendCell | null }) {
  if (cell === null) return <span className="text-muted-foreground">-</span>;
  if (cell.minor === null) return <span className="text-muted-foreground">girilmedi</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {formatSpend(cell)}
      {cell.state === "partial" ? (
        <StatusChip tone="pending" dot={false} title="Bu donemde kismi (onaylanmamis) gun var">
          kismi
        </StatusChip>
      ) : null}
      {cell.missingDays.length > 0 ? (
        <StatusChip tone="needs-you" dot={false} title={`Girilmeyen gunler: ${cell.missingDays.map(dayLabelTr).join(", ")}`}>
          {cell.missingDays.length} gun girilmedi
        </StatusChip>
      ) : null}
    </span>
  );
}

function SpanCells({ span }: { span: AdSpan | AdTotalSpan }) {
  return (
    <>
      <td className="px-2 py-1.5">
        <SpendCell cell={span.spend} />
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">{span.leads}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{span.qualified}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{span.meetings}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{span.proposals}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{span.won}</td>
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{formatTry(span.cplMinor)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{formatTry(span.signedMinor)}</td>
    </>
  );
}

function SpanBlock({
  title,
  rows,
  total,
  pick,
  model,
  footer,
}: {
  title: string;
  rows: AdChannelRow[];
  total: AdTotalSpan;
  pick: "yesterday" | "month";
  model: AdReportModel;
  footer?: React.ReactNode;
}) {
  return (
    <tbody>
      <tr>
        <th colSpan={COLUMNS.length} scope="colgroup" className="px-2 pt-3 pb-1 text-left type-caption text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            {title}
            <StatusChip tone="neutral" dot={false} title={IMMATURE_TITLE}>
              olgunlasmadi
            </StatusChip>
          </span>
        </th>
      </tr>
      {rows.map((row) => (
        <MaybeMetaRows key={row.channel} row={row} pick={pick} model={model} />
      ))}
      <tr className="border-t border-border type-body-strong">
        <th scope="row" className="px-2 py-1.5 text-left">
          Toplam
        </th>
        <SpanCells span={total} />
      </tr>
      {footer}
    </tbody>
  );
}

function MaybeMetaRows({ row, pick, model }: { row: AdChannelRow; pick: "yesterday" | "month"; model: AdReportModel }) {
  const main = (
    <tr className="border-t border-border">
      <th scope="row" className={cn("px-2 py-1.5 text-left font-normal", row.channel === "unknown" && "text-muted-foreground")}>
        {row.label}
      </th>
      <SpanCells span={row[pick]} />
    </tr>
  );
  if (row.channel !== "meta" || pick !== "month" || model.metaCampaigns.length === 0) return main;
  return (
    <>
      {main}
      {model.metaCampaigns.map((c) => (
        <tr key={c.campaign ?? "-"} className="type-caption text-muted-foreground">
          <th scope="row" className="py-1 pr-2 pl-6 text-left font-normal">
            {c.campaign ?? "kampanya yok"}
          </th>
          <td className="px-2 py-1 whitespace-nowrap">{formatTry(c.spend)}</td>
          <td className="px-2 py-1 text-right tabular-nums">{c.leads}</td>
          <td className="px-2 py-1 text-right tabular-nums">{c.qualified}</td>
          <td className="px-2 py-1" />
          <td className="px-2 py-1" />
          <td className="px-2 py-1 text-right tabular-nums">{c.won}</td>
          <td className="px-2 py-1" />
          <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{formatTry(c.signedMinor)}</td>
        </tr>
      ))}
    </>
  );
}

function CashRow({ label, minor }: { label: string; minor: number | null }) {
  return (
    <tr className="border-t border-border">
      <th scope="row" colSpan={COLUMNS.length - 1} className="px-2 py-1.5 text-left font-normal">
        {label}
      </th>
      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap type-body-strong">{formatTry(minor)}</td>
    </tr>
  );
}

/**
 * Koleva reklam (RL6): yesterday and month-to-date ad spend, funnel and sales
 * per channel, cash in, target, capacity and warnings. Owners only by default.
 * Takes the projected model only; null is the empty state.
 */
export function AdReportTile({ model }: { model: AdReportModel | null }) {
  if (!model) {
    return (
      <HomeTile slot="ad-report" title="Koleva reklam">
        <p className="type-small text-muted-foreground">
          Henuz reklam verisi yok.{" "}
          <Link href={SPEND_ENTRY_HREF} className="underline underline-offset-2 hover:text-foreground">
            Harcama gir
          </Link>
        </p>
      </HomeTile>
    );
  }

  const { target, capacity } = model;
  const capacityParts = (
    [
      ["Site", capacity.website],
      ["Sosyal", capacity.social],
    ] as const
  ).filter(([, line]) => line.capacity !== null);

  return (
    <HomeTile
      slot="ad-report"
      title="Koleva reklam"
      titleExtra={<span className="type-caption text-muted-foreground">{dayLabelTr(model.today)}</span>}
      link={{ href: SPEND_ENTRY_HREF, label: "Harcama girisi" }}
    >
      {target ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3 type-small">
            <span>
              Ay hedefi <span className="type-body-strong">{formatTry(target.targetMinor)}</span>
            </span>
            <span>
              Satilan <span className="type-body-strong">{formatTry(target.signedMinor)}</span> ({target.percent}%)
            </span>
          </div>
          <ProgressBar value={target.barPercent} aria-label={`Ay hedefi %${target.percent}`} />
        </div>
      ) : null}

      <div className="-mx-2 max-w-full overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse type-small">
          <thead>
            <tr className="type-caption text-muted-foreground">
              {COLUMNS.map((c, i) => (
                <th key={c} scope="col" className={cn("px-2 py-1 font-normal whitespace-nowrap", i < 2 ? "text-left" : "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <SpanBlock title="Dun" rows={model.rows} total={model.totals.yesterday} pick="yesterday" model={model} />
          <SpanBlock
            title="Ay toplami"
            rows={model.rows}
            total={model.totals.month}
            pick="month"
            model={model}
            footer={
              <>
                <CashRow label="Kasaya giren (KDV haric)" minor={model.cashInMinor} />
                <CashRow label="Kasaya giren eksi harcama" minor={model.cashMinusSpendMinor} />
              </>
            }
          />
        </table>
      </div>

      {capacityParts.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 type-small">
          <span className="text-muted-foreground">Kapasite</span>
          {capacityParts.map(([name, line]) => (
            <span key={name} className="inline-flex items-center gap-1">
              {name} {line.won} / {line.capacity}
              {line.full ? (
                <StatusChip tone="needs-you" dot={false}>
                  dolu
                </StatusChip>
              ) : null}
            </span>
          ))}
        </p>
      ) : null}

      {model.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {model.warnings.map((w) => (
            <li key={`${w.kind}-${w.channel ?? ""}-${w.text}`} className="flex items-center gap-2 type-small">
              <StatusChip tone="needs-you" className="shrink-0">
                uyari
              </StatusChip>
              <span>{w.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </HomeTile>
  );
}
