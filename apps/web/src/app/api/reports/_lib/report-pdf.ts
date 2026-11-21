import { eq } from "drizzle-orm";
import { reportTimeZone } from "@relay/db/report-snapshots";

import { db } from "@/db";
import { companies } from "@/db/schema";
import type { ReportSnapshot } from "@/lib/fixtures/interfaces";
import { getReportSnapshot } from "@/lib/reports/read";
import { buildReportView } from "@/lib/reports/view";

import { renderReportPrintHtml, reportPdfFileName } from "./print-html";

// Shared by the report PDF routes (S89): the share-link lookup and the print
// through the worker's headless Chromium. The portal lookup lives in
// `api/client/reports/_lib` (only portal code may call requireClientAccess).

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export type PrintableReport = {
  snapshot: ReportSnapshot;
  company: { id: string; name: string; timezone: string | null };
};

export type ReportLookup =
  | { ok: true; report: PrintableReport }
  | { ok: false; status: 401 | 403 | 404 };

/** The snapshot a verified share token names; 404 once it or its company is gone. */
export async function loadSharedReport(companyId: string, snapshotId: string): Promise<ReportLookup> {
  const company = await db.query.companies.findFirst({
    columns: { id: true, name: true, timezone: true },
    where: eq(companies.id, companyId),
  });
  if (!company) return { ok: false, status: 404 };
  const snapshot = await getReportSnapshot(company.id, snapshotId);
  if (!snapshot) return { ok: false, status: 404 };
  return { ok: true, report: { snapshot, company } };
}

/** Print HTML of a report (exported for tests and the worker call). */
export function reportPrintHtml(report: PrintableReport, now: Date = new Date()): string {
  const timeZone = reportTimeZone(report.company.timezone);
  return renderReportPrintHtml({
    view: buildReportView(report.snapshot, timeZone),
    companyName: report.company.name,
    generatedAt: now,
    timeZone,
  });
}

/** Ask the worker to print `html`; null when it is unavailable or fails. Never throws. */
export async function printPdfOnWorker(html: string): Promise<ArrayBuffer | null> {
  const base = process.env.WORKER_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) {
    console.error("[Reports] worker unavailable for PDF: set WORKER_URL and WORKER_SECRET");
    return null;
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/internal/reports/pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ html }),
    });
    if (!res.ok) {
      console.error("[Reports] worker refused the PDF", res.status);
      return null;
    }
    return await res.arrayBuffer();
  } catch (cause) {
    console.error("[Reports] worker unreachable for PDF", cause);
    return null;
  }
}

/** The PDF response for a report, or 502 when printing failed. */
export async function reportPdfResponse(
  report: PrintableReport,
  disposition: "attachment" | "inline",
): Promise<Response> {
  const pdf = await printPdfOnWorker(reportPrintHtml(report));
  if (!pdf) {
    return Response.json({ error: "pdf_unavailable" }, { status: 502, headers: NO_STORE });
  }
  const fileName = reportPdfFileName(
    report.snapshot.period,
    report.snapshot.start,
    reportTimeZone(report.company.timezone),
  );
  return new Response(pdf, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
