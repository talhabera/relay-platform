import { Download } from "lucide-react";
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
import {
  CONVERSION_QUALIFIED,
  CONVERSION_WON,
  MAX_EXPORT_DAYS,
  defaultExportDays,
} from "@/lib/ads/offline-conversions";

const EXPECTED_TIMEZONE = "Europe/Istanbul";

/**
 * Download form for the Google Ads offline conversions CSV. A plain GET form:
 * the route answers with the file, so no client JavaScript is needed.
 */
export function CompanyOfflineConversionsCard({
  companyId,
  timeZone,
}: {
  companyId: string;
  timeZone: string;
}) {
  const { fromDay, toDay } = defaultExportDays(timeZone);
  const timezoneNotSet = timeZone === "UTC";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Offline conversions</CardTitle>
        <CardDescription>
          Google Ads upload file: one row per first qualification and one per
          won sale of leads that came from a Google ad click, in the chosen
          local days (up to {MAX_EXPORT_DAYS} days).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {timeZone !== EXPECTED_TIMEZONE && (
          <p
            role="note"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
          >
            {timezoneNotSet
              ? "The company timezone is still the UTC default, so the export is refused. Set the timezone in General Settings first."
              : `The company timezone is ${timeZone}, not ${EXPECTED_TIMEZONE}. Conversion times are written in ${timeZone}.`}
          </p>
        )}

        <form
          method="get"
          action={`/settings/companies/${companyId}/offline-conversions`}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="offline-conversions-from">From</Label>
            <Input
              id="offline-conversions-from"
              name="from"
              type="date"
              defaultValue={fromDay}
              required
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="offline-conversions-to">To</Label>
            <Input
              id="offline-conversions-to"
              name="to"
              type="date"
              defaultValue={toDay}
              required
              className="w-40"
            />
          </div>
          <Button type="submit" disabled={timezoneNotSet}>
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
        </form>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Upload the file in Google Ads under Tools &gt; Conversions &gt;
            Uploads.
          </li>
          <li>
            The conversion actions must exist with the exact names &quot;
            {CONVERSION_QUALIFIED}&quot; and &quot;{CONVERSION_WON}&quot;.
          </li>
          <li>Keep &quot;Include in Conversions&quot; off for both actions.</li>
          <li>
            Re-uploading an overlapping range is safe: Google de-duplicates on
            the Order ID column.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
