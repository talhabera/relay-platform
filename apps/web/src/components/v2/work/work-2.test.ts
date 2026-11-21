import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CalendarPost } from "./calendar-post";
import { countChanges, EmailStepCard, type EmailParagraph } from "./email-step-card";
import { LeadRow, LeadRowHeader, leadFitTone, leadInitials } from "./lead-row";
import { PackageCard, type PackageConnector } from "./package-card";
import { REPLY_LIMIT, ReviewCard } from "./review-card";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m?.[1] ?? m?.[2] ?? "";
};

describe("Lead row", () => {
  const qualified = {
    company: "Brandt Logistik GmbH",
    companyMeta: "Munich · 180 employees",
    contactName: "Julia Weber",
    contactMeta: "Office Manager",
    fitScore: 91,
    reasons: ["New office in Garching", "Size fit"],
  };

  it("renders the header row with column labels", () => {
    const html = render(h(LeadRowHeader));
    expect(html).toContain('data-variant="header"');
    for (const label of ["Company", "Contact", "Fit", "Why"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain('aria-label="Select all leads"');
  });

  it("renders a qualified row: initials, contact, high score ring, reason chips", () => {
    const html = render(h(LeadRow, qualified));
    expect(html).toContain('data-variant="qualified"');
    expect(html).toContain(">BL<");
    expect(html).toContain("Julia Weber");
    expect(html).toContain('aria-valuenow="91"');
    expect(html).toContain('data-tone="high"');
    expect(html).toContain("New office in Garching");
    expect(html).toContain("Size fit");
    expect(html).not.toContain("Borderline");
    expect(html).toContain('aria-label="More actions for Brandt Logistik GmbH"');
  });

  it("renders a borderline row with a needs-you chip and the not-found contact", () => {
    const html = render(
      h(LeadRow, {
        company: "AlphaLog",
        companyMeta: "Augsburg · 15 employees",
        contactName: null,
        contactMeta: "No decision maker yet",
        fitScore: 58,
        reasons: ["Under 20 employees"],
        borderline: true,
      }),
    );
    expect(html).toContain('data-variant="borderline"');
    expect(html).toContain(">AL<");
    expect(html).toContain("Not found");
    expect(html).toContain('data-tone="needs-you"');
    expect(html).toContain("Borderline");
    expect(html).toContain('data-tone="low"');
  });

  it("selected rows get the primary-soft fill and a checked box", () => {
    const html = render(h(LeadRow, { ...qualified, selected: true }));
    expect(html).toContain('aria-selected="true"');
    expect(classOf(html, "lead-row")).toContain("bg-primary-soft");
    expect(html).toContain('data-state="checked"');
    expect(classOf(render(h(LeadRow, qualified)), "lead-row")).not.toContain("bg-primary-soft");
  });

  it("uses the lead fit thresholds 85 / 70 and two-letter initials", () => {
    expect([leadFitTone(85), leadFitTone(84), leadFitTone(70), leadFitTone(69)]).toEqual([
      "high",
      "mid",
      "mid",
      "low",
    ]);
    expect(leadInitials("Brandt Logistik GmbH")).toBe("BL");
    expect(leadInitials("AlphaLog")).toBe("AL");
  });
});

describe("Email step card", () => {
  const body: EmailParagraph[] = [
    [{ text: "Hi Julia," }],
    [
      { text: "I saw that Brandt Logistik GmbH is opening a new office in Garching. " },
      { text: "Many companies we work with want to cut their cleaning costs.", change: "delete" },
      { text: " " },
      { text: "Acme cleans offices of 20 to 300 employees.", change: "insert" },
    ],
    [
      { text: "Would a " },
      { text: "short call", change: "delete" },
      { text: " " },
      { text: "free on-site consultation", change: "insert" },
      { text: " next week be useful?" },
    ],
  ];
  const base = { stepNumber: 1, day: "Day 0", subject: "Quick question about your office, Julia" };

  it("collapsed shows only the header row", () => {
    const html = render(h(EmailStepCard, { ...base, body }));
    expect(html).toContain('data-state="collapsed"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Step 1<");
    expect(html).toContain(">Day 0<");
    expect(html).toContain(base.subject);
    expect(html).not.toContain('data-slot="email-body"');
  });

  it("expanded renders tracked changes, toolbar, legend and checks", () => {
    const html = render(
      h(EmailStepCard, {
        ...base,
        expanded: true,
        body,
        previewOptions: [{ value: "julia", label: "Julia Weber, Office Manager · Brandt Logistik" }],
        previewValue: "julia",
        checks: [
          { label: "Spam score", metric: "1.2", detail: "Good, low risk", ok: true },
          { label: "Links", detail: "1 link, working", ok: true },
        ],
      }),
    );
    expect(html).toContain('data-state="expanded"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Preview as");
    expect(html).toMatch(/<ins data-change="insert"[^>]*>free on-site consultation<\/ins>/);
    expect(html).toMatch(/<del data-change="delete"[^>]*>short call<\/del>/);
    expect(html).toContain("+2 inserted");
    expect(html).toContain("−2 removed");
    for (const tool of ["Bold", "Italic", "Link", "Image", "Code", "Undo", "Redo"]) {
      expect(html).toContain(`aria-label="${tool}"`);
    }
    expect(html).toContain(">1.2<");
    expect(html).toContain("Good, low risk");
    expect(html).toContain('data-icon="circle-check"');
  });

  it("counts tracked-change runs", () => {
    expect(countChanges(body)).toEqual({ inserted: 2, removed: 2 });
    expect(countChanges([])).toEqual({ inserted: 0, removed: 0 });
  });
});

describe("Calendar post", () => {
  it.each([
    ["scheduled", "Scheduled", "bg-success", "border-border"],
    ["needs-review", "Needs review", "bg-warning", "border-status-needs-you-foreground"],
    ["draft", "Draft", "bg-muted-foreground", "border-border"],
  ] as const)("status %s", (status, label, dot, border) => {
    const html = render(h(CalendarPost, { title: "Autumn deep-clean checklist", status, platform: "instagram" }));
    expect(html).toContain(`>${label}<`);
    expect(classOf(html, "calendar-post-dot")).toContain(dot);
    expect(classOf(html, "calendar-post")).toContain(border);
  });

  it.each(["instagram", "facebook", "linkedin"] as const)("platform %s renders its brand glyph", (platform) => {
    const html = render(h(CalendarPost, { title: "Post", platform }));
    expect(html).toContain(`data-brand="${platform}"`);
    expect(html).toContain('data-icon="image"');
  });
});

describe("Review card", () => {
  const base = {
    source: "google" as const,
    rating: 2,
    author: "M. Schneider",
    date: "22 Sep 2026",
    text: "Crew arrived two hours late and missed the kitchen.",
    sentiment: "negative" as const,
    reply: "Hello M. Schneider, we are sorry.\nTeam Acme GmbH",
  };

  it("collapsed: stars, author, sentiment and reply status, no editor", () => {
    const html = render(h(ReviewCard, base));
    expect(html).toContain('data-state="collapsed"');
    expect(html).toContain('aria-label="2 of 5 stars"');
    expect(html.match(/data-filled="true"/g)).toHaveLength(2);
    expect(html).toContain('data-tone="error"');
    expect(html).toContain(">Negative<");
    expect(html).toContain(">Drafted<");
    expect(html).not.toContain('data-slot="review-reply"');
    expect(classOf(html, "review-card")).toContain("border-border");
  });

  it("expanded: reply editor with count and needs-you chip, primary border", () => {
    const html = render(h(ReviewCard, { ...base, expanded: true }));
    expect(html).toContain('data-slot="review-reply"');
    expect(html).toContain("Drafted reply");
    expect(html).toContain(`${base.reply.length} / ${REPLY_LIMIT}`);
    expect(html).toContain('data-tone="needs-you"');
    expect(html).toContain('aria-label="Insert emoji"');
    expect(classOf(html, "review-card")).toContain("border-primary");
  });

  it("posted: read-only Posted reply without the editor toolbar", () => {
    const html = render(h(ReviewCard, { ...base, expanded: true, replyStatus: "posted", needsApproval: false }));
    expect(html).toContain("Posted reply");
    expect(html).not.toContain("Drafted reply");
    expect(html).not.toContain('aria-label="Insert emoji"');
    expect(html).not.toContain(`/ ${REPLY_LIMIT}`);
    expect(html).toContain(">Posted<");
  });

  it("maps sentiment and source", () => {
    const pos = render(h(ReviewCard, { ...base, source: "trustpilot", sentiment: "positive", rating: 5 }));
    expect(pos).toContain('data-brand="trustpilot"');
    expect(pos).toContain('data-tone="success"');
    expect(pos.match(/data-filled="true"/g)).toHaveLength(5);
    const neu = render(h(ReviewCard, { ...base, sentiment: "neutral" }));
    expect(neu).toContain(">Neutral<");
    expect(neu).toContain('data-tone="neutral"');
  });
});

describe("Package card", () => {
  const leadConnectors: PackageConnector[] = [
    { brand: "hunter", name: "Hunter", state: "connected" },
    { brand: "google-places", name: "Google Places", state: "warning", detail: "Quota reached, 06:00" },
    { brand: "google-workspace", name: "Google Workspace", state: "missing" },
  ];
  const base = {
    name: "Lead engine",
    tagline: "Find, qualify and contact new B2B leads, delivered to your client.",
    adds: { agents: 3, workflows: 1, schedules: 3 },
    connectors: leadConnectors,
  };

  it("installed: success chip, fact, installed date, outline Open in Operator", () => {
    const html = render(
      h(PackageCard, {
        ...base,
        state: "installed",
        fact: "6 of 10 qualified leads this week",
        installedLabel: "Installed Tue 1 Sep 2026",
        actionLabel: "Open in Operator",
        actionHref: "/operator",
      }),
    );
    expect(html).toContain('data-tone="success"');
    expect(html).toContain(">Installed<");
    expect(html).toContain("3 agents");
    expect(html).toContain("1 workflow<");
    expect(html).toContain("6 of 10 qualified leads this week");
    expect(html).toContain("Installed Tue 1 Sep 2026");
    expect(html).toContain('href="/operator"');
    expect(html).toContain("Quota reached, 06:00");
    expect(html).toContain('data-state="missing"');
    expect(html).toContain("Nothing leaves Relay without a checkpoint");
  });

  it("available: neutral chip, no fact or installed line, Install action", () => {
    const html = render(
      h(PackageCard, {
        ...base,
        state: "available",
        fact: "ignored",
        installedLabel: "ignored",
        actionLabel: "Install",
      }),
    );
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain(">Available<");
    expect(html).not.toContain('data-slot="package-fact"');
    expect(html).not.toContain("ignored");
    expect(html).toContain(">Install</button>");
  });

  it("needs-connector: pending Waiting chip and amber fact; read-only hides the action", () => {
    const props = {
      ...base,
      name: "Social media",
      state: "needs-connector" as const,
      adds: { agents: 1, workflows: 2, schedules: 2 },
      connectors: [
        { brand: "meta" as const, name: "Meta", state: "missing" as const },
        { brand: "linkedin" as const, name: "LinkedIn", state: "optional" as const },
      ],
      fact: "Waiting for Meta, Google Business Profile",
      actionLabel: "Connect Meta",
    };
    const html = render(h(PackageCard, props));
    expect(html).toContain('data-tone="pending"');
    expect(html).toContain(">Waiting<");
    expect(html).toContain("1 agent<");
    expect(classOf(html, "package-fact")).toContain("bg-status-needs-you");
    expect(html).toContain(">Optional<");
    expect(html).toContain("Connect Meta");
    expect(render(h(PackageCard, { ...props, readOnly: true }))).not.toContain("Connect Meta");
  });
});
