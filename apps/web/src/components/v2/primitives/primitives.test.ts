import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AgentChip,
  Chip,
  CountBadge,
  Icon,
  IconButton,
  iconMap,
  iconNames,
  isIconName,
  ProgressBar,
  ScoreRing,
  scoreTone,
  Segmented,
  SegmentedTabs,
  StatusChip,
} from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m?.[1] ?? m?.[2] ?? "";
};

describe("Icon -> lucide map", () => {
  it("covers all 109 Figma Icon/* glyphs", () => {
    expect(iconNames).toHaveLength(109);
    for (const name of ["house", "hand-helping", "chart-no-axes-column", "triangle-alert", "x"]) {
      expect(isIconName(name)).toBe(true);
      expect(iconMap[name as keyof typeof iconMap]).toBeTruthy();
    }
    expect(isIconName("not-an-icon")).toBe(false);
  });

  it("renders a decorative svg at stroke 1.75", () => {
    const html = render(h(Icon, { name: "bell", size: 20 }));
    expect(html).toContain("<svg");
    expect(html).toContain('stroke-width="1.75"');
    expect(html).toContain('width="20"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-icon="bell"');
  });
});

describe("Chip", () => {
  it("renders sizes sm/md/lg with heights 24/32/44", () => {
    expect(classOf(render(h(Chip, { size: "sm" }, "A")), "chip")).toContain("h-6");
    expect(classOf(render(h(Chip, { size: "md" }, "A")), "chip")).toContain("h-8");
    expect(classOf(render(h(Chip, { size: "lg" }, "A")), "chip")).toContain("h-11");
  });

  it("styles variants and exposes selected state", () => {
    const sel = render(h(Chip, { variant: "selected" }, "Hot"));
    expect(classOf(sel, "chip")).toContain("bg-primary-soft");
    expect(sel).toContain('aria-pressed="true"');
    const steer = render(h(Chip, { variant: "steering", icon: "sparkles" }, "Ask"));
    expect(classOf(steer, "chip")).toContain("border-dashed");
    expect(steer).toContain('data-icon="sparkles"');
    expect(steer).toContain("text-primary");
    expect(render(h(Chip, null, "Plain"))).not.toContain("<svg");
  });

  it("renders a button by default and a span when static", () => {
    expect(render(h(Chip, null, "x"))).toMatch(/^<button[^>]*type="button"/);
    expect(render(h(Chip, { asStatic: true }, "x"))).toMatch(/^<span/);
  });
});

describe("StatusChip", () => {
  it.each([
    ["live", "bg-status-live", "Live"],
    ["draft", "bg-status-draft", "Draft"],
    ["pending", "bg-status-pending", "Pending"],
    ["needs-you", "bg-status-needs-you", "Needs you"],
    ["success", "bg-status-approved", "Success"],
    ["error", "bg-status-rejected", "Error"],
    ["neutral", "bg-secondary", "Neutral"],
  ] as const)("tone %s", (tone, bg, label) => {
    const html = render(h(StatusChip, { tone }));
    expect(classOf(html, "status-chip")).toContain(bg);
    expect(html).toContain(label);
    expect(html).toContain('data-slot="status-chip-dot"');
  });

  it("overrides the label and hides the dot", () => {
    const html = render(h(StatusChip, { tone: "neutral", dot: false }, "Handed off"));
    expect(html).toContain("Handed off");
    expect(html).not.toContain("status-chip-dot");
  });

  it("outlines needs-you", () => {
    expect(classOf(render(h(StatusChip, { tone: "needs-you" })), "status-chip")).toContain("border-warning");
  });
});

describe("CountBadge", () => {
  it.each([
    ["neutral", "bg-secondary"],
    ["primary", "bg-primary"],
    ["warning", "bg-warning"],
    ["destructive", "bg-destructive"],
  ] as const)("tone %s", (tone, bg) => {
    const html = render(h(CountBadge, { tone, count: 5 }));
    expect(classOf(html, "count-badge")).toContain(bg);
    expect(html).toContain(">5<");
  });

  it("caps large counts", () => {
    expect(render(h(CountBadge, { count: 120 }))).toContain(">99+<");
    expect(render(h(CountBadge, { count: 120, max: 999 }))).toContain(">120<");
  });
});

describe("IconButton", () => {
  it("renders sizes 32/40/44 and requires a label", () => {
    const sm = render(h(IconButton, { icon: "bell", label: "Notifications", size: "sm" }));
    expect(classOf(sm, "icon-button")).toContain("size-8");
    expect(sm).toContain('aria-label="Notifications"');
    expect(sm).toContain('width="16"');
    const lg = render(h(IconButton, { icon: "bell", label: "Notifications", size: "lg" }));
    expect(classOf(lg, "icon-button")).toContain("size-11");
    expect(lg).toContain('width="20"');
    expect(classOf(render(h(IconButton, { icon: "x", label: "Close", size: "md" })), "icon-button")).toContain("size-10");
  });

  it("styles variants and shows the dot", () => {
    expect(classOf(render(h(IconButton, { icon: "send", label: "Send", variant: "filled" })), "icon-button")).toContain(
      "bg-primary",
    );
    expect(classOf(render(h(IconButton, { icon: "x", label: "Close", variant: "outline" })), "icon-button")).toContain(
      "border-border",
    );
    const dot = render(h(IconButton, { icon: "bell", label: "Notifications", dot: true }));
    expect(dot).toContain('data-slot="icon-button-dot"');
    expect(render(h(IconButton, { icon: "bell", label: "Notifications" }))).not.toContain("icon-button-dot");
  });
});

describe("Segmented", () => {
  const items = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
  ];

  it("marks the active segment", () => {
    const html = render(h(Segmented, { items, value: "week", "aria-label": "Range" }));
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>Week</);
    expect(classOf(html, "segmented")).toContain("rounded-full");
  });

  it("supports nothing selected (active=none)", () => {
    const html = render(h(Segmented, { items, "aria-label": "Range" }));
    expect(html).not.toContain('aria-checked="true"');
  });

  it("tightens padding at 5 items", () => {
    const five = ["Versions", "Tools", "Schedules", "Editors", "Knowledge"].map((l) => ({ value: l, label: l }));
    expect(classOf(render(h(Segmented, { items: five, value: "Tools" })), "segmented-item")).toContain("px-2");
    expect(classOf(render(h(Segmented, { items, value: "day" })), "segmented-item")).toContain("px-3");
  });
});

describe("SegmentedTabs", () => {
  const items = [
    { value: "run", label: "Run", content: h("p", null, "run panel") },
    { value: "knowledge", label: "Knowledge", content: h("p", null, "knowledge panel") },
  ];

  it("renders the Segmented control and only the active panel", () => {
    const html = render(h(SegmentedTabs, { items, defaultValue: "knowledge", "aria-label": "Sections" }));
    expect(html).toContain('data-slot="segmented"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Knowledge</);
    expect(html).toContain("knowledge panel");
    expect(html).not.toContain("run panel");
  });

  it("defaults to the first item", () => {
    const html = render(h(SegmentedTabs, { items, "aria-label": "Sections" }));
    expect(html).toContain("run panel");
    expect(html).not.toContain("knowledge panel");
  });
});

describe("Badge/Tabs migration (S13b)", () => {
  const srcRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(srcRoot);

  it("leaves no ui/badge or shared/status-badge imports", () => {
    const offenders = files.filter((f) => /components\/(ui\/badge|shared\/status-badge)["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("leaves no ui/tabs imports", () => {
    const offenders = files.filter((f) => /components\/ui\/tabs["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("ProgressBar", () => {
  it("fills to the clamped value", () => {
    const html = render(h(ProgressBar, { value: 60, "aria-label": "Steps" }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toContain("width:60%");
    expect(render(h(ProgressBar, { value: 140 }))).toContain("width:100%");
    expect(render(h(ProgressBar, { value: -3 }))).toContain("width:0%");
  });

  it("supports value/max and the warning tone", () => {
    const html = render(h(ProgressBar, { value: 6, max: 10, tone: "warning" }));
    expect(html).toContain("width:60%");
    expect(classOf(html, "progress-fill")).toContain("bg-warning");
  });
});

describe("ScoreRing", () => {
  it("derives the tone from the score", () => {
    expect(scoreTone(82)).toBe("high");
    expect(scoreTone(75)).toBe("high");
    expect(scoreTone(64)).toBe("mid");
    expect(scoreTone(50)).toBe("mid");
    expect(scoreTone(38)).toBe("low");
  });

  it("draws the arc and centre value", () => {
    const html = render(h(ScoreRing, { value: 82 }));
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="82"');
    expect(html).toContain(">82<");
    expect(classOf(html, "score-ring-arc")).toContain("stroke-success");
    expect(classOf(render(h(ScoreRing, { value: 64 })), "score-ring-arc")).toContain("stroke-warning");
    expect(classOf(render(h(ScoreRing, { value: 38 })), "score-ring-arc")).toContain("stroke-destructive");
  });
});

describe("AgentChip", () => {
  it("shows the kind tile and live version", () => {
    const html = render(h(AgentChip, { kind: "operator", name: "Lead Qualifier", version: "v1", status: "live" }));
    expect(html).toContain("Lead Qualifier");
    expect(html).toContain('data-icon="bot"');
    expect(classOf(html, "agent-chip-tile")).toContain("bg-primary-soft");
    expect(classOf(html, "agent-chip-version")).toContain("bg-status-live");
    expect(html).toMatch(/v1.*Live/);
  });

  it("customer kind and draft/none versions", () => {
    const draft = render(h(AgentChip, { kind: "customer", name: "Support", version: "v2", status: "draft" }));
    expect(draft).toContain('data-icon="message-circle"');
    expect(classOf(draft, "agent-chip-tile")).toContain("bg-secondary");
    expect(classOf(draft, "agent-chip-version")).toContain("bg-status-draft");
    const none = render(h(AgentChip, { kind: "customer", name: "Support" }));
    expect(none).not.toContain("agent-chip-version");
    expect(classOf(none, "agent-chip")).toContain("pr-3");
  });
});
