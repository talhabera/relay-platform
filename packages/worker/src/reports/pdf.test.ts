import { describe, expect, it, vi } from "vitest";
import {
  REPORT_PDF_MAX_HTML_BYTES,
  chromiumPdfArgs,
  handleReportPdfRequest,
  parseReportPdfBody,
  renderPdfWithChromium,
  type ChromiumRunner,
} from "./pdf";

const PDF = Buffer.from("%PDF-1.7\n%fake\n");

describe("chromiumPdfArgs", () => {
  it("prints headless, offline, without scripts or header/footer", () => {
    const args = chromiumPdfArgs("/tmp/x/report.html", "/tmp/x/report.pdf");
    expect(args).toContain("--headless=new");
    expect(args).toContain("--no-pdf-header-footer");
    expect(args).toContain("--blink-settings=scriptEnabled=false");
    expect(args).toContain("--print-to-pdf=/tmp/x/report.pdf");
    expect(args.at(-1)).toBe("file:///tmp/x/report.html");
  });
});

describe("parseReportPdfBody", () => {
  it("accepts a non-empty HTML document", () => {
    expect(parseReportPdfBody({ html: "<html></html>" })).toEqual({ html: "<html></html>" });
  });

  it.each([null, {}, { html: "" }, { html: 3 }, { html: "x".repeat(REPORT_PDF_MAX_HTML_BYTES + 1) }])(
    "rejects %#",
    (body) => {
      expect(parseReportPdfBody(body)).toBeNull();
    },
  );
});

describe("renderPdfWithChromium", () => {
  it("writes the HTML, runs Chromium and returns the printed file", async () => {
    let seenHtml = "";
    const run: ChromiumRunner = vi.fn(async (_bin: string, args: string[]) => {
      const { readFile, writeFile } = await import("node:fs/promises");
      const input = new URL(args.at(-1)!).pathname;
      seenHtml = await readFile(input, "utf8");
      const out = args.find((a) => a.startsWith("--print-to-pdf="))!.slice("--print-to-pdf=".length);
      await writeFile(out, PDF);
    });
    const pdf = await renderPdfWithChromium("<p>hi</p>", { binary: "chromium-test", run });
    expect(pdf.equals(PDF)).toBe(true);
    expect(seenHtml).toBe("<p>hi</p>");
    expect(run).toHaveBeenCalledWith("chromium-test", expect.any(Array), expect.any(Number));
  });

  it("fails when Chromium produced no PDF", async () => {
    const run: ChromiumRunner = vi.fn(async () => {});
    await expect(renderPdfWithChromium("<p>hi</p>", { binary: "c", run })).rejects.toThrow();
  });
});

describe("handleReportPdfRequest", () => {
  it("answers 200 with the PDF bytes", async () => {
    const render = vi.fn(async () => PDF);
    const res = await handleReportPdfRequest({ html: "<p>r</p>" }, render);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("application/pdf");
    expect(res.body).toBe(PDF);
    expect(render).toHaveBeenCalledWith("<p>r</p>");
  });

  it("answers 400 on a bad body without starting Chromium", async () => {
    const render = vi.fn(async () => PDF);
    const res = await handleReportPdfRequest({ html: 1 }, render);
    expect(res.status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it("answers 502 when Chromium fails", async () => {
    const render = vi.fn(async () => {
      throw new Error("spawn chromium ENOENT");
    });
    const res = await handleReportPdfRequest({ html: "<p>r</p>" }, render);
    expect(res.status).toBe(502);
  });
});
