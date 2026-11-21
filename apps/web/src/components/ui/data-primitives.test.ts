import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Inbox, Users } from "lucide-react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { Avatar, AvatarFallback } from "./avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { Separator } from "./separator";
import { Skeleton } from "./skeleton";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "./table";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m ? (m[1] ?? m[2]).replaceAll("&amp;", "&") : "";
};
const expectAll = (cls: string, tokens: string[]) => {
  for (const t of tokens) expect(cls.split(/\s+/)).toContain(t);
};
const expectNone = (cls: string, tokens: string[]) => {
  for (const t of tokens) expect(cls.split(/\s+/)).not.toContain(t);
};

// Figma 02 `338:559`: Avatar 4:267, Card 4:273, Separator 4:276, Skeleton 4:285,
// Table row 4:305, Metric card 17:403, Empty state 10:94.

describe("Avatar", () => {
  const avatar = (size?: "sm" | "md" | "lg") =>
    render(h(Avatar, { size }, h(AvatarFallback, null, "TB")));

  it("defaults to md (32) with primary-soft initials", () => {
    const html = avatar();
    expect(html).toContain('data-size="md"');
    expectAll(classOf(html, "avatar"), ["size-8", "rounded-full"]);
    expectAll(classOf(html, "avatar-fallback"), [
      "bg-primary-soft",
      "text-primary-soft-foreground",
      "type-caption",
    ]);
    expect(html).toContain("TB");
  });

  it("sm is 24", () => {
    const html = avatar("sm");
    expect(html).toContain('data-size="sm"');
    expectAll(classOf(html, "avatar"), ["data-[size=sm]:size-6"]);
  });
});

describe("Card", () => {
  it("uses radius/xl, elevation/1 and space/6 padding", () => {
    const html = render(
      h(
        Card,
        null,
        h(CardHeader, null, h(CardTitle, null, "Operator sessions"), h(CardDescription, null, "12 active")),
        h(CardContent, null, "body"),
      ),
    );
    expectAll(classOf(html, "card"), ["bg-card", "border", "rounded-xl", "shadow-elevation-1", "py-6", "gap-4"]);
    expectNone(classOf(html, "card"), ["shadow-none"]);
    expectAll(classOf(html, "card-header"), ["px-6"]);
    expectAll(classOf(html, "card-content"), ["px-6"]);
    expectAll(classOf(html, "card-title"), ["type-h3", "text-card-foreground"]);
    expectAll(classOf(html, "card-description"), ["type-body", "text-muted-foreground"]);
  });
});

describe("Separator", () => {
  it("is a 1px border-colored rule", () => {
    const html = render(h(Separator));
    expectAll(classOf(html, "separator"), ["bg-border", "data-[orientation=horizontal]:h-px"]);
  });
});

describe("Skeleton", () => {
  it("text: 16 high, radius/sm, muted fill", () => {
    const html = render(h(Skeleton));
    expect(html).toContain('data-variant="text"');
    expectAll(classOf(html, "skeleton"), ["bg-muted", "h-4", "rounded-sm", "animate-pulse"]);
  });

  it("block: 40 high, radius/xl", () => {
    expectAll(classOf(render(h(Skeleton, { variant: "block" })), "skeleton"), ["h-10", "rounded-xl"]);
  });

  it("avatar: 24 circle", () => {
    expectAll(classOf(render(h(Skeleton, { variant: "avatar" })), "skeleton"), ["size-6", "rounded-full"]);
  });

  it("className sizing wins over the variant", () => {
    const cls = classOf(render(h(Skeleton, { className: "h-8 w-32" })), "skeleton");
    expectAll(cls, ["h-8", "w-32"]);
    expectNone(cls, ["h-4"]);
  });
});

describe("Table row", () => {
  const table = render(
    h(
      Table,
      null,
      h(TableHeader, null, h(TableRow, null, h(TableHead, null, "Session"), h(TableHead, null, "Agent"))),
      h(
        TableBody,
        null,
        h(TableRow, null, h(TableCell, null, "Weekly digest"), h(TableCell, null, "Ops agent")),
        h(TableEmpty, { colSpan: 2 }, "No sessions yet"),
      ),
    ),
  );

  it("rows are 48 high, transparent, bottom border only", () => {
    const cls = classOf(table, "table-row");
    expectAll(cls, ["h-12", "border-b"]);
    expectNone(cls, ["bg-muted"]);
  });

  it("header labels use type/label in muted-foreground", () => {
    expectAll(classOf(table, "table-head"), ["type-label", "text-muted-foreground", "px-2", "first:pl-4", "last:pr-4"]);
  });

  it("body cells use type/body", () => {
    expectAll(classOf(table, "table-cell"), ["type-body", "text-foreground", "py-2", "first:pl-4", "last:pr-4"]);
  });

  it("empty variant centers type/small muted text across all columns", () => {
    expect(table).toContain('colSpan="2"');
    expectAll(classOf(table, "table-empty-cell"), ["text-center", "type-small", "text-muted-foreground"]);
    expect(table).toContain("No sessions yet");
  });
});

describe("Metric card", () => {
  const card = (props: Parameters<typeof MetricCard>[0]) => render(h(MetricCard, props));

  it("value: label, metric value, description", () => {
    const html = card({ label: "Conversations this week", value: "1,284", description: "Rolling 7 days" });
    expect(html).toContain('data-state="value"');
    expectAll(classOf(html, "metric-card"), [
      "rounded-xl",
      "shadow-elevation-1",
      "p-5",
      "h-30",
      "justify-between",
    ]);
    expectAll(classOf(html, "metric-card-label"), ["type-label", "text-muted-foreground"]);
    expectAll(classOf(html, "metric-card-value"), ["type-metric", "text-card-foreground"]);
    expectAll(classOf(html, "metric-card-description"), ["type-caption", "text-muted-foreground"]);
    expect(html).toContain("1,284");
  });

  it("up and down color the delta with status tokens", () => {
    const up = card({ label: "L", value: "1", description: "+12.4% vs last week", trend: "up" });
    expect(up).toContain('data-state="up"');
    expectAll(classOf(up, "metric-card-description"), ["text-status-approved-foreground"]);
    const down = card({ label: "L", value: "1", description: "-6.1% vs last week", trend: "down" });
    expect(down).toContain('data-state="down"');
    expectAll(classOf(down, "metric-card-description"), ["text-status-rejected-foreground"]);
  });

  it("loading shows a block skeleton and Loading…", () => {
    const html = card({ label: "L", value: "1", loading: true });
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('data-variant="block"');
    expect(html).toContain("Loading…");
    expect(html).not.toContain("metric-card-value");
  });

  it("empty shows an em dash and the no-data line", () => {
    const html = card({ label: "L", value: null });
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("—");
    expect(html).toContain("No data for this range yet");
  });
});

describe("Empty state", () => {
  it("with-action: transparent, 48 icon tile, h3 title, body text, primary button", () => {
    const html = render(
      h(EmptyState, {
        icon: Users,
        title: "No sessions yet",
        description: "Start a session with an operator agent to see it listed here.",
        action: { label: "New session", href: "/operator" },
      }),
    );
    expect(html).toContain('data-variant="with-action"');
    const root = classOf(html, "empty-state");
    expectAll(root, ["flex-col", "items-center", "gap-3", "p-6"]);
    expectNone(root, ["border", "border-dashed"]);
    expectAll(classOf(html, "empty-state-icon"), ["size-12", "rounded-xl", "bg-secondary"]);
    expectAll(classOf(html, "empty-state-title"), ["type-h3", "text-foreground"]);
    expectAll(classOf(html, "empty-state-description"), ["type-body", "text-muted-foreground"]);
    expect(html).toContain('href="/operator"');
    expect(html).toContain('data-slot="button"');
  });

  it("without-action renders no button and defaults the icon to Inbox", () => {
    const html = render(h(EmptyState, { title: "Nothing", description: "Yet" }));
    expect(html).toContain('data-variant="without-action"');
    expect(html).not.toContain('data-slot="button"');
    const inbox = render(h(Inbox, { className: "size-6" }));
    expect(html).toContain(inbox.match(/lucide-inbox/)?.[0] ?? "lucide-inbox");
  });
});
