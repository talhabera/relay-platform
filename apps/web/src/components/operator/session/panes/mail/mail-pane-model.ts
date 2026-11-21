// Mail work pane (05 session-mail/*): pure model, client-safe. The email
// sequence data model is phase 2 (map #31), so the pane runs on fixtures
// (`mail-fixtures.ts`) and shows a Connect empty state until Gmail is
// connected. Everything the pane shows is derived here so it can be tested
// without a DB or a DOM.

import type { EmailCheck, EmailParagraph, EmailSegment } from "@/components/v2/work/email-step-card";

import { diffParagraphs } from "./mail-diff";

/** A recipient the body can be previewed as ("Preview as" select). */
export type MailRecipient = {
  id: string;
  /** Values for the template variables, keyed by name (`first_name`, `company`, ...). */
  values: Record<string, string>;
  /** Select label, e.g. "Julia Weber, Office Manager · Brandt Logistik". */
  label: string;
};

/**
 * One run of template text. `{{name}}` placeholders are filled per recipient;
 * `change` marks a tracked edit. Steps with a `previous` version get their
 * marks from `trackedBody` instead of carrying them.
 */
export type MailTemplateSegment = { text: string; change?: "insert" | "delete" };
export type MailTemplateParagraph = MailTemplateSegment[];

/** Deliverability checks the agent computed for a step (personalization is derived). */
export type MailStepChecks = {
  spamScore: number;
  links: { count: number; broken: number };
  unsubscribe: boolean;
};

export type MailStep = {
  id: string;
  /** Send offset in days from the sequence start (Day 0, Day 4, ...). */
  day: number;
  /** Collapsed-row label for later steps, e.g. "Follow-up". Defaults to the rendered subject. */
  label?: string;
  subject: string;
  body: MailTemplateParagraph[];
  /**
   * Template paragraphs before the agent's last edit. When set, the inline
   * diff marks are computed against it (05 session-mail/ask-for-changes).
   */
  previous?: string[];
  checks: MailStepChecks;
};

export type MailSequence = {
  steps: MailStep[];
  recipients: MailRecipient[];
  /** Number of leads the sequence goes to. */
  leadCount: number;
  /** ISO timestamp of the last edit. */
  editedAt: string;
};

const VARIABLE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** Variable names a template text uses, in order, without duplicates. */
export function templateVariables(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(VARIABLE)) {
    const name = match[1].toLowerCase();
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Every variable a step uses (subject and body). */
export function stepVariables(step: MailStep): string[] {
  const names: string[] = [];
  const texts = [step.subject, ...step.body.flatMap((p) => p.map((s) => s.text))];
  for (const text of texts) {
    for (const name of templateVariables(text)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Fills `{{variables}}` for one recipient. The pane never shows a raw
 * placeholder: a missing value renders as `[name]` and is reported in
 * `missing` so the Personalization check fails.
 */
export function renderTemplate(
  text: string,
  values: Record<string, string>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(VARIABLE, (_, raw: string) => {
    const name = raw.toLowerCase();
    const value = values[name]?.trim();
    if (value) return value;
    if (!missing.includes(name)) missing.push(name);
    return `[${name}]`;
  });
  return { text: out, missing };
}

/** Template text of a body as it will be sent (deleted runs dropped). */
function currentParagraphs(body: MailTemplateParagraph[]): string[] {
  return body.map((para) => para.filter((seg) => seg.change !== "delete").map((seg) => seg.text).join(""));
}

/**
 * The step body with inline diff marks: diffed word by word against
 * `previous` when the step has one, else the body as stored.
 */
export function trackedBody(step: MailStep): MailTemplateParagraph[] {
  if (!step.previous) return step.body;
  return diffParagraphs(step.previous, currentParagraphs(step.body));
}

export type RenderedStep = {
  subject: string;
  body: EmailParagraph[];
  /** Variables the recipient has no value for. */
  missing: string[];
};

/** A step rendered for one recipient (subject + body with tracked changes kept). */
export function renderStep(step: MailStep, recipient: MailRecipient | null): RenderedStep {
  const values = recipient?.values ?? {};
  const missing: string[] = [];
  const note = (names: string[]) => {
    for (const n of names) if (!missing.includes(n)) missing.push(n);
  };
  const subject = renderTemplate(step.subject, values);
  note(subject.missing);
  const body = trackedBody(step).map((para) =>
    para.map((seg): EmailSegment => {
      const r = renderTemplate(seg.text, values);
      // A deleted run is not sent, so its variables cannot be "missing".
      if (seg.change !== "delete") note(r.missing);
      return seg.change ? { text: r.text, change: seg.change } : { text: r.text };
    }),
  );
  return { subject: subject.text, body, missing };
}

/** "Good, low risk" bands for the spam score (lower is better). */
export function spamScoreDetail(score: number): { detail: string; ok: boolean } {
  if (score < 3) return { detail: "Good, low risk", ok: true };
  if (score < 5) return { detail: "Fair, some risk", ok: false };
  return { detail: "High, likely spam", ok: false };
}

/** The checks column for a rendered step: spam score, links, unsubscribe, personalization. */
export function stepChecks(step: MailStep, rendered: RenderedStep): EmailCheck[] {
  const spam = spamScoreDetail(step.checks.spamScore);
  const { count, broken } = step.checks.links;
  const linkWord = count === 1 ? "link" : "links";
  return [
    { label: "Spam score", metric: step.checks.spamScore.toFixed(1), ...spam },
    {
      label: "Links",
      detail:
        count === 0
          ? "No links"
          : broken > 0
            ? `${broken} of ${count} ${linkWord} broken`
            : `${count} ${linkWord}, working`,
      ok: broken === 0,
    },
    {
      label: "Unsubscribe",
      detail: step.checks.unsubscribe ? "Link present" : "Link missing",
      ok: step.checks.unsubscribe,
    },
    {
      label: "Personalization",
      detail:
        rendered.missing.length === 0
          ? "All values rendered"
          : `${rendered.missing.length} ${rendered.missing.length === 1 ? "value" : "values"} missing`,
      ok: rendered.missing.length === 0,
    },
  ];
}

/** "Day 0", "Day 4". */
export function dayLabel(day: number): string {
  return `Day ${day}`;
}

/** Collapsed header text: the step label, else its subject rendered for the recipient. */
export function stepSummary(step: MailStep, recipient: MailRecipient | null): string {
  return step.label ?? renderStep(step, recipient).subject;
}

/** "edited 2 min ago" relative to `now`. */
export function editedAgo(editedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(editedAt).getTime()) / 60_000));
  if (minutes < 1) return "edited just now";
  if (minutes < 60) return `edited ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `edited ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `edited ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Work pane header meta: "3 steps · 44 leads · edited 2 min ago". */
export function mailPaneMeta(sequence: MailSequence, now: Date): string {
  const steps = sequence.steps.length;
  const leads = sequence.leadCount;
  return [
    `${steps} ${steps === 1 ? "step" : "steps"}`,
    `${leads} ${leads === 1 ? "lead" : "leads"}`,
    editedAgo(sequence.editedAt, now),
  ].join(" · ");
}

/**
 * Accordion: one step open at a time. Clicking the open step closes it,
 * clicking another opens that one instead.
 */
export function toggleStep(openId: string | null, clickedId: string): string | null {
  return openId === clickedId ? null : clickedId;
}

/**
 * Layout of the accordion (05 session-mail/default): the open step full width
 * on top, the other steps as one row of collapsed cards in order, then
 * "Add step". With nothing open every step sits in the row.
 */
export function accordionLayout(
  steps: MailStep[],
  openId: string | null,
): { open: { step: MailStep; number: number } | null; rest: { step: MailStep; number: number }[] } {
  const numbered = steps.map((step, i) => ({ step, number: i + 1 }));
  const open = numbered.find((s) => s.step.id === openId) ?? null;
  return { open, rest: numbered.filter((s) => s !== open) };
}

/** The recipient selected by default: the first one. */
export function initialRecipientId(sequence: MailSequence): string | null {
  return sequence.recipients[0]?.id ?? null;
}

/** Plain text of a rendered step, as sent (deleted runs dropped), for "Copy". */
export function renderedPlainText(rendered: RenderedStep): string {
  const body = rendered.body
    .map((para) => para.filter((s) => s.change !== "delete").map((s) => s.text).join(""))
    .join("\n\n");
  return `Subject: ${rendered.subject}\n\n${body}`;
}

/** What the pane renders: Connect state, an empty sequence, or the sequence. */
export type MailPaneState = "connect" | "empty" | "sequence";

export function mailPaneState(args: { gmailConnected: boolean; sequence: MailSequence | null }): MailPaneState {
  if (!args.gmailConnected) return "connect";
  if (!args.sequence || args.sequence.steps.length === 0) return "empty";
  return "sequence";
}
