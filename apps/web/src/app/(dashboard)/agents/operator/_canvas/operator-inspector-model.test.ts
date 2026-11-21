import { describe, expect, it } from "vitest";

import {
  buildAccessModel,
  buildScheduleTab,
  instructionDiff,
  nextVersionName,
  promoteImpact,
  type AccessInput,
} from "./operator-inspector-model";

describe("nextVersionName", () => {
  it("is one past the highest vN name", () => {
    expect(nextVersionName(["v1", "v2"])).toBe("v3");
    expect(nextVersionName(["v1", "v2.1-beta", "v7"])).toBe("v8");
  });
  it("starts at v2 when no name is numbered", () => {
    expect(nextVersionName([])).toBe("v2");
    expect(nextVersionName(["initial"])).toBe("v2");
  });
});

const people = {
  owner: { id: "owner", name: "Talha Bera", email: "talha@acme.test" },
  deniz: { id: "deniz", name: "Deniz Aksoy", email: "deniz@acme.test" },
  mert: { id: "mert", name: "Mert Kaya", email: "mert@acme.test" },
  ayse: { id: "ayse", name: null, email: "ayse@acme.test" },
  client: { id: "client", name: "Client User", email: "c@client.test" },
};

const base: AccessInput = {
  viewerId: "owner",
  ownerId: "owner",
  creatorId: "owner",
  viewerCanEdit: true,
  agentUsers: [
    { user: people.deniz, canEdit: true, canApprove: true },
    { user: people.mert, canEdit: false, canApprove: true },
  ],
  members: [
    { user: people.owner, role: "member", operator: true },
    { user: people.deniz, role: "member", operator: true },
    { user: people.mert, role: "member", operator: true },
    { user: people.ayse, role: "member", operator: true },
    { user: people.client, role: "client", operator: true },
  ],
  people: [people.owner],
};

describe("buildAccessModel", () => {
  it("owner view (Figma access): creator row locked, member rows toggleable", () => {
    const model = buildAccessModel(base);
    expect(model.rows.map((r) => [r.name, r.subtitle])).toEqual([
      ["Talha Bera", "Owner · agent creator"],
      ["Deniz Aksoy", "Member · Operator access"],
      ["Mert Kaya", "Member · Operator access"],
    ]);
    const [creator, deniz, mert] = model.rows;
    expect(creator).toMatchObject({ locked: true, initials: "TB" });
    expect(creator.edit).toEqual({ on: true, disabled: true });
    expect(creator.approve).toEqual({ on: true, disabled: true });
    expect(deniz.edit).toEqual({ on: true, disabled: false });
    expect(deniz.approve).toEqual({ on: true, disabled: false });
    expect(mert.edit).toEqual({ on: false, disabled: false });
    expect(model.canChangeApprove).toBe(true);
  });

  it("member view (Figma access-member): Approve is owner-only", () => {
    const model = buildAccessModel({ ...base, viewerId: "deniz" });
    expect(model.canChangeApprove).toBe(false);
    expect(model.rows.every((r) => r.approve.disabled)).toBe(true);
    expect(model.rows[1].edit.disabled).toBe(false);
  });

  it("read-only viewers get every toggle disabled and no Add person", () => {
    const model = buildAccessModel({ ...base, viewerId: "ayse", viewerCanEdit: false });
    expect(model.rows.every((r) => r.edit.disabled && r.approve.disabled)).toBe(true);
    expect(model.canAdd).toBe(false);
  });

  it("company owner who is not the creator always approves; edit follows the row", () => {
    const model = buildAccessModel({
      ...base,
      creatorId: "deniz",
      agentUsers: [{ user: people.mert, canEdit: true, canApprove: false }],
      people: [people.owner, people.deniz],
    });
    expect(model.rows.map((r) => [r.userId, r.subtitle])).toEqual([
      ["deniz", "Agent creator"],
      ["owner", "Owner"],
      ["mert", "Member · Operator access"],
    ]);
    const owner = model.rows[1];
    expect(owner.locked).toBe(false);
    expect(owner.approve).toEqual({ on: true, disabled: true });
    expect(owner.edit).toEqual({ on: false, disabled: false });
  });

  it("Add person lists operator members without a row, never clients", () => {
    const model = buildAccessModel(base);
    expect(model.candidates.map((c) => c.id)).toEqual(["ayse"]);
    expect(model.candidates[0].label).toBe("ayse@acme.test");
    expect(model.canAdd).toBe(true);
  });
});

describe("buildScheduleTab", () => {
  const jobs = [
    {
      id: "j1",
      name: "Qualify gathered leads",
      scheduleKind: "daily" as const,
      intervalMinutes: null,
      weekday: null,
      timeOfDay: 420,
      timezone: "UTC",
      enabled: true,
      nextFireAt: new Date("2026-09-28T07:00:00Z"),
      versionName: "v1",
      latestStatus: "succeeded" as const,
    },
    {
      id: "j2",
      name: "Weekly borderline review",
      scheduleKind: "weekly" as const,
      intervalMinutes: null,
      weekday: 5,
      timeOfDay: 960,
      timezone: "UTC",
      enabled: true,
      nextFireAt: new Date("2026-10-02T16:00:00Z"),
      versionName: "v1",
      latestStatus: "awaiting_input" as const,
    },
    {
      id: "j3",
      name: "Inbound lead check",
      scheduleKind: "interval" as const,
      intervalMinutes: 120,
      weekday: null,
      timeOfDay: null,
      timezone: "UTC",
      enabled: false,
      nextFireAt: new Date("2026-09-27T06:00:00Z"),
      versionName: "v2",
      latestStatus: null,
    },
  ];

  it("rows carry cadence, version, a status chip and a deep link", () => {
    const tab = buildScheduleTab(jobs);
    expect(tab.rows.map((r) => [r.name, r.detail, r.tone, r.label])).toEqual([
      ["Qualify gathered leads", "Daily · 07:00 · v1", "success", "Succeeded"],
      ["Weekly borderline review", "Fridays · 16:00 · v1", "needs-you", "Needs you"],
      ["Inbound lead check", "Every 2 h · v2", "neutral", "Paused"],
    ]);
    expect(tab.rows[0].href).toBe("/operator?tab=cron&jobId=j1");
  });

  it("next run is the earliest enabled job", () => {
    expect(buildScheduleTab(jobs).nextRun).toBe("Mon 28 Sep, 07:00 UTC · Qualify gathered leads");
    expect(buildScheduleTab([]).nextRun).toBeNull();
  });
});

describe("instructionDiff", () => {
  it("lists removed then added lines, skipping unchanged ones", () => {
    expect(
      instructionDiff("Keep Munich.\nMark offices under 20 as borderline.", "Keep Munich.\nReject offices under 20."),
    ).toEqual([
      { kind: "removed", text: "Mark offices under 20 as borderline." },
      { kind: "added", text: "Reject offices under 20." },
    ]);
  });
  it("is empty when instructions match, ignoring blank lines", () => {
    expect(instructionDiff("A\n\nB", "A\nB")).toEqual([]);
    expect(instructionDiff(null, null)).toEqual([]);
  });
});

describe("promoteImpact", () => {
  // Schedules pin a version (cron_jobs.version_id); promoting does not move them.
  it("says which schedules stay pinned and that the old version is kept", () => {
    expect(promoteImpact({ from: "v1", to: "v2", pinnedSchedules: 3 })).toEqual([
      "New sessions start on v2.",
      "3 schedules stay on v1 until you switch them in Schedules.",
      "Running sessions stay on v1 until they finish.",
      "v1 is kept. You can roll back from Versions at any time.",
    ]);
    expect(promoteImpact({ from: "v1", to: "v2", pinnedSchedules: 1 })[1]).toBe(
      "1 schedule stays on v1 until you switch it in Schedules.",
    );
    expect(promoteImpact({ from: "v1", to: "v2", pinnedSchedules: 0 })).toHaveLength(3);
  });
});
