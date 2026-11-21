import { describe, expect, it } from "vitest";

import { MAIL_FIXTURE_NOW, mailSequenceFixture } from "./mail-fixtures";
import {
  accordionLayout,
  editedAgo,
  initialRecipientId,
  mailPaneMeta,
  mailPaneState,
  renderStep,
  renderTemplate,
  renderedPlainText,
  spamScoreDetail,
  stepChecks,
  stepSummary,
  stepVariables,
  templateVariables,
  toggleStep,
  trackedBody,
  type MailStep,
} from "./mail-pane-model";

const [step1, step2, step3] = mailSequenceFixture.steps;
const julia = mailSequenceFixture.recipients[0];

describe("templates", () => {
  it("lists variables once, in order", () => {
    expect(templateVariables("Hi {{first_name}}, {{ company }} and {{FIRST_NAME}}")).toEqual([
      "first_name",
      "company",
    ]);
    expect(stepVariables(step1)).toEqual(["first_name", "company", "trigger"]);
  });

  it("fills values and never leaves a raw placeholder", () => {
    expect(renderTemplate("Hi {{first_name}}", { first_name: "Julia" })).toEqual({
      text: "Hi Julia",
      missing: [],
    });
    const r = renderTemplate("At {{company}}, {{ company }}", { company: "  " });
    expect(r.text).toBe("At [company], [company]");
    expect(r.text).not.toContain("{{");
    expect(r.missing).toEqual(["company"]);
  });
});

describe("renderStep", () => {
  it("renders the Figma body for Julia with tracked changes kept", () => {
    const r = renderStep(step1, julia);
    expect(r.subject).toBe("Quick question about your office, Julia");
    expect(r.missing).toEqual([]);
    expect(r.body[0]).toEqual([{ text: "Hi Julia," }]);
    expect(r.body[1][0].text).toBe("I saw that Brandt Logistik GmbH is opening a new office in Garching. ");
    expect(r.body[1].filter((s) => s.change === "insert")).toHaveLength(1);
    expect(r.body[2].filter((s) => s.change === "delete").map((s) => s.text)).toEqual(["short call"]);
  });

  it("re-renders for another recipient (preview as)", () => {
    const tobias = mailSequenceFixture.recipients[1];
    expect(renderStep(step1, tobias).subject).toBe("Quick question about your office, Tobias");
  });

  it("reports missing values, but not ones inside deleted runs", () => {
    const step: MailStep = {
      ...step1,
      previous: undefined,
      subject: "Hi",
      body: [[{ text: "{{gone}}", change: "delete" }, { text: "{{city}}" }]],
    };
    expect(renderStep(step, julia).missing).toEqual(["city"]);
    expect(renderStep(step, null).missing).toEqual(["city"]);
  });
});

describe("trackedBody (inline diff marks)", () => {
  it("computes step 1's marks from its previous version: +2 inserted, -2 removed", () => {
    const segments = renderStep(step1, julia).body.flat();
    expect(segments.filter((s) => s.change === "insert").map((s) => s.text)).toEqual([
      "Acme cleans offices of 20 to 300 employees across Munich and Augsburg on a fixed monthly contract.",
      "free on-site consultation",
    ]);
    expect(segments.filter((s) => s.change === "delete").map((s) => s.text)).toEqual([
      "Many companies we work with want to cut their cleaning costs.",
      "short call",
    ]);
  });

  it("keeps stored marks when there is no previous version", () => {
    expect(trackedBody(step2)).toBe(step2.body);
  });

  it("diffs the text as sent, ignoring stale delete runs in the body", () => {
    const step: MailStep = {
      ...step2,
      previous: ["Hi {{first_name}}, old"],
      body: [[{ text: "Hi {{first_name}}, " }, { text: "stale", change: "delete" }, { text: "new" }]],
    };
    expect(trackedBody(step)).toEqual([
      [{ text: "Hi {{first_name}}, " }, { text: "old", change: "delete" }, { text: " " }, { text: "new", change: "insert" }],
    ]);
  });
});

describe("checks", () => {
  it("matches the Figma checks column for step 1", () => {
    expect(stepChecks(step1, renderStep(step1, julia))).toEqual([
      { label: "Spam score", metric: "1.2", detail: "Good, low risk", ok: true },
      { label: "Links", detail: "1 link, working", ok: true },
      { label: "Unsubscribe", detail: "Link present", ok: true },
      { label: "Personalization", detail: "All values rendered", ok: true },
    ]);
  });

  it("flags broken links, a missing unsubscribe and missing values", () => {
    const step: MailStep = {
      ...step1,
      checks: { spamScore: 5.4, links: { count: 3, broken: 1 }, unsubscribe: false },
    };
    const checks = stepChecks(step, renderStep(step, { id: "x", label: "x", values: {} }));
    expect(checks.map((c) => c.ok)).toEqual([false, false, false, false]);
    expect(checks[1].detail).toBe("1 of 3 links broken");
    expect(checks[2].detail).toBe("Link missing");
    expect(checks[3].detail).toBe("3 values missing");
  });

  it("bands the spam score", () => {
    expect(spamScoreDetail(2.9).ok).toBe(true);
    expect(spamScoreDetail(3).detail).toBe("Fair, some risk");
    expect(spamScoreDetail(7).detail).toBe("High, likely spam");
  });
});

describe("header + accordion", () => {
  it("builds the Figma meta line", () => {
    expect(mailPaneMeta(mailSequenceFixture, MAIL_FIXTURE_NOW)).toBe("3 steps · 44 leads · edited 2 min ago");
  });

  it("formats edited-ago", () => {
    const at = "2026-09-25T10:00:00.000Z";
    expect(editedAgo(at, new Date("2026-09-25T10:00:30.000Z"))).toBe("edited just now");
    expect(editedAgo(at, new Date("2026-09-25T13:00:00.000Z"))).toBe("edited 3 h ago");
    expect(editedAgo(at, new Date("2026-09-27T10:00:00.000Z"))).toBe("edited 2 days ago");
  });

  it("keeps one step open at a time", () => {
    expect(toggleStep(null, "a")).toBe("a");
    expect(toggleStep("a", "a")).toBeNull();
    expect(toggleStep("a", "b")).toBe("b");
  });

  it("puts the open step on top and the rest in a row, numbered by position", () => {
    const layout = accordionLayout(mailSequenceFixture.steps, step2.id);
    expect(layout.open).toEqual({ step: step2, number: 2 });
    expect(layout.rest.map((s) => s.number)).toEqual([1, 3]);
    expect(accordionLayout(mailSequenceFixture.steps, null).rest).toHaveLength(3);
  });

  it("summarizes collapsed steps by label, else by rendered subject", () => {
    expect(stepSummary(step1, julia)).toBe("Quick question about your office, Julia");
    expect(stepSummary(step2, julia)).toBe("Follow-up");
    expect(stepSummary(step3, julia)).toBe("Last note");
  });

  it("previews as the first recipient by default", () => {
    expect(initialRecipientId(mailSequenceFixture)).toBe("fx-lead-brandt");
    expect(initialRecipientId({ ...mailSequenceFixture, recipients: [] })).toBeNull();
  });
});

describe("copy + state", () => {
  it("copies the text as sent: deletions dropped, insertions kept", () => {
    const text = renderedPlainText(renderStep(step1, julia));
    expect(text.startsWith("Subject: Quick question about your office, Julia\n\nHi Julia,")).toBe(true);
    expect(text).toContain("free on-site consultation");
    expect(text).not.toContain("short call");
  });

  it("shows Connect until Gmail is connected", () => {
    expect(mailPaneState({ gmailConnected: false, sequence: mailSequenceFixture })).toBe("connect");
    expect(mailPaneState({ gmailConnected: true, sequence: null })).toBe("empty");
    expect(mailPaneState({ gmailConnected: true, sequence: { ...mailSequenceFixture, steps: [] } })).toBe("empty");
    expect(mailPaneState({ gmailConnected: true, sequence: mailSequenceFixture })).toBe("sequence");
  });
});
