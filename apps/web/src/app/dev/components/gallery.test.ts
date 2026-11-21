import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as canvas from "@/components/v2/canvas";
import * as client from "@/components/v2/client";
import * as data from "@/components/v2/data";
import * as marketing from "@/components/v2/marketing";
import * as primitives from "@/components/v2/primitives";
import * as session from "@/components/v2/session";
import * as shell from "@/components/v2/shell";
import * as work from "@/components/v2/work";

import { ComponentGallery, GALLERY_SECTIONS } from "./gallery";

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", async (orig) => ({ ...(await orig<object>()), notFound }));

const v2Dir = path.resolve(__dirname, "../../../components/v2");
const gallerySource = readFileSync(path.resolve(__dirname, "gallery.tsx"), "utf8");

const modules = { canvas, client, data, marketing, primitives, session, shell, work };

/** Exports that render only as part of another specimen. */
const COVERED_BY_PARENT: Record<string, string> = {
  UserMenuItem: "rendered inside UserMenu",
  SegmentedTabs: "Segmented with tab panels; same control as Segmented",
  AuthStage: "full-viewport stage around AuthCard; shown on /sign-in",
};

describe("dev component gallery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    notFound.mockClear();
  });

  it("has one section per components/v2 folder", () => {
    const folders = readdirSync(v2Dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect([...GALLERY_SECTIONS].sort()).toEqual(folders);
    expect(Object.keys(modules).sort()).toEqual(folders);
  });

  it("imports every exported v2 component", () => {
    const missing: string[] = [];
    for (const mod of Object.values(modules)) {
      for (const [name, value] of Object.entries(mod)) {
        if (!/^[A-Z][a-z]/.test(name) || typeof value !== "function") continue;
        if (name in COVERED_BY_PARENT) continue;
        if (!new RegExp(`<${name}[\\s>/]`).test(gallerySource)) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it("renders every section without throwing", () => {
    const html = renderToStaticMarkup(h(ComponentGallery));
    for (const id of GALLERY_SECTIONS) {
      expect(html).toContain(`data-gallery-section="${id}"`);
    }
    expect(html).toContain('data-slot="canvas-agent-alert"');
  });

  it("returns 404 in production", async () => {
    const { default: Page } = await import("./page");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => Page()).not.toThrow();
  });
});
