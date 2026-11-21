// Canonical fixture dataset: the Figma copy (file G3uunGxdgAN0Io3bZeyriQ) for
// Acme GmbH at the moment every frame is drawn, Fri 25 Sep 2026, 11:52.
// Sources: content canon in docs/dispatch/figma-redesign/brief.md §3 and
// client-view.md §2, the canonical Needs you snapshot in docs/design/README.md
// (order per docs/superpowers/specs/2026-10-02-needs-you-ordering.md), and the
// report/live facts in docs/dispatch/39-facts.md. Screen sessions render this
// data; change copy here only when the Figma copy changes.

import {
  DEFAULT_PAGE_PERMISSIONS,
  OWNER_PAGE_PERMISSIONS,
} from "@relay/db/schema";
import type { HandoffRequestView } from "../interfaces";
import type { FixtureData } from "../loaders";

/**
 * Munich wall-clock time. Every date in the canon falls in summer time
 * (UTC+2; it ends 25 Oct 2026), although the frames label the clock "CET".
 */
const munich = (local: string) =>
  new Date(`${local.replace(" ", "T")}:00.000+02:00`);

/** Fixed clock: the frames read 11:52 on Fri 25 Sep 2026. */
export const FIXTURE_NOW = munich("2026-09-25 11:52");

export const FIXTURE_IDS = {
  company: "fx-company-acme",
  /** Talha Bera, agency owner. */
  owner: "fx-user-talha",
  /** Deniz Aksoy, member with operator access and approve rights. */
  approver: "fx-user-deniz",
  /** Member without approve rights. Not in any frame; covers the read-only case. */
  viewer: "fx-user-selin",
  /** Markus Albrecht, Sales at Acme GmbH: client user and handoff recipient. */
  client: "fx-user-markus",
  gatherer: "fx-agent-lead-gatherer",
  qualifier: "fx-agent-lead-qualifier",
  mailer: "fx-agent-mail-marketer",
  social: "fx-agent-social-media-manager",
  analyst: "fx-agent-market-analyst",
  websiteAssistant: "fx-agent-website-assistant",
  instagramConcierge: "fx-agent-instagram-concierge",
  leadEngine: "fx-wf-lead-engine",
  socialMedia: "fx-wf-social-media",
  insights: "fx-wf-insights",
  lukasChat: "fx-chat-lukas-brenner",
  tobiasChat: "fx-chat-tobias-lang",
  lukasHandoff: "fx-handoff-lukas",
  tobiasHandoff: "fx-handoff-tobias",
} as const;

const ID = FIXTURE_IDS;
const C = ID.company;

// ---------------------------------------------------------------------------
// Lukas handoff (client-view.md §2 "Handoff scenario", handoff-07.md item 4).
// The dataset holds it `open`, as Live and 11c `open` show it at 11:52. The
// Inbox frames show it answered at 11:49: use `lukasHandoffAs("answered")`.
// ---------------------------------------------------------------------------

export const LUKAS_HANDOFF = {
  customer: {
    name: "Lukas Brenner",
    initials: "LB",
    title: "Facility Manager",
    company: "Isar Data GmbH",
  },
  agentName: "Acme Website Assistant",
  recipient: { name: "Markus Albrecht", role: "Sales", company: "Acme GmbH" },
  link: "go.relay.chat/h/7KQ2MX",
  sentAt: munich("2026-09-25 11:46"),
  expiresAt: munich("2026-09-25 13:46"),
  question:
    "Can we offer weekend cleaning for 1,200 m², twice a week, from Mon 5 Oct?",
  whyYou: "Why you: weekend rates are not in the price list.",
  waitingText: "A colleague will confirm the weekend rate in a few minutes.",
  suggestedReplies: [
    "Yes, send the weekend rate and offer a site visit",
    "Ask for their floor plan first",
    "I'll call them today",
  ],
  answer:
    "Yes, we can. Weekend cleaning twice a week for 1,200 m² starts at €2,450 a month. Could we visit on Tue 29 Sep at 10:00 to confirm the details?",
  answeredAt: munich("2026-09-25 11:49"),
  /** Widget transcript, word for word (12c desktop `470:64569`). */
  transcript: [
    { at: "11:43", from: "customer", text: "Hi, I'm Lukas Brenner, Facility Manager at Isar Data GmbH." },
    { at: "11:43", from: "agent", text: "Hi Lukas, welcome to Acme. How can I help?" },
    { at: "11:44", from: "customer", text: "Do you offer weekend cleaning?" },
    { at: "11:45", from: "customer", text: "1,200 m², twice a week, from Mon 5 Oct." },
    { at: "11:46", from: "agent", text: "A colleague will confirm the weekend rate in a few minutes." },
    { at: "11:46", from: "system", text: "Handoff sent to Markus Albrecht by WhatsApp" },
    { at: "11:47", from: "customer", text: "Great, thanks. I'll wait." },
    { at: "11:49", from: "person", text: "Yes, we can. Weekend cleaning twice a week for 1,200 m² starts at €2,450 a month. Could we visit on Tue 29 Sep at 10:00 to confirm the details?" },
    { at: "11:49", from: "agent", text: "Thanks, Markus. Lukas, shall I book Tue 29 Sep, 10:00?" },
  ],
} as const;

const lukasOpen: HandoffRequestView = {
  id: ID.lukasHandoff,
  companyId: C,
  agentId: ID.websiteAssistant,
  agentName: LUKAS_HANDOFF.agentName,
  chatId: ID.lukasChat,
  customerName: LUKAS_HANDOFF.customer.name,
  channel: "widget",
  status: "open",
  mode: "quick_answer",
  reason: "price_not_listed",
  confidence: null,
  questions: [
    {
      text: LUKAS_HANDOFF.question,
      askedAt: LUKAS_HANDOFF.sentAt.toISOString(),
    },
  ],
  suggestedReplies: [...LUKAS_HANDOFF.suggestedReplies],
  recipientName: LUKAS_HANDOFF.recipient.name,
  expiresAt: LUKAS_HANDOFF.expiresAt,
  answer: null,
  replyMode: null,
  answeredAt: null,
  takenOverAt: null,
  handedBackAt: null,
  expiredAt: null,
  createdAt: LUKAS_HANDOFF.sentAt,
};

/** The Lukas request in another state, for the 07, 08a and 11c state frames. */
export function lukasHandoffAs(
  status: HandoffRequestView["status"],
): HandoffRequestView {
  switch (status) {
    case "open":
      return { ...lukasOpen };
    case "answered":
      return {
        ...lukasOpen,
        status,
        answer: LUKAS_HANDOFF.answer,
        replyMode: "person",
        answeredAt: LUKAS_HANDOFF.answeredAt,
      };
    case "taken_over":
      return { ...lukasOpen, status, takenOverAt: LUKAS_HANDOFF.answeredAt };
    case "handed_back":
      return {
        ...lukasOpen,
        status,
        takenOverAt: LUKAS_HANDOFF.answeredAt,
        handedBackAt: munich("2026-09-25 12:19"),
      };
    case "expired":
      return {
        ...lukasOpen,
        status,
        expiredAt: LUKAS_HANDOFF.expiresAt,
      };
  }
}

export const fixtureData: FixtureData = {
  companies: [
    { id: C, name: "Acme GmbH", ownerId: ID.owner, timezone: "Europe/Berlin" },
  ],
  users: [
    { id: ID.owner, name: "Talha Bera", email: "talha.bera@agency.example" },
    { id: ID.approver, name: "Deniz Aksoy", email: "deniz.aksoy@agency.example" },
    { id: ID.viewer, name: "Selin Kaya", email: "selin.kaya@agency.example" },
    { id: ID.client, name: "Markus Albrecht", email: "markus.albrecht@acme.example" },
  ],
  members: [
    {
      companyId: C,
      userId: ID.approver,
      role: "member",
      pagePermissions: OWNER_PAGE_PERMISSIONS,
    },
    {
      companyId: C,
      userId: ID.viewer,
      role: "member",
      pagePermissions: DEFAULT_PAGE_PERMISSIONS,
    },
    {
      companyId: C,
      userId: ID.client,
      role: "client",
      pagePermissions: DEFAULT_PAGE_PERMISSIONS,
    },
  ],
  agents: [
    { id: ID.gatherer, companyId: C, name: "Lead Gatherer", kind: "operator", createdByUserId: ID.owner },
    { id: ID.qualifier, companyId: C, name: "Lead Qualifier", kind: "operator", createdByUserId: ID.owner },
    { id: ID.mailer, companyId: C, name: "Mail Marketer", kind: "operator", createdByUserId: ID.owner },
    { id: ID.social, companyId: C, name: "Social Media Manager", kind: "operator", createdByUserId: ID.owner },
    { id: ID.analyst, companyId: C, name: "Market Analyst", kind: "operator", createdByUserId: ID.owner },
    { id: ID.websiteAssistant, companyId: C, name: "Acme Website Assistant", kind: "customer", createdByUserId: ID.owner },
    { id: ID.instagramConcierge, companyId: C, name: "Acme Instagram Concierge", kind: "customer", createdByUserId: ID.owner },
  ],
  agentUsers: [
    { agentId: ID.qualifier, userId: ID.approver, canEdit: true, canApprove: true },
    { agentId: ID.mailer, userId: ID.approver, canEdit: false, canApprove: true },
    { agentId: ID.social, userId: ID.approver, canEdit: false, canApprove: true },
    { agentId: ID.qualifier, userId: ID.viewer, canEdit: true, canApprove: false },
    // A client row never passes approve, whatever its flags say.
    { agentId: ID.qualifier, userId: ID.client, canEdit: false, canApprove: true },
  ],
  workflows: [
    {
      id: ID.leadEngine,
      companyId: C,
      packageSlug: "lead-engine",
      name: "Lead engine",
      flow: "sequence",
      position: 0,
      weeklyTarget: 10,
      targetMetricKey: "leads.qualified_delivered",
      inboundStageId: "fx-stage-qualify",
      intake: [
        { key: "name", label: "Name", required: true },
        { key: "company", label: "Company", required: false },
        { key: "need", label: "Need", required: true },
        { key: "budget", label: "Budget", required: false },
        { key: "timeline", label: "Timeline", required: false },
        { key: "location", label: "Location", required: false },
      ],
      stages: [
        { id: "fx-stage-gather", order: 0, name: "Gather", agentId: ID.gatherer, metricKey: "records.gathered", state: "active" },
        { id: "fx-stage-qualify", order: 1, name: "Qualify", agentId: ID.qualifier, metricKey: "records.qualified", state: "default" },
        { id: "fx-stage-outreach", order: 2, name: "Outreach", agentId: ID.mailer, metricKey: "records.contacted_replied", state: "default" },
        { id: "fx-stage-delivered", order: 3, name: "Delivered to client", agentId: null, metricKey: "records.delivered", state: "default" },
      ],
    },
    {
      id: ID.socialMedia,
      companyId: C,
      packageSlug: "social-media",
      name: "Social media",
      flow: "parallel",
      position: 1,
      weeklyTarget: null,
      targetMetricKey: null,
      inboundStageId: null,
      intake: [],
      stages: [
        { id: "fx-stage-calendar", order: 0, name: "Content calendar", agentId: ID.social, metricKey: "posts.scheduled_review", state: "default" },
        { id: "fx-stage-reviews", order: 1, name: "Review management", agentId: ID.social, metricKey: "reviews.new_negative", state: "idle" },
      ],
    },
    {
      id: ID.insights,
      companyId: C,
      packageSlug: "insights",
      name: "Insights",
      flow: "sequence",
      position: 2,
      weeklyTarget: null,
      targetMetricKey: null,
      inboundStageId: null,
      intake: [],
      stages: [
        { id: "fx-stage-analysis", order: 0, name: "Marketing analysis", agentId: ID.analyst, metricKey: "report.next_run", state: "idle" },
      ],
    },
  ],
  // This week, 21-27 Sep: 9 inbound from 22 customer-agent conversations.
  inbound: [
    {
      workflowId: ID.leadEngine,
      leads: 9,
      conversations: 22,
      customerAgentIds: [ID.websiteAssistant, ID.instagramConcierge],
    },
  ],
  // Week to date. Gathered 146 -> Qualified 44 (35 gathered + 9 inbound) ->
  // Outreach 31 contacted, 9 replied -> Delivered to client 6 of 10.
  metricValues: [
    {
      companyId: C,
      values: {
        "records.gathered": 146,
        "records.qualified": 44,
        "records.contacted_replied": 31,
        "records.delivered": 6,
        "leads.qualified_delivered": 6,
        "leads.inbound": 9,
        "leads.quality_score": 82,
        "conversations.started": 22,
        "posts.scheduled_review": 3,
        "reviews.new_negative": 1,
      },
    },
  ],
  // Canonical Needs you snapshot. Rendered order (tier, then oldest first):
  // quota 6h -> question 38m -> sequence 12m -> posts 2h -> replies 1h.
  needsYou: [
    {
      companyId: C,
      type: "failed_run",
      id: "fx-ny-places-quota",
      agentId: ID.gatherer,
      agentName: "Lead Gatherer",
      title: "Google Places quota reached",
      createdAt: munich("2026-09-25 06:00"),
      chatId: null,
      cronRunId: "fx-run-gather-0600",
      cronJobId: "fx-job-gather-daily",
      error: "quota_exceeded",
    },
    {
      companyId: C,
      type: "agent_question",
      id: "fx-ny-small-offices",
      agentId: ID.qualifier,
      agentName: "Lead Qualifier",
      title: "Include offices under 20 employees?",
      createdAt: munich("2026-09-25 11:14"),
      chatId: "fx-chat-lead-qualifier",
      cronRunId: null,
      cronJobId: null,
    },
    {
      companyId: C,
      type: "checkpoint",
      id: "fx-ny-autumn-sequence",
      agentId: ID.mailer,
      agentName: "Mail Marketer",
      title: "Schedule sequence to 44 leads",
      createdAt: munich("2026-09-25 11:40"),
      chatId: "fx-chat-mail-marketer",
      cronRunId: null,
      cronJobId: null,
      checkpointKind: "outreach",
      checkpointStatus: "pending",
      approval: { agentCreatedByUserId: ID.owner, sessionUserId: ID.owner },
    },
    {
      companyId: C,
      type: "checkpoint",
      id: "fx-ny-october-posts",
      agentId: ID.social,
      agentName: "Social Media Manager",
      title: "Schedule 3 reviewed posts",
      createdAt: munich("2026-09-25 09:52"),
      chatId: "fx-chat-content-calendar",
      cronRunId: null,
      cronJobId: null,
      checkpointKind: "post",
      checkpointStatus: "pending",
      approval: { agentCreatedByUserId: ID.owner, sessionUserId: ID.owner },
    },
    {
      companyId: C,
      type: "checkpoint",
      id: "fx-ny-review-replies",
      agentId: ID.social,
      agentName: "Social Media Manager",
      title: "Post 5 replies",
      createdAt: munich("2026-09-25 10:52"),
      chatId: "fx-chat-review-management",
      cronRunId: null,
      cronJobId: null,
      checkpointKind: "review_reply",
      checkpointStatus: "pending",
      approval: { agentCreatedByUserId: ID.owner, sessionUserId: ID.owner },
    },
  ],
  handoffRequests: [
    lukasOpen,
    // Inbox "Waiting for you": the link expired at 18:10 with no answer.
    {
      id: ID.tobiasHandoff,
      companyId: C,
      agentId: ID.websiteAssistant,
      agentName: "Acme Website Assistant",
      chatId: ID.tobiasChat,
      customerName: "Tobias Lang",
      channel: "widget",
      status: "expired",
      mode: "quick_answer",
      reason: "complaint_or_refund",
      confidence: null,
      questions: [
        {
          text: "Bins were not emptied on Tuesday",
          askedAt: munich("2026-09-24 16:10").toISOString(),
        },
      ],
      suggestedReplies: [],
      recipientName: "Markus Albrecht",
      expiresAt: munich("2026-09-24 18:10"),
      answer: null,
      replyMode: null,
      answeredAt: null,
      takenOverAt: null,
      handedBackAt: null,
      expiredAt: munich("2026-09-24 18:10"),
      createdAt: munich("2026-09-24 16:10"),
    },
  ],
  // Lead Qualifier table (brief.md §3), the inbound Isar Data lead (Live feed
  // 11:05) and last week's delivered leads (weekly report 14-20 Sep).
  leads: [
    lead("brandt", "Julia Weber", "Brandt Logistik GmbH", 91, "delivered", ["New office in Garching", "Munich · 180 employees"], munich("2026-09-24 09:30"), munich("2026-09-22 08:10")),
    lead("vierling", "Vierling Software", "Vierling Software", 88, "delivered", ["Munich · 220 employees"], munich("2026-09-24 09:30"), munich("2026-09-22 08:10")),
    lead("kessler", "Kessler Architekten", "Kessler Architekten", 84, "qualified", ["Augsburg · 45 employees"], null, munich("2026-09-23 08:10")),
    lead("nordlicht", "Nordlicht Media", "Nordlicht Media", 78, "qualified", ["Munich · 60 employees"], null, munich("2026-09-23 08:10")),
    lead("huber", "Huber & Söhne Steuerberatung", "Huber & Söhne Steuerberatung", 74, "qualified", ["Munich · 32 employees"], null, munich("2026-09-24 08:10")),
    lead("alphalog", "AlphaLog", "AlphaLog", 58, "borderline", ["Office under 20 employees", "Augsburg · 15 employees"], null, munich("2026-09-24 08:10")),
    lead("seidl", "Seidl Consulting", "Seidl Consulting", 86, "delivered", ["Munich · 40 employees"], munich("2026-09-14 15:00"), munich("2026-09-10 08:10")),
    lead("pfeiffer", "Pfeiffer Medien", "Pfeiffer Medien", 83, "delivered", ["Augsburg · 75 employees"], munich("2026-09-15 15:00"), munich("2026-09-10 08:10")),
    lead("lechwerk", "Lechwerk Engineering", "Lechwerk Engineering", 81, "delivered", ["Augsburg · 130 employees"], munich("2026-09-15 15:00"), munich("2026-09-11 08:10")),
    lead("moosach", "Moosach Robotics", "Moosach Robotics", 79, "delivered", ["Munich · 210 employees"], munich("2026-09-17 15:00"), munich("2026-09-11 08:10")),
    lead("tegernsee", "Tegernsee Treuhand", "Tegernsee Treuhand", 72, "delivered", ["Munich · 28 employees"], munich("2026-09-18 15:00"), munich("2026-09-12 08:10")),
    {
      id: "fx-lead-isar-data",
      companyId: C,
      name: "Lukas Brenner",
      company: "Isar Data GmbH",
      domain: "isar-data.example",
      phone: null,
      source: "widget",
      fitScore: 84,
      status: "qualified",
      reasons: ["Inbound from the website widget"],
      rejectReason: null,
      intake: {
        name: "Lukas Brenner",
        company: "Isar Data GmbH",
        need: "Weekend office cleaning, 1,200 m², twice a week",
        timeline: "From Mon 5 Oct",
      },
      intakeComplete: true,
      chatId: ID.lukasChat,
      firstDeliveredAt: null,
      createdAt: munich("2026-09-25 10:58"),
    },
  ],
  leadEvents: [
    { id: "fx-le-brandt-1", companyId: C, recordId: "fx-lead-brandt", fromStatus: null, toStatus: "gathered", agentId: ID.gatherer, userId: null, at: munich("2026-09-22 08:10") },
    { id: "fx-le-brandt-2", companyId: C, recordId: "fx-lead-brandt", fromStatus: "gathered", toStatus: "qualified", agentId: ID.qualifier, userId: null, at: munich("2026-09-22 09:00") },
    { id: "fx-le-brandt-3", companyId: C, recordId: "fx-lead-brandt", fromStatus: "qualified", toStatus: "delivered", agentId: ID.qualifier, userId: null, at: munich("2026-09-24 09:30") },
    { id: "fx-le-vierling-1", companyId: C, recordId: "fx-lead-vierling", fromStatus: "qualified", toStatus: "delivered", agentId: ID.qualifier, userId: null, at: munich("2026-09-24 09:30") },
    { id: "fx-le-alphalog-1", companyId: C, recordId: "fx-lead-alphalog", fromStatus: "gathered", toStatus: "borderline", agentId: ID.qualifier, userId: null, at: munich("2026-09-24 09:00") },
    { id: "fx-le-huber-1", companyId: C, recordId: "fx-lead-huber", fromStatus: "borderline", toStatus: "qualified", agentId: null, userId: ID.owner, at: munich("2026-09-24 14:20") },
    { id: "fx-le-isar-1", companyId: C, recordId: "fx-lead-isar-data", fromStatus: null, toStatus: "gathered", agentId: ID.websiteAssistant, userId: null, at: munich("2026-09-25 10:58") },
    { id: "fx-le-isar-2", companyId: C, recordId: "fx-lead-isar-data", fromStatus: "gathered", toStatus: "qualified", agentId: ID.qualifier, userId: null, at: munich("2026-09-25 11:05") },
  ],
  // Closed periods (client-view.md §2, 39-facts.md §1). Archive rows the
  // frames show without figures carry no metrics.
  reportSnapshots: [
    report("fx-report-d0924", "daily", "2026-09-24", "2026-09-25", "2026-09-25 08:00", [
      { metricKey: "conversations.started", value: 19, previous: null },
      { metricKey: "leads.inbound", value: 4, previous: null },
      { metricKey: "leads.qualified_delivered", value: 2, previous: null },
      { metricKey: "handoff.staff_answers", value: 3, previous: null },
    ]),
    report("fx-report-d0923", "daily", "2026-09-23", "2026-09-24", "2026-09-24 08:00", []),
    report("fx-report-d0922", "daily", "2026-09-22", "2026-09-23", "2026-09-23 08:00", []),
    report(
      "fx-report-w0914",
      "weekly",
      "2026-09-14",
      "2026-09-21",
      "2026-09-21 08:00",
      [
        { metricKey: "leads.qualified_delivered", value: 8, previous: null },
        { metricKey: "leads.quality_score", value: 80, previous: null },
        { metricKey: "leads.inbound", value: 8, previous: null },
        { metricKey: "conversations.started", value: 27, previous: null },
        { metricKey: "handoff.staff_answers", value: 4, previous: null },
      ],
      {
        delivered: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
          (label, i) => ({ label, value: [1, 2, 1, 2, 1, 1, 0][i] }),
        ),
        funnel: [
          { stage: "gathered", value: 131 },
          { stage: "qualified", value: 39 },
          { stage: "contacted", value: 28 },
          { stage: "delivered", value: 8 },
        ],
      },
    ),
    report("fx-report-w0907", "weekly", "2026-09-07", "2026-09-14", "2026-09-14 08:00", []),
    report(
      "fx-report-m2608",
      "monthly",
      "2026-08-01",
      "2026-09-01",
      "2026-09-01 08:00",
      [
        { metricKey: "leads.qualified_delivered", value: 31, previous: 23 },
        { metricKey: "leads.quality_score", value: 79, previous: null },
        { metricKey: "conversations.started", value: 96, previous: null },
        { metricKey: "handoff.staff_answers", value: 14, previous: null },
      ],
      {
        delivered: [
          { label: "W32", value: 6 },
          { label: "W33", value: 7 },
          { label: "W34", value: 9 },
          { label: "W35", value: 9 },
        ],
        funnel: [],
      },
    ),
  ],
  // Live feed, newest first in the frame (11b `live/default`).
  portalEvents: [
    { id: "fx-pe-1146", companyId: C, type: "handoff_sent", at: munich("2026-09-25 11:46"), title: "Handoff sent to Markus Albrecht", detail: "Weekend cleaning quote · Lukas Brenner", channel: "widget", refId: ID.lukasHandoff },
    { id: "fx-pe-1131", companyId: C, type: "site_visit_booked", at: munich("2026-09-25 11:31"), title: "Site visit booked: Thu 1 Oct, 10:00", detail: "Booked by the agent on WhatsApp", channel: "whatsapp", refId: null },
    { id: "fx-pe-1105", companyId: C, type: "lead_inbound_qualified", at: munich("2026-09-25 11:05"), title: "Inbound lead qualified: Isar Data GmbH", detail: "Score 84 · from the website widget", channel: "widget", refId: "fx-lead-isar-data" },
    { id: "fx-pe-1052", companyId: C, type: "review_new", at: munich("2026-09-25 10:52"), title: "New Google review 5★ from Lena K.", detail: "Google review", channel: null, refId: null },
    { id: "fx-pe-1020", companyId: C, type: "conversation_started", at: munich("2026-09-25 10:20"), title: "Instagram question answered", detail: "Answered by the agent · no staff needed", channel: "instagram", refId: null },
    { id: "fx-pe-0958", companyId: C, type: "conversation_started", at: munich("2026-09-25 09:58"), title: "Messenger invoice question answered", detail: "Answered by the agent · no staff needed", channel: null, refId: null },
  ],
  homeTiles: [
    {
      companyId: C,
      tiles: [
        { key: "goal_strip", visible: true, order: 0, visibility: { kind: "owners_only" } },
        { key: "needs_you", visible: true, order: 1, visibility: { kind: "requires", permission: "operator" } },
        { key: "today", visible: true, order: 2, visibility: { kind: "everyone" } },
        { key: "lead_engine", visible: true, order: 3, visibility: { kind: "requires", permission: "operator" } },
        { key: "agent_map", visible: true, order: 4, visibility: { kind: "everyone" } },
      ],
    },
  ],
};

function lead(
  slug: string,
  name: string,
  company: string,
  fitScore: number,
  status: FixtureData["leads"][number]["status"],
  reasons: string[],
  firstDeliveredAt: Date | null,
  createdAt: Date,
): FixtureData["leads"][number] {
  return {
    id: `fx-lead-${slug}`,
    companyId: C,
    name,
    company,
    domain: `${slug}.example`,
    phone: null,
    source: "outbound",
    fitScore,
    status,
    reasons,
    rejectReason: null,
    intake: {},
    intakeComplete: true,
    chatId: null,
    firstDeliveredAt,
    createdAt,
  };
}

function report(
  id: string,
  period: FixtureData["reportSnapshots"][number]["period"],
  startDay: string,
  endDay: string,
  frozenAt: string,
  metrics: FixtureData["reportSnapshots"][number]["metrics"],
  series: FixtureData["reportSnapshots"][number]["series"] = {
    delivered: [],
    funnel: [],
  },
): FixtureData["reportSnapshots"][number] {
  return {
    id,
    companyId: C,
    period,
    start: munich(`${startDay} 00:00`),
    end: munich(`${endDay} 00:00`),
    metrics,
    series,
    narrative: null,
    frozenAt: munich(frozenAt),
  };
}
