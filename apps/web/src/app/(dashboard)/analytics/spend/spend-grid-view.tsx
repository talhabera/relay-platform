import type { AdChannel } from "@relay/db";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { minorToTryLabel } from "@/lib/ad-spend/money";
import { monthLimitMinor, monthSpendLabel, type MonthGrid } from "@/lib/ad-spend/spend-grid";

export const CHANNEL_LABELS: Record<AdChannel, string> = {
  google: "Google Ads",
  instagram: "Instagram",
  meta: "Meta",
};

function dayLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

type SpendGridViewProps = {
  grid: MonthGrid;
  capMinor: number;
  /** Days whose actual spend is above the daily cap. */
  overCapDates: ReadonlySet<string>;
};

/** Month grid (design 6.5): a missing cell reads "girilmedi", never 0. */
export function SpendGridView({ grid, capMinor, overCapDates }: SpendGridViewProps) {
  if (grid.days.length === 0) {
    return <p className="type-small text-muted-foreground">Bu ay için henüz gün yok.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Gün</TableHead>
          {grid.channels.map((channel) => (
            <TableHead key={channel} className="text-right">
              {CHANNEL_LABELS[channel]}
            </TableHead>
          ))}
          <TableHead className="text-right">Gün toplamı</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grid.days.map((day) => (
          <TableRow key={day.date} className={overCapDates.has(day.date) ? "bg-warning/10" : undefined}>
            <TableCell className="type-mono">{dayLabel(day.date)}</TableCell>
            {grid.channels.map((channel) => {
              const cell = day.cells[channel];
              return (
                <TableCell key={channel} className="text-right tabular-nums">
                  {cell.state === "entered" ? (
                    minorToTryLabel(cell.amountMinor)
                  ) : (
                    <span className="text-muted-foreground">girilmedi</span>
                  )}
                </TableCell>
              );
            })}
            <TableCell className="text-right tabular-nums">
              {day.totalMinor !== null ? (
                minorToTryLabel(day.totalMinor)
              ) : (
                <span className="text-muted-foreground">eksik</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={grid.channels.length + 1}>
            Ay toplamı (aylık sınır {minorToTryLabel(monthLimitMinor(capMinor))})
          </TableCell>
          <TableCell className="text-right tabular-nums">{monthSpendLabel(grid)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
