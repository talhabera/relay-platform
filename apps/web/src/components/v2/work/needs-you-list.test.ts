import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NeedsYouList, NeedsYouPanel, NeedsYouRow, type NeedsYouRowData } from "./index";

const count = (html: string, needle: string) => html.split(needle).length - 1;

const rows: NeedsYouRowData[] = [
  { id: "a", kind: "failed-run", title: "Google Places quota reached, 06:00", agent: "Lead Gatherer", age: "6h ago", href: "/operator?a" },
  { id: "b", kind: "question", title: "Include offices under 20 employees?", agent: "Lead Qualifier", age: "38m ago", href: "/operator?b" },
];

describe("Needs you list, Operator surface (06 entry-points 414:60556)", () => {
  it("header count matches the visible rows, filter opens the full list", () => {
    const html = render(h(NeedsYouList, { items: rows }));
    expect(html).toContain('data-slot="needs-you-list"');
    expect(html).toMatch(/data-slot="count-badge"[^>]*>2</);
    expect(html).toContain('aria-label="2 open"');
    expect(html).toContain("Ordered by impact on qualified leads");
    expect(html).toMatch(/href="\/needs-you"[^>]*aria-label="Filter Needs you"|aria-label="Filter Needs you"[^>]*href="\/needs-you"/);
    expect(count(html, 'data-slot="needs-you-row"')).toBe(2);
    expect(html.indexOf("Google Places")).toBeLessThan(html.indexOf("Include offices"));
  });

  it("empty: no count badge, caught-up state", () => {
    const html = render(h(NeedsYouList, { items: [] }));
    expect(html).toContain('data-state="empty"');
    expect(html).not.toContain('data-slot="count-badge"');
    expect(html).toContain("all caught up");
  });
});

describe("Needs you row selection and panel link (S46)", () => {
  it("selected row is marked and its title links to select it", () => {
    const html = render(h(NeedsYouRow, { ...rows[0], selected: true, titleHref: "/needs-you?item=a" }));
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("bg-primary-soft");
    expect(html).toContain('href="/needs-you?item=a"');
  });

  it("panel View all defaults to the Needs you page", () => {
    const html = render(h(NeedsYouPanel, { items: rows }));
    expect(html).toContain('href="/needs-you"');
  });
});
