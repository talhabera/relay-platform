import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatComposer, CheckpointCard, Message, SteeringComposer, type CheckpointCardState } from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m?.[1] ?? m?.[2] ?? "";
};
const noop = () => {};

describe("CheckpointCard", () => {
  const base = {
    title: "Schedule sequence to 44 leads",
    meta: "Starts Tue 29 Sep, 09:00 · max 40 emails a day",
    approveLabel: "Approve & schedule",
  };
  const card = (state: CheckpointCardState, extra: Record<string, unknown> = {}) =>
    render(h(CheckpointCard, { ...base, state, ...extra }));

  it("pending: teal border, Approve, Ask for changes, Discard", () => {
    const html = card("pending");
    expect(classOf(html, "checkpoint-card")).toContain("border-primary");
    expect(html).toContain('data-icon="clipboard-check"');
    expect(html).toContain("Ready for your review");
    expect(html).toContain("Approve &amp; schedule");
    expect(html).toContain("Ask for changes");
    expect(html).toContain(">Discard<");
    expect(html).toContain("Schedule sequence to 44 leads");
    expect(html).toContain("max 40 emails a day");
  });

  it("changes-requested: warning label, quoted direction, revising note, no actions", () => {
    const html = card("changes-requested", {
      detail: "Talha Bera · 11:44",
      changeRequest: "Make step 1 shorter.",
      revisingNote: "Mail Marketer is revising the draft…",
    });
    expect(html).toContain("Changes requested");
    expect(html).toContain("text-warning");
    expect(html).toContain("Talha Bera · 11:44");
    expect(html).toContain('data-slot="checkpoint-quote"');
    expect(html).toContain("Make step 1 shorter.");
    expect(html).toContain("revising the draft");
    expect(html).not.toContain('data-slot="checkpoint-actions"');
  });

  it("approved: success label, result line, no actions", () => {
    const html = card("approved", { detail: "Talha Bera · 11:46", result: "Scheduled · first send Tue 29 Sep, 09:00" });
    expect(html).toContain(">Approved<");
    expect(html).toContain("text-success");
    expect(html).toContain('data-icon="calendar-clock"');
    expect(html).toContain("first send Tue 29 Sep");
    expect(html).not.toContain('data-slot="checkpoint-actions"');
  });

  it("discarded: muted title, nothing sent", () => {
    const html = card("discarded", { detail: "Talha Bera · 11:47" });
    expect(html).toContain(">Discarded<");
    expect(html).toContain('type-h3 text-muted-foreground');
    expect(html).toContain("Nothing was sent.");
    expect(html).not.toContain('data-slot="checkpoint-actions"');
  });

  it("failed: destructive border, Retry instead of Approve", () => {
    const html = card("failed", { detail: "Google Workspace rejected 3 addresses · 11:46" });
    expect(classOf(html, "checkpoint-card")).toContain("border-destructive");
    expect(html).toContain('data-icon="triangle-alert"');
    expect(html).toContain(">Retry<");
    expect(html).not.toContain("Approve &amp; schedule");
    expect(html).toContain("Ask for changes");
  });

  it("stale: Refresh checkpoint + Discard, no Approve", () => {
    const html = card("stale");
    expect(classOf(html, "checkpoint-card")).toContain("border-border-strong");
    expect(html).toContain('data-icon="history"');
    expect(html).toContain("Refresh checkpoint");
    expect(html).toContain(">Discard<");
    expect(html).not.toContain("Approve");
  });

  it("read-only: disabled Approve with lock note", () => {
    const html = card("read-only", { lockNote: "Only owners can approve. Talha Bera was notified." });
    expect(html).toContain("Waiting for an owner");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Approve &amp; schedule/);
    expect(html).toContain('data-slot="checkpoint-lock"');
    expect(html).toContain("Talha Bera was notified.");
    expect(html).not.toContain("Ask for changes");
  });

  it("actions limits the buttons (customer chat: no Ask for changes)", () => {
    const html = card("pending", { actions: ["approve", "discard"] });
    expect(html).toContain("Approve &amp; schedule");
    expect(html).toContain(">Discard<");
    expect(html).not.toContain("Ask for changes");
  });

  it("empty actions on failed: no action row", () => {
    const html = card("failed", { actions: [] });
    expect(html).not.toContain('data-slot="checkpoint-actions"');
  });

  it("approved with retry (stuck card): Retry only", () => {
    const html = card("approved", { actions: ["retry"] });
    expect(html).toContain(">Retry<");
    expect(html).toContain('data-slot="checkpoint-actions"');
  });

  it("preview shows the draft verbatim", () => {
    const html = card("pending", { preview: "Hi Ayse,\nthanks" });
    expect(html).toContain('data-slot="checkpoint-preview"');
    expect(html).toContain("Hi Ayse,\nthanks");
  });

  it("busy disables every action", () => {
    const html = card("pending", { busy: true });
    expect(html.match(/disabled=""/g)?.length).toBe(3);
  });
});

describe("SteeringComposer", () => {
  const base = { value: "", onChange: noop, onSubmit: noop };
  const chips = [
    { label: "Change tone", icon: "pencil" as const },
    { label: "Translate to German", icon: "languages" as const },
  ];

  it("default: steering chips, attach, placeholder, filled send", () => {
    const html = render(h(SteeringComposer, { ...base, chips }));
    expect(html).toContain('data-state="default"');
    expect(html.match(/data-variant="steering"/g)?.length).toBe(2);
    expect(html).toContain('data-icon="paperclip"');
    expect(html).toContain("Tell the agent what to change…");
    expect(html).toMatch(/data-variant="filled"[^>]*aria-label="Send"/);
    expect(classOf(html, "steering-input")).toContain("focus-within:shadow-focus-ring");
    expect(classOf(html, "steering-input")).toContain("border-input");
  });

  it("quoting: quote block with remove button and ring", () => {
    const html = render(h(SteeringComposer, { ...base, quote: { text: "Schedule sequence to 44 leads" } }));
    expect(html).toContain('data-state="quoting"');
    expect(html).toContain("Ask for changes · Checkpoint");
    expect(html).toContain("Schedule sequence to 44 leads");
    expect(html).toContain('aria-label="Remove quote"');
    expect(html).toContain("Say what should change…");
    expect(classOf(html, "steering-input")).toContain("border-ring");
  });

  it("disabled: muted box, read-only placeholder, faded chips, no quote", () => {
    const html = render(h(SteeringComposer, { ...base, chips, disabled: true, quote: { text: "x" } }));
    expect(html).toContain('data-state="disabled"');
    expect(classOf(html, "steering-input")).toContain("bg-muted");
    expect(classOf(html, "steering-chips")).toContain("opacity-40");
    expect(html).toContain("Read-only · you can view this session but not steer it");
    expect(html).not.toContain('data-slot="steering-quote"');
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });

  it("hides the chip row without chips", () => {
    expect(render(h(SteeringComposer, base))).not.toContain('data-slot="steering-chips"');
  });
});

describe("Message", () => {
  it("widget user: teal bubble on the right", () => {
    const html = render(h(Message, { role: "user" }, "Hi"));
    expect(classOf(html, "message")).toContain("items-end");
    expect(classOf(html, "message-bubble")).toContain("bg-primary");
    expect(html).toContain(">Hi<");
  });

  it("widget assistant streaming: left, teal dot, Typing…", () => {
    const html = render(h(Message, { role: "assistant", state: "streaming" }, "Of course."));
    expect(classOf(html, "message")).toContain("items-start");
    expect(classOf(html, "message-bubble")).toContain("bg-surface-raised");
    expect(html).toContain("bg-primary");
    expect(html).toContain("Typing…");
    expect(html).toContain('aria-busy="true"');
  });

  it("widget errors: per-role copy, retry button when onRetry is set", () => {
    expect(render(h(Message, { role: "user", state: "error" }, "Hi"))).toContain("Not delivered. Tap to retry.");
    const html = render(h(Message, { role: "assistant", state: "error", onRetry: noop }, "x"));
    expect(html).toContain("Reply interrupted. Tap to retry.");
    expect(html).toMatch(/<button[^>]*data-slot="message-error"/);
  });

  it("transcript user: initials avatar, name and time, card bubble", () => {
    const html = render(
      h(Message, { role: "user", view: "transcript", author: "Katrin Vogel", time: "11:40", initials: "KV" }, "Hi"),
    );
    expect(html).toContain(">KV<");
    expect(html).toContain("Katrin Vogel");
    expect(html).toContain("11:40");
    expect(classOf(html, "message-bubble")).toContain("bg-card");
  });

  it("transcript assistant: right, source glyph, soft bubble, status copy", () => {
    const html = render(
      h(Message, { role: "assistant", view: "transcript", state: "streaming", author: "Acme Website Assistant" }, "x"),
    );
    expect(classOf(html, "message")).toContain("justify-end");
    expect(html).toContain('data-slot="brand-glyph"');
    expect(classOf(html, "message-bubble")).toContain("bg-primary-soft");
    expect(html).toContain("Agent is replying…");
    expect(render(h(Message, { role: "user", view: "transcript", state: "error" }, "x"))).toContain(
      "Not delivered to the agent.",
    );
  });
});

describe("ChatComposer", () => {
  const base = { value: "", onChange: noop, onSubmit: noop };
  const suggestions = ["Draft outreach", "Summarise session"];

  it("centered desktop: heading, box, Send sm, suggestion Buttons md", () => {
    const html = render(h(ChatComposer, { ...base, mode: "centered", suggestions }));
    expect(html).toContain("What can I help you ship?");
    expect(html).toContain("Message Relay…");
    expect(html).toMatch(/data-size="sm"[^>]*type="submit"/);
    expect(html.match(/data-variant="outline" data-size="md"/g)?.length).toBe(2);
    expect(classOf(html, "chat-composer-box")).toContain("focus-within:border-ring");
  });

  it("mobile: 44px Send and suggestions", () => {
    const html = render(h(ChatComposer, { ...base, mode: "centered", size: "mobile", suggestions }));
    expect(html).toMatch(/data-size="lg"[^>]*type="submit"/);
    expect(html.match(/data-variant="outline" data-size="lg"/g)?.length).toBe(2);
  });

  it("docked: no heading, no suggestions", () => {
    const html = render(h(ChatComposer, { ...base, suggestions }));
    expect(html).toContain('data-mode="docked"');
    expect(html).not.toContain("What can I help you ship?");
    expect(html).not.toContain("Draft outreach");
  });

  it("paperclip disabled draws a disabled attach button; hidden draws none", () => {
    expect(render(h(ChatComposer, { ...base, paperclip: "disabled" }))).toMatch(
      /<button[^>]*disabled=""[^>]*data-slot="chat-composer-paperclip"/,
    );
    expect(render(h(ChatComposer, base))).not.toContain("chat-composer-paperclip");
  });

  it("disabled: Send and textarea disabled, no focus ring", () => {
    const html = render(h(ChatComposer, { ...base, disabled: true }));
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
    expect(classOf(html, "chat-composer-box")).not.toContain("focus-within");
  });
});
