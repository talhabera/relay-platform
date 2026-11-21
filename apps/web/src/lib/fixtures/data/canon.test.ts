// Snapshot of the Figma copy the fixture dataset renders. A failing snapshot
// means the dataset no longer matches the frames: fix the data, or update the
// snapshot only together with the Figma copy it mirrors.

import { describe, expect, it } from "vitest";
import { createFixtureReaders } from "../loaders";
import {
  FIXTURE_IDS as ID,
  FIXTURE_NOW,
  fixtureData,
  LUKAS_HANDOFF,
  lukasHandoffAs,
} from "./index";

const readers = createFixtureReaders(fixtureData);

const munichClock = (d: Date) =>
  d.toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "numeric",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "6h" / "38m", the age label the Needs you rows use. */
const age = (d: Date) => {
  const minutes = Math.round((FIXTURE_NOW.getTime() - d.getTime()) / 60_000);
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
};

describe("canonical fixture data", () => {
  it("is drawn at Fri 25 Sep 2026, 11:52 Munich time", () => {
    expect(munichClock(FIXTURE_NOW)).toMatchInlineSnapshot(`"Fri 25/09, 11:52"`);
  });

  it("Needs you: the canonical snapshot in impact order", async () => {
    const { items, total } = await readers.needsYou.getNeedsYou(
      ID.company,
      ID.owner,
    );
    expect(total).toBe(5);
    expect(
      items.map((i) => `${i.tier} · ${i.agentName} · ${i.title} · ${age(i.createdAt)}`),
    ).toMatchInlineSnapshot(`
      [
        "1 · Lead Gatherer · Google Places quota reached · 6h",
        "2 · Lead Qualifier · Include offices under 20 employees? · 38m",
        "2 · Mail Marketer · Schedule sequence to 44 leads · 12m",
        "3 · Social Media Manager · Schedule 3 reviewed posts · 2h",
        "3 · Social Media Manager · Post 5 replies · 1h",
      ]
    `);
  });

  it("Lead engine: this week's funnel, inbound and target", async () => {
    const [lead] = await readers.workflows.listWorkflows(ID.company);
    expect({
      stages: lead.stages.map(
        (s) => `${s.name} · ${s.agent?.name ?? "No agent"} · ${s.metricValue} · ${s.state}`,
      ),
      inbound: lead.inbound && {
        leads: lead.inbound.leads,
        conversations: lead.inbound.conversations,
        customerAgents: lead.inbound.customerAgents.map((a) => a.name),
      },
      target: lead.target,
    }).toMatchInlineSnapshot(`
      {
        "inbound": {
          "conversations": 22,
          "customerAgents": [
            "Acme Website Assistant",
            "Acme Instagram Concierge",
          ],
          "leads": 9,
        },
        "stages": [
          "Gather · Lead Gatherer · 146 · needs_you",
          "Qualify · Lead Qualifier · 44 · needs_you",
          "Outreach · Mail Marketer · 31 · needs_you",
          "Delivered to client · No agent · 6 · default",
        ],
        "target": {
          "metricKey": "leads.qualified_delivered",
          "value": 6,
          "weeklyTarget": 10,
        },
      }
    `);
  });

  it("Lukas handoff: open in the dataset, every state on demand", async () => {
    const open = await readers.handoff.listHandoffRequests(ID.company, {
      status: ["open"],
    });
    expect(open).toEqual([lukasHandoffAs("open")]);
    const [lukas] = open;
    expect({
      customer: lukas.customerName,
      agent: lukas.agentName,
      channel: lukas.channel,
      recipient: lukas.recipientName,
      question: lukas.questions[0].text,
      suggestedReplies: lukas.suggestedReplies,
      sent: munichClock(lukas.createdAt),
      expires: munichClock(lukas.expiresAt),
      link: LUKAS_HANDOFF.link,
    }).toMatchInlineSnapshot(`
      {
        "agent": "Acme Website Assistant",
        "channel": "widget",
        "customer": "Lukas Brenner",
        "expires": "Fri 25/09, 13:46",
        "link": "go.relay.chat/h/7KQ2MX",
        "question": "Can we offer weekend cleaning for 1,200 m², twice a week, from Mon 5 Oct?",
        "recipient": "Markus Albrecht",
        "sent": "Fri 25/09, 11:46",
        "suggestedReplies": [
          "Yes, send the weekend rate and offer a site visit",
          "Ask for their floor plan first",
          "I'll call them today",
        ],
      }
    `);

    const answered = lukasHandoffAs("answered");
    expect(answered.answer).toBe(LUKAS_HANDOFF.answer);
    expect(munichClock(answered.answeredAt!)).toMatchInlineSnapshot(`"Fri 25/09, 11:49"`);
    expect(lukasHandoffAs("expired").expiredAt).toEqual(LUKAS_HANDOFF.expiresAt);
    expect(lukasHandoffAs("handed_back").handedBackAt).not.toBeNull();
  });

  it("Inbox: Tobias Lang is the one expired request", async () => {
    const expired = await readers.handoff.listHandoffRequests(ID.company, {
      status: ["expired"],
    });
    expect(
      expired.map((r) => `${r.customerName} · ${r.questions[0].text} · ${munichClock(r.expiredAt!)}`),
    ).toMatchInlineSnapshot(`
      [
        "Tobias Lang · Bins were not emptied on Tuesday · Thu 24/09, 18:10",
      ]
    `);
  });

  it("Leads: Lead Qualifier table and the borderline filter", async () => {
    const leads = await readers.leads.listLeads(ID.company);
    expect(
      leads
        .filter((l) => l.firstDeliveredAt === null || l.firstDeliveredAt >= new Date("2026-09-21"))
        .map((l) => `${l.company} · ${l.fitScore} · ${l.band} · ${l.source}`),
    ).toMatchInlineSnapshot(`
      [
        "Isar Data GmbH · 84 · qualified · widget",
        "Huber & Söhne Steuerberatung · 74 · qualified · outbound",
        "AlphaLog · 58 · borderline · outbound",
        "Kessler Architekten · 84 · qualified · outbound",
        "Nordlicht Media · 78 · qualified · outbound",
        "Brandt Logistik GmbH · 91 · qualified · outbound",
        "Vierling Software · 88 · qualified · outbound",
      ]
    `);
    const borderline = await readers.leads.listLeads(ID.company, {
      band: "borderline",
    });
    expect(borderline.map((l) => l.company)).toEqual(["AlphaLog"]);
  });

  it("Reports: archive rows and the weekly 14-20 Sep figures", async () => {
    const rows = [];
    for (const period of ["daily", "weekly", "monthly"] as const) {
      for (const s of await readers.reports.listReportSnapshots(ID.company, period)) {
        rows.push(`${period} · ${munichClock(s.start)} · ${s.metrics.length} metrics`);
      }
    }
    expect(rows).toMatchInlineSnapshot(`
      [
        "daily · Thu 24/09, 00:00 · 4 metrics",
        "daily · Wed 23/09, 00:00 · 0 metrics",
        "daily · Tue 22/09, 00:00 · 0 metrics",
        "weekly · Mon 14/09, 00:00 · 5 metrics",
        "weekly · Mon 07/09, 00:00 · 0 metrics",
        "monthly · Sat 01/08, 00:00 · 4 metrics",
      ]
    `);
    const weekly = await readers.reports.getReportSnapshot(ID.company, "fx-report-w0914");
    expect({
      metrics: weekly?.metrics.map((m) => `${m.metricKey} ${m.value}`),
      delivered: weekly?.series.delivered.map((p) => p.value).join(","),
      funnel: weekly?.series.funnel.map((f) => `${f.stage} ${f.value}`),
    }).toMatchInlineSnapshot(`
      {
        "delivered": "1,2,1,2,1,1,0",
        "funnel": [
          "gathered 131",
          "qualified 39",
          "contacted 28",
          "delivered 8",
        ],
        "metrics": [
          "leads.qualified_delivered 8",
          "leads.quality_score 80",
          "leads.inbound 8",
          "conversations.started 27",
          "handoff.staff_answers 4",
        ],
      }
    `);
  });

  it("Live feed: six rows, newest first", async () => {
    const feed = await readers.portalEvents.listPortalEvents(ID.company);
    expect(
      feed.map((e) => `${munichClock(e.at).slice(-5)} · ${e.title} · ${e.detail}`),
    ).toMatchInlineSnapshot(`
      [
        "11:46 · Handoff sent to Markus Albrecht · Weekend cleaning quote · Lukas Brenner",
        "11:31 · Site visit booked: Thu 1 Oct, 10:00 · Booked by the agent on WhatsApp",
        "11:05 · Inbound lead qualified: Isar Data GmbH · Score 84 · from the website widget",
        "10:52 · New Google review 5★ from Lena K. · Google review",
        "10:20 · Instagram question answered · Answered by the agent · no staff needed",
        "09:58 · Messenger invoice question answered · Answered by the agent · no staff needed",
      ]
    `);
  });

  it("People: agency owner, member and client by canon name", async () => {
    expect(fixtureData.users.map((u) => u.name)).toMatchInlineSnapshot(`
      [
        "Talha Bera",
        "Deniz Aksoy",
        "Selin Kaya",
        "Markus Albrecht",
      ]
    `);
    expect(await readers.access.getAccessRole(ID.company, ID.client)).toBe("client");
    expect(
      (await readers.access.listApprovers(ID.mailer)).map((a) => a.name),
    ).toMatchInlineSnapshot(`
      [
        "Talha Bera",
        "Deniz Aksoy",
      ]
    `);
  });
});
