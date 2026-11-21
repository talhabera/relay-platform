import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * S02b guard: UI code must use semantic tokens from globals.css (bg-success,
 * bg-status-live, bg-overlay, bg-brand-whatsapp, ...) instead of Tailwind's
 * built-in palette (bg-green-100, text-white, bg-black/50, ...), so both themes
 * stay on the Figma token set.
 */

const SRC = path.resolve(__dirname, "..");

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const UTILITY =
  "bg|text|border|border-[trblxyse]|ring|ring-offset|from|via|to|fill|stroke|outline|divide|shadow|decoration|placeholder|accent|caret";
const RAW_PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${UTILITY})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`,
  "g",
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("raw Tailwind palette classes", () => {
  it("regex catches the classes it is meant to catch", () => {
    const sample =
      "bg-green-100 text-white bg-black/50 dark:text-gray-300 fill-black bg-success text-foreground bg-status-live";
    expect(sample.match(RAW_PALETTE_CLASS)).toEqual([
      "bg-green-100",
      "text-white",
      "bg-black/50",
      "text-gray-300",
      "fill-black",
    ]);
  });

  it("no file under apps/web/src uses them", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const matches = readFileSync(file, "utf8").match(RAW_PALETTE_CLASS);
      return matches
        ? [`${path.relative(SRC, file)}: ${[...new Set(matches)].join(" ")}`]
        : [];
    });
    expect(offenders).toEqual([]);
  });
});
