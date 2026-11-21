// Canon fixture for the Mail work pane (05 session-mail/default): Acme GmbH,
// "Autumn outreach — 44 Munich and Augsburg offices", Mail Marketer v1.
// The email sequence model is phase 2 (map #31); until it lands the pane
// reads this sequence while RELAY_FIXTURES=true.

import type { MailSequence } from "./mail-pane-model";

/** Fixture clock: Fri 25 Sep 2026, two minutes after the last edit. */
export const MAIL_FIXTURE_NOW = new Date("2026-09-25T10:02:00.000Z");

const signature = [[{ text: "Best regards," }], [{ text: "Markus Albrecht" }], [{ text: "Sales, Acme GmbH" }]];

export const mailSequenceFixture: MailSequence = {
  leadCount: 44,
  editedAt: "2026-09-25T10:00:00.000Z",
  recipients: [
    {
      id: "fx-lead-brandt",
      label: "Julia Weber, Office Manager · Brandt Logistik",
      values: {
        first_name: "Julia",
        company: "Brandt Logistik GmbH",
        trigger: "is opening a new office in Garching",
      },
    },
    {
      id: "fx-lead-kanzlei-lang",
      label: "Tobias Lang, Partner · Kanzlei Lang & Partner",
      values: {
        first_name: "Tobias",
        company: "Kanzlei Lang & Partner",
        trigger: "moved into a larger office in Augsburg",
      },
    },
    {
      id: "fx-lead-huber",
      label: "Sabine Huber, Facility Lead · Huber Medizintechnik",
      values: {
        first_name: "Sabine",
        company: "Huber Medizintechnik",
        trigger: "is hiring 30 people in Munich this autumn",
      },
    },
  ],
  steps: [
    {
      id: "fx-mail-step-1",
      day: 0,
      subject: "Quick question about your office, {{first_name}}",
      // The agent's last edit (05 session-mail/*): the pane diffs against
      // `previous` for the inline marks (+2 inserted, -2 removed).
      previous: [
        "Hi {{first_name}},",
        "I saw that {{company}} {{trigger}}. Many companies we work with want to cut their cleaning costs.",
        "Would a short call next week be useful? We walk through the space with you and send a fixed quote within two days.",
        "Best regards,",
        "Markus Albrecht",
        "Sales, Acme GmbH",
      ],
      body: [
        [{ text: "Hi {{first_name}}," }],
        [
          {
            text: "I saw that {{company}} {{trigger}}. Acme cleans offices of 20 to 300 employees across Munich and Augsburg on a fixed monthly contract.",
          },
        ],
        [
          {
            text: "Would a free on-site consultation next week be useful? We walk through the space with you and send a fixed quote within two days.",
          },
        ],
        ...signature,
      ],
      checks: { spamScore: 1.2, links: { count: 1, broken: 0 }, unsubscribe: true },
    },
    {
      id: "fx-mail-step-2",
      day: 4,
      label: "Follow-up",
      subject: "Re: Quick question about your office, {{first_name}}",
      body: [
        [{ text: "Hi {{first_name}}," }],
        [
          {
            text: "Just following up on my note from Monday. Happy to walk through the {{company}} office with you and send a fixed quote within two days.",
          },
        ],
        [{ text: "Would Tuesday or Thursday next week suit you?" }],
        ...signature,
      ],
      checks: { spamScore: 0.9, links: { count: 1, broken: 0 }, unsubscribe: true },
    },
    {
      id: "fx-mail-step-3",
      day: 9,
      label: "Last note",
      subject: "Closing the loop, {{first_name}}",
      body: [
        [{ text: "Hi {{first_name}}," }],
        [
          {
            text: "I will not keep filling your inbox. If office cleaning comes up at {{company}} later this year, just reply to this email and I will get back to you the same day.",
          },
        ],
        ...signature,
      ],
      checks: { spamScore: 0.8, links: { count: 1, broken: 0 }, unsubscribe: true },
    },
  ],
};
