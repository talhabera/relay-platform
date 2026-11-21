import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Report PDF (S89, report snapshot spec + research #30): web renders the
// report as a self-contained print-CSS HTML document and posts it here;
// headless Chromium prints it. No npm browser driver: the Chromium binary is
// run once per PDF with `--print-to-pdf`, offline (file:// input, no network
// assets in the document) and with scripts off. `CHROMIUM_PATH` names the
// binary (default `chromium`); the worker image must ship it.

/** Report HTML is a few KB; anything near this cap is not ours. */
export const REPORT_PDF_MAX_HTML_BYTES = 1_000_000;

const CHROMIUM_TIMEOUT_MS = 30_000;

export type ChromiumRunner = (binary: string, args: string[], timeoutMs: number) => Promise<void>;

export function chromiumPdfArgs(inputPath: string, outputPath: string): string[] {
  return [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--blink-settings=scriptEnabled=false",
    "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw",
    `--print-to-pdf=${outputPath}`,
    pathToFileURL(inputPath).toString(),
  ];
}

const execChromium: ChromiumRunner = (binary, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

// One Chromium at a time: the host is small and a print takes about a second.
let chain: Promise<unknown> = Promise.resolve();

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

export async function renderPdfWithChromium(
  html: string,
  options: { binary?: string; run?: ChromiumRunner } = {},
): Promise<Buffer> {
  const binary = options.binary ?? (process.env.CHROMIUM_PATH || "chromium");
  const run = options.run ?? execChromium;
  return serialized(async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-report-pdf-"));
    try {
      const input = join(dir, "report.html");
      const output = join(dir, "report.pdf");
      await writeFile(input, html, "utf8");
      await run(binary, chromiumPdfArgs(input, output), CHROMIUM_TIMEOUT_MS);
      const pdf = await readFile(output);
      if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
        throw new Error("Chromium did not produce a PDF");
      }
      return pdf;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

export function parseReportPdfBody(body: unknown): { html: string } | null {
  const html = (body as { html?: unknown } | null)?.html;
  if (typeof html !== "string" || html.length === 0) return null;
  if (Buffer.byteLength(html, "utf8") > REPORT_PDF_MAX_HTML_BYTES) return null;
  return { html };
}

export type ReportPdfResponse =
  | { status: 200; contentType: "application/pdf"; body: Buffer }
  | { status: 400 | 502; contentType: "text/plain"; body: string };

/** `POST /internal/reports/pdf` body `{ html }` to PDF bytes. Never throws. */
export async function handleReportPdfRequest(
  body: unknown,
  render: (html: string) => Promise<Buffer> = (html) => renderPdfWithChromium(html),
): Promise<ReportPdfResponse> {
  const parsed = parseReportPdfBody(body);
  if (!parsed) return { status: 400, contentType: "text/plain", body: "Invalid report PDF request" };
  try {
    const pdf = await render(parsed.html);
    return { status: 200, contentType: "application/pdf", body: pdf };
  } catch (cause) {
    console.error("[Reports] PDF render failed", cause);
    return { status: 502, contentType: "text/plain", body: "PDF render failed" };
  }
}
