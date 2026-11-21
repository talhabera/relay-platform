import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AgentQuestion,
  ConversationMessage,
  SessionHeader,
  SessionRow,
  ToolChip,
  WorkPaneHeader,
  sessionStatusFromChat,
  sessionStatusLabel,
  sessionStatusTone,
} from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m?.[1] ?? m?.[2] ?? "";
};

const agent = { kind: "operator" as const, name: "Mail Marketer", version: "v1", status: "live" as const };

describe("ToolChip", () => {
  it("running: spinner, teal detail", () => {
    const html = render(h(ToolChip, { label: "Edit email step 1", state: "running" }));
    expect(html).toContain('data-icon="loader-circle"');
    expect(html).toContain("animate-spin");
    expect(html).toContain("Running…");
    expect(html).toContain("text-primary");
    expect(classOf(html, "tool-chip")).toContain("border-border");
  });

  it("done: check, muted detail", () => {
    const html = render(h(ToolChip, { label: "Edit email step 1", state: "done" }));
    expect(html).toContain('data-icon="circle-check"');
    expect(html).toContain(">Done<");
  });

  it("failed: x, destructive border, detail override", () => {
    const html = render(h(ToolChip, { label: "Deliverability check", state: "failed", detail: "Timed out" }));
    expect(html).toContain('data-icon="circle-x"');
    expect(classOf(html, "tool-chip")).toContain("border-destructive");
    expect(html).toContain("Timed out");
    expect(html).not.toContain(">Failed<");
  });
});

describe("Session status mapping", () => {
  it("maps every Figma status to its Status chip tone and label", () => {
    expect(sessionStatusTone).toEqual({
      "needs-you": "needs-you",
      running: "live",
      scheduled: "pending",
      idle: "neutral",
      done: "success",
      failed: "error",
    });
    expect(sessionStatusLabel.done).toBe("Completed");
    expect(sessionStatusLabel.failed).toBe("Run failed");
  });

  it("maps chats.status to the header status", () => {
    expect(sessionStatusFromChat("needs_you")).toBe("needs-you");
    expect(sessionStatusFromChat("running")).toBe("running");
    expect(sessionStatusFromChat("completed")).toBe("done");
    expect(sessionStatusFromChat("failed")).toBe("failed");
  });
});

describe("SessionHeader", () => {
  const base = {
    title: "Autumn outreach — 44 Munich and Augsburg offices",
    crumbs: [{ label: "Workflows", href: "/workflows" }, { label: "Lead engine" }, { label: "Outreach" }],
    agent,
    startedLabel: "Started Fri 25 Sep, 11:32",
    backHref: "/operator",
  };

  it.each([
    ["needs-you", "needs-you", "Needs you"],
    ["running", "live", "Running"],
    ["scheduled", "pending", "Scheduled"],
    ["idle", "neutral", "Idle"],
    ["done", "success", "Completed"],
    ["failed", "error", "Run failed"],
  ] as const)("status=%s renders a %s Status chip", (status, tone, label) => {
    const html = render(h(SessionHeader, { ...base, status }));
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain(label);
  });

  it("renders back link, breadcrumb with current page, title, agent chip, start time and menu", () => {
    const html = render(h(SessionHeader, { ...base, status: "running" }));
    expect(html).toMatch(/<a aria-label="Back"[^>]*href="\/operator"/);
    expect(html).toContain('href="/workflows"');
    expect(html).toMatch(/aria-current="page"[^>]*>Outreach</);
    expect(html).toContain("<h1");
    expect(html).toContain(base.title);
    expect(html).toContain('data-slot="agent-chip"');
    expect(html).toContain(base.startedLabel);
    expect(html).toContain('aria-label="Session actions"');
    expect(classOf(html, "session-header")).toContain("rounded-2xl");
    expect(classOf(html, "session-header")).toContain("shadow-elevation-1");
  });

  it("shows the Needs you count beside the status chip only while status is needs-you (S46)", () => {
    const slot = 'data-slot="session-header-needs-you-count"';
    const html = render(h(SessionHeader, { ...base, status: "needs-you", needsYouCount: 2 }));
    expect(html).toContain(slot);
    expect(html).toContain('aria-label="2 waiting on you"');
    expect(render(h(SessionHeader, { ...base, status: "needs-you", needsYouCount: 0 }))).not.toContain(slot);
    expect(render(h(SessionHeader, { ...base, status: "running", needsYouCount: 2 }))).not.toContain(slot);
  });
});

describe("ConversationMessage", () => {
  it("agent default: bot avatar, author, version, time, message, no tools", () => {
    const html = render(
      h(ConversationMessage, { role: "agent", author: "Mail Marketer", version: "v1 Live", time: "11:39" }, "Shortened step 1."),
    );
    expect(html).toContain('data-icon="bot"');
    expect(html).toContain("Mail Marketer");
    expect(html).toContain("v1 Live");
    expect(html).toContain("11:39");
    expect(html).toContain("Shortened step 1.");
    expect(html).not.toContain('data-slot="tool-chip"');
    expect(classOf(html, "message-bubble")).toContain("bg-surface-raised");
  });

  it("agent with tools renders one Tool chip each", () => {
    const html = render(
      h(
        ConversationMessage,
        {
          role: "agent",
          author: "Mail Marketer",
          time: "11:39",
          tools: [
            { label: "Edit email step 1", state: "done" },
            { label: "Deliverability check", state: "done" },
          ],
        },
        "Done.",
      ),
    );
    expect(html.match(/data-slot="tool-chip"/g)).toHaveLength(2);
  });

  it("agent streaming: typing… replaces time, caret shows", () => {
    const html = render(
      h(ConversationMessage, { role: "agent", author: "Mail Marketer", time: "11:39", state: "streaming" }, "Checking"),
    );
    expect(html).toContain("typing…");
    expect(html).not.toContain("11:39");
    expect(html).toContain('data-slot="message-caret"');
    expect(html).toContain('aria-busy="true"');
  });

  it("agent error: destructive border, reason and Retry", () => {
    let retried = false;
    const html = render(
      h(
        ConversationMessage,
        {
          role: "agent",
          author: "Mail Marketer",
          time: "11:39",
          state: "error",
          errorReason: "Google Workspace timed out · 11:41",
          onRetry: () => {
            retried = true;
          },
        },
        "I couldn't finish.",
      ),
    );
    expect(classOf(html, "message-bubble")).toContain("border-destructive");
    expect(html).toContain('data-icon="circle-alert"');
    expect(html).toContain("Google Workspace timed out · 11:41");
    expect(html).toContain('data-icon="refresh-cw"');
    expect(html).toContain("Retry");
    expect(retried).toBe(false);
  });

  it("operator: right aligned, initials avatar, no bot", () => {
    const html = render(
      h(ConversationMessage, { role: "operator", author: "Talha Bera", initials: "TB", time: "11:38" }, "Make step 1 shorter."),
    );
    expect(classOf(html, "conversation-message")).toContain("justify-end");
    expect(html).toContain("TB");
    expect(html).not.toContain('data-icon="bot"');
    expect(classOf(html, "message-bubble")).toContain("bg-secondary");
  });

  it("operator error: not delivered + Retry", () => {
    const html = render(
      h(ConversationMessage, { role: "operator", author: "Talha Bera", initials: "TB", time: "11:38", state: "error" }, "x"),
    );
    expect(html).toContain("Not delivered to the agent");
    expect(html).toContain("Retry");
  });
});

describe("AgentQuestion", () => {
  const q = {
    question: "Include offices under 20 employees?",
    context: "AlphaLog scores 58 but sits below your 20-employee floor.",
    askedBy: "Lead Qualifier",
    askedAt: "11:48",
  };

  it("open: needs-you border, quick replies, hint", () => {
    const html = render(h(AgentQuestion, { ...q, state: "open", replies: ["Yes, include them", "No, keep 20+"] }));
    expect(classOf(html, "agent-question")).toContain("border-status-needs-you-foreground");
    expect(html).toContain('data-icon="message-circle"');
    expect(html).toContain("Question");
    expect(html).toContain("Lead Qualifier · 11:48");
    expect(html.match(/data-slot="button"/g)).toHaveLength(2);
    expect(html).toContain("Or type your own answer in the composer.");
  });

  it("answered: neutral border, chosen reply chip, who and when", () => {
    const html = render(
      h(AgentQuestion, {
        ...q,
        state: "answered",
        answer: { reply: "No, keep 20+", by: "Talha Bera", at: "11:52" },
      }),
    );
    expect(classOf(html, "agent-question")).toContain("border-border");
    expect(html).toContain('data-icon="circle-check"');
    expect(html).toContain("Answered");
    expect(html).toContain('data-variant="selected"');
    expect(html).toContain("No, keep 20+");
    expect(html).toContain("Talha Bera · 11:52");
    expect(html).not.toContain('data-slot="button"');
  });
});

describe("WorkPaneHeader", () => {
  it("renders icon tile, title, meta and actions", () => {
    const html = render(
      h(WorkPaneHeader, {
        title: "Email sequence",
        meta: "4 steps · 44 leads · edited 2 min ago",
        icon: "mail",
        actions: h("button", null, "Templates"),
      }),
    );
    expect(html).toContain('data-icon="mail"');
    expect(html).toContain("Email sequence");
    expect(html).toContain("4 steps · 44 leads");
    expect(html).toContain("Templates");
    expect(html).toContain('data-slot="work-pane-actions"');
  });

  it("hides actions for read-only sessions", () => {
    const html = render(h(WorkPaneHeader, { title: "Email sequence", meta: "x" }));
    expect(html).not.toContain('data-slot="work-pane-actions"');
  });
});

describe("SessionRow", () => {
  const row = {
    href: "/operator/sessions/1",
    status: "needs-you" as const,
    title: "Weekly lead run — Munich and Augsburg offices",
    workflow: "Lead engine · Qualify",
    agent: { ...agent, name: "Lead Qualifier" },
    startedBy: { kind: "schedule" as const, name: "Qualify new leads" },
    started: "Mon 21 Sep, 06:00",
    lastActivity: "38 min ago",
    checkpoints: 0,
  };

  it("renders every column and links to the session", () => {
    const html = render(h(SessionRow, row));
    expect(html).toMatch(/^<a[^>]*href="\/operator\/sessions\/1"/);
    expect(html).toContain('data-tone="needs-you"');
    expect(html).toContain(row.title);
    expect(html).toContain(row.workflow);
    expect(html).toContain("Lead Qualifier");
    expect(html).toContain('data-icon="calendar-clock"');
    expect(html).toContain("Qualify new leads");
    expect(html).toContain(row.started);
    expect(html).toContain(row.lastActivity);
    expect(html).toContain('data-slot="count-badge"');
    expect(html).toContain('data-icon="chevron-right"');
    expect(classOf(html, "session-row")).toContain("hover:bg-muted");
  });

  it("started by a person shows an initials avatar", () => {
    const html = render(h(SessionRow, { ...row, startedBy: { kind: "person", name: "Talha Bera", initials: "TB" } }));
    expect(html).toContain("TB");
    expect(html).toContain("Talha Bera");
    expect(html).not.toContain('data-icon="calendar-clock"');
  });

  it("selected uses primary-soft and aria-current", () => {
    const html = render(h(SessionRow, { ...row, selected: true }));
    expect(classOf(html, "session-row")).toContain("bg-primary-soft");
    expect(html).toContain('aria-current="true"');
  });
});
