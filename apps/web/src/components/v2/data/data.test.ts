import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PAGE_PERMISSION_KEYS } from "@/db/schema";

import {
  ACCESS_MATRIX_COLUMNS,
  AccessMatrixRow,
  ChartCard,
  ChatDock,
  chartColor,
  CompanyRow,
  ConnectorRow,
  InboxRow,
  MemberRow,
  TranscriptMessage,
} from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m ? (m[1] ?? m[2]).replaceAll("&amp;", "&") : "";
};
const count = (html: string, needle: string) => html.split(needle).length - 1;

// Figma 02 `378:27996` v2/data.
const inbox = {
  customer: "Katrin Vogel",
  time: "11:42",
  agent: "Acme Website Assistant",
  snippet: "Could you send a quote for our 1,200 m² office in Munich?",
};

describe("Inbox row (378:28147)", () => {
  it("default: initials, source glyph, time, live Open chip", () => {
    const html = render(h(InboxRow, inbox));
    expect(html).toContain('data-state="default"');
    expect(html).toContain(">KV<");
    expect(html).toContain('data-brand="website"');
    expect(html).toContain("11:42");
    expect(html).toMatch(/data-tone="live"[^>]*>.*Open/);
    expect(classOf(html, "inbox-row")).toContain("bg-card");
    expect(html).not.toContain('data-slot="inbox-row-unread"');
    expect(html).not.toContain('data-icon="hand-helping"');
  });

  it("selected: primary-soft fill and primary border", () => {
    const html = render(h(InboxRow, { ...inbox, state: "selected" }));
    expect(classOf(html, "inbox-row")).toContain("bg-primary-soft");
    expect(classOf(html, "inbox-row")).toContain("border-primary");
    expect(html).toContain('aria-selected="true"');
  });

  it("unread: dot before the time and a foreground snippet", () => {
    const html = render(h(InboxRow, { ...inbox, state: "unread", source: "whatsapp" }));
    expect(html).toContain('data-slot="inbox-row-unread"');
    expect(classOf(html, "inbox-row-snippet")).toContain("text-foreground");
    expect(html).toContain('data-brand="whatsapp"');
  });

  it("escalated: hand-helping icon and handoff chip per state", () => {
    const html = render(h(InboxRow, { ...inbox, state: "escalated", agent: "Handed to Markus" }));
    expect(html).toContain('data-icon="hand-helping"');
    expect(html).toMatch(/data-tone="neutral"[^>]*>.*Handed off/);
    expect(render(h(InboxRow, { ...inbox, state: "escalated", handoffState: "answered" }))).toMatch(
      /data-tone="success"[^>]*>.*Answered/,
    );
    expect(render(h(InboxRow, { ...inbox, state: "escalated", handoffState: "expired" }))).toContain('data-tone="needs-you"');
    expect(render(h(InboxRow, { ...inbox, state: "escalated", handoffState: "taken-over" }))).toMatch(/Taken over/);
  });

  it("handoff boolean shows the icon on a non-escalated row", () => {
    expect(render(h(InboxRow, { ...inbox, state: "selected", handoff: true }))).toContain('data-icon="hand-helping"');
  });
});

describe("Member row (385:5063)", () => {
  const member = { name: "Deniz Aksoy", email: "deniz@acme-gmbh.de", role: "Operator" };
  it("active: success chip, last active, ellipsis actions", () => {
    const html = render(h(MemberRow, { ...member, lastActive: "Active today, 14:32" }));
    expect(html).toContain(">DA<");
    expect(html).toMatch(/data-tone="success"[^>]*>.*Active/);
    expect(html).toContain("Active today, 14:32");
    expect(html).toContain('data-icon="ellipsis"');
    expect(html).toContain('aria-label="Actions for Deniz Aksoy"');
    // Role chip has no dot.
    expect(html).toMatch(/data-slot="member-row-role"[^>]*>Operator</);
  });

  it("invited: pending chip; actions slot replaces the button", () => {
    const html = render(h(MemberRow, { ...member, status: "invited", lastActive: "Invited 23 Sep, 09:10", actions: h("span", null, "MENU") }));
    expect(html).toMatch(/data-tone="pending"[^>]*>.*Invited/);
    expect(html).toContain("MENU");
    expect(html).not.toContain('data-icon="ellipsis"');
  });
});

describe("Company row (399:5059)", () => {
  const company = { name: "Acme GmbH", description: "Office cleaning · Munich, Augsburg", role: "Owner", meta: "2 customer · 5 operator agents" };
  it("current: primary-soft tile and Current chip, no Switch", () => {
    const html = render(h(CompanyRow, { ...company, state: "current" }));
    expect(classOf(html, "company-row-tile")).toContain("bg-primary-soft");
    expect(html).toContain('data-icon="building-2"');
    expect(html).toMatch(/data-tone="live"[^>]*>.*Current/);
    expect(html).not.toContain(">Switch<");
    expect(html).toContain("2 customer · 5 operator agents");
  });

  it("default: muted tile and outline Switch button", () => {
    const html = render(h(CompanyRow, { ...company, name: "Brightline Dental", onSwitch: () => {} }));
    expect(classOf(html, "company-row-tile")).toContain("bg-muted");
    expect(html).toMatch(/data-variant="outline"[^>]*>Switch</);
    expect(html).not.toContain(">Current<");
  });
});

describe("Connector row (387:5094)", () => {
  const hunter = { brand: "hunter" as const, name: "Hunter", description: "Finds and verifies work emails" };
  it.each([
    ["connected", "success", "Connected", "Configure", "outline"],
    ["disconnected", "neutral", "Disconnected", "Connect", "default"],
    ["pending", "pending", "Pending", "Retry", "outline"],
    ["error", "error", "Error", "Reconnect", "default"],
  ] as const)("%s: %s chip, %s action", (status, tone, label, action, variant) => {
    const html = render(h(ConnectorRow, { ...hunter, status }));
    expect(html).toMatch(new RegExp(`data-tone="${tone}"[^>]*>.*${label}`));
    expect(html).toMatch(new RegExp(`data-variant="${variant}"[^>]*>${action}<`));
    expect(html).toContain('data-brand="hunter"');
  });

  it("default meta per status; error meta is destructive", () => {
    expect(render(h(ConnectorRow, { ...hunter, status: "disconnected" }))).toContain("Not connected");
    expect(render(h(ConnectorRow, { ...hunter, status: "pending" }))).toContain("Waiting for authorization");
    const err = render(h(ConnectorRow, { ...hunter, status: "error", meta: "Token expired 25 Sep, 08:12" }));
    expect(classOf(err, "connector-row-meta")).toContain("text-destructive");
  });

  it("menu boolean adds the ellipsis button", () => {
    expect(render(h(ConnectorRow, { ...hunter, status: "connected" }))).not.toContain('data-icon="ellipsis"');
    expect(render(h(ConnectorRow, { ...hunter, status: "connected", menu: true }))).toContain('data-icon="ellipsis"');
  });
});

describe("Access matrix row (384:28414)", () => {
  it("columns are Home plus the page permission keys, no chat or approve key", () => {
    const keys = ACCESS_MATRIX_COLUMNS.map((c) => c.key);
    expect(keys[0]).toBe("home");
    expect(new Set(keys.slice(1))).toEqual(new Set(PAGE_PERMISSION_KEYS));
    expect(keys).not.toContain("chat");
    expect(keys).not.toContain("approve");
  });

  it("header: tab icons and labels on muted", () => {
    const html = render(h(AccessMatrixRow, { variant: "header" }));
    expect(classOf(html, "access-matrix-row")).toContain("bg-muted");
    for (const icon of ["house", "workflow", "inbox", "chart-no-axes-column", "bot"]) expect(html).toContain(`data-icon="${icon}"`);
    expect(html).toContain("Approve checkpoints");
    expect(count(html, 'role="columnheader"')).toBe(7);
  });

  it("owner: every tab checked and approve on, all disabled", () => {
    const html = render(h(AccessMatrixRow, { variant: "owner", name: "Talha Bera", email: "talha@acme-gmbh.de", role: "Owner" }));
    expect(count(html, 'data-slot="checkbox"')).toBe(5);
    expect(count(html, 'data-state="checked"')).toBeGreaterThanOrEqual(6);
    expect(html).not.toContain('data-state="unchecked"');
    expect(html).not.toContain('data-slot="access-matrix-lock"');
  });

  it("member: granted tabs checked, Agents locked, approve switch follows canApprove", () => {
    const html = render(
      h(AccessMatrixRow, {
        variant: "member",
        name: "Deniz Aksoy",
        email: "deniz@acme-gmbh.de",
        role: "Operator",
        access: { operator: true, messaging: true, agents: true },
      }),
    );
    expect(html).toContain('data-slot="access-matrix-lock"');
    expect(html).toMatch(/aria-label="Agents access for Deniz Aksoy"[^>]*data-state="unchecked"[^>]*disabled|aria-label="Agents access for Deniz Aksoy"[^>]*disabled[^>]*data-state="unchecked"|data-state="unchecked"[^>]*disabled[^>]*aria-label="Agents access/);
    expect(html).toMatch(/aria-label="Analytics access for Deniz Aksoy"[^>]*data-state="unchecked"|data-state="unchecked"[^>]*aria-label="Analytics access for Deniz Aksoy"/);
    expect(html).toMatch(/aria-label="Inbox access for Deniz Aksoy"[^>]*data-state="checked"|data-state="checked"[^>]*aria-label="Inbox access for Deniz Aksoy"/);
    expect(html).toMatch(/aria-label="Approve checkpoints for Deniz Aksoy"[^>]*data-state="unchecked"|data-state="unchecked"[^>]*aria-label="Approve checkpoints for Deniz Aksoy"/);
    const approver = render(
      h(AccessMatrixRow, { variant: "member", name: "Deniz Aksoy", email: "d@x.de", role: "Operator", canApprove: true }),
    );
    expect(approver).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
  });

  it("approveReadOnly: approve switch is truly disabled (not focusable), tabs stay editable", () => {
    const switchTag = (html: string) => html.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? "";
    const editable = render(
      h(AccessMatrixRow, { variant: "member", name: "Deniz Aksoy", email: "d@x.de", role: "Operator", canApprove: true }),
    );
    expect(switchTag(editable)).not.toMatch(/\sdisabled=""/);

    const mirror = render(
      h(AccessMatrixRow, {
        variant: "member",
        name: "Deniz Aksoy",
        email: "d@x.de",
        role: "Operator",
        canApprove: true,
        approveReadOnly: true,
      }),
    );
    expect(switchTag(mirror)).toMatch(/\sdisabled=""/);
    expect(switchTag(mirror)).toContain('aria-checked="true"');
    expect(mirror).toMatch(/aria-label="Operator access for Deniz Aksoy"(?![^>]*disabled)/);
  });
});

describe("Chart card (380:28558)", () => {
  const base = { title: "Qualified leads delivered", value: "6", delta: "+1", comparison: "vs last week" };
  const week = ["W33", "W34", "W35", "W36", "W37", "W38", "W39"].map((label, i) => ({ label, value: [3, 4, 4, 5, 7, 5, 6][i] }));

  it("header, metric value and an up delta in success", () => {
    const html = render(h(ChartCard, { ...base, data: { type: "line", points: week } }));
    expect(html).toContain('data-type="line"');
    expect(html).toContain("Qualified leads delivered");
    expect(html).toContain('data-icon="info"');
    expect(classOf(html, "chart-card-value")).toContain("type-metric");
    expect(html).toContain('data-icon="trending-up"');
    expect(classOf(html, "chart-card-delta")).toContain("text-success");
    expect(html).toContain("vs last week");
    expect(count(html, "<span>W3")).toBe(7);
  });

  it("a negative delta trends down in destructive", () => {
    const html = render(h(ChartCard, { ...base, delta: "-2", data: { type: "line", points: week } }));
    expect(html).toContain('data-icon="trending-down"');
    expect(classOf(html, "chart-card-delta")).toContain("text-destructive");
  });

  it("bar: day labels under the plot", () => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({ label, value: [5, 4, 6, 3, 4, null, null][i] }));
    const html = render(h(ChartCard, { ...base, data: { type: "bar", points: days } }));
    expect(html).toContain('data-type="bar"');
    expect(classOf(html, "chart-card-x-axis")).toContain("px-2");
    for (const d of ["Mon", "Fri", "Sun"]) expect(html).toContain(`<span>${d}</span>`);
  });

  it("funnel: stages scaled to the first, notes, fading opacity", () => {
    const html = render(
      h(ChartCard, {
        ...base,
        data: {
          type: "funnel",
          stages: [
            { label: "Gathered", value: 146 },
            { label: "Qualified", value: 44, note: "incl. 9 inbound" },
            { label: "Outreach", value: 31, note: "9 replied" },
            { label: "Delivered", value: 6, note: "target 10" },
          ],
        },
      }),
    );
    expect(count(html, 'data-slot="chart-card-stage"')).toBe(4);
    expect(html).toContain("width:180px;opacity:1");
    expect(html).toContain("width:54px;opacity:0.8");
    expect(html).toContain("width:38px;opacity:0.65");
    expect(html).toContain("width:8px;opacity:0.5");
    expect(html).toContain("incl. 9 inbound");
    expect(html).toContain("target 10");
  });

  it("donut: center total and a legend in chart colors", () => {
    const html = render(
      h(ChartCard, {
        ...base,
        data: {
          type: "donut",
          centerLabel: "qualified",
          segments: [
            { label: "Gathered by Lead Gatherer", value: 35 },
            { label: "Inbound from customer agents", value: 9 },
          ],
        },
      }),
    );
    expect(html).toContain(">44<");
    expect(html).toContain("qualified");
    expect(html).toContain("background:var(--chart-1)");
    expect(html).toContain("background:var(--chart-2)");
    expect(html).toContain("Inbound from customer agents");
  });

  it("chartColor cycles chart-1..5", () => {
    expect(chartColor(0)).toBe("var(--chart-1)");
    expect(chartColor(4)).toBe("var(--chart-5)");
    expect(chartColor(5)).toBe("var(--chart-1)");
  });
});

describe("Chat dock (402:28450)", () => {
  it("collapsed: pill with agent name, message count and expand", () => {
    const html = render(h(ChatDock, { agentName: "Acme Website Assistant", messageCount: 2 }));
    expect(html).toContain('data-state="collapsed"');
    expect(classOf(html, "chat-dock")).toContain("rounded-full");
    expect(html).toContain("Test Acme Website Assistant");
    expect(html).toContain("Test mode · 2 messages");
    expect(html).toContain('data-icon="message-square"');
    expect(html).toContain('aria-label="Expand test chat"');
    expect(html).not.toContain("<form");
  });

  it("expanded: agent chip, notice, transcript and composer", () => {
    const html = render(
      h(
        ChatDock,
        { state: "expanded", agentName: "Acme Website Assistant", version: "v1" },
        h(TranscriptMessage, { role: "user", author: "You · test", avatarName: "Talha Bera", time: "14:32", text: "Hi" }),
        h(TranscriptMessage, { role: "assistant", author: "Acme Website Assistant", time: "14:32", text: "Of course." }),
      ),
    );
    expect(html).toContain('data-state="expanded"');
    expect(classOf(html, "chat-dock")).toContain("w-100");
    expect(classOf(html, "chat-dock")).toContain("h-140");
    expect(html).toContain('data-slot="agent-chip"');
    expect(html).toContain('data-kind="customer"');
    expect(html).toContain("Test mode · replies are never sent to customers");
    expect(html).toContain('aria-label="Minimize test chat"');
    expect(html).toContain('aria-label="Close test chat"');
    expect(html).toContain('placeholder="Write a test message…"');
    expect(html).toMatch(/type="submit"[^>]*data-variant="filled"|data-variant="filled"[^>]*type="submit"/);
    expect(count(html, 'data-slot="transcript-message"')).toBe(2);
  });
});

describe("Transcript message (14:149 view=transcript)", () => {
  it("user left with initials, assistant right with source glyph", () => {
    const user = render(h(TranscriptMessage, { role: "user", author: "Katrin Vogel", time: "11:42", text: "Hi" }));
    expect(user).toContain(">KV<");
    expect(classOf(user, "transcript-message-bubble")).toContain("bg-card");
    const agent = render(h(TranscriptMessage, { role: "assistant", author: "Acme", source: "whatsapp", text: "Hello" }));
    expect(classOf(agent, "transcript-message")).toContain("justify-end");
    expect(classOf(agent, "transcript-message-bubble")).toContain("bg-primary-soft");
    expect(agent).toContain('data-brand="whatsapp"');
  });
});
