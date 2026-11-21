import { describe, expect, it } from "vitest";

import {
  agentCountsLabel,
  companyRowDescription,
  deleteImpactLines,
  needsTypedConfirm,
  typedNameMatches,
  type CompanyDeleteImpact,
} from "./company-view";

const empty: CompanyDeleteImpact = {
  customerAgents: 0,
  operatorAgents: 0,
  conversations: 0,
  schedules: 0,
  packages: [],
  members: 0,
};

describe("company view helpers (Figma 08c companies)", () => {
  it("labels agent counts like the Figma meta column", () => {
    expect(agentCountsLabel({ customer: 2, operator: 5 })).toBe("2 customer · 5 operator agents");
    expect(agentCountsLabel({ customer: 3, operator: 1 })).toBe("3 customer · 1 operator agent");
  });

  it("uses the description, else the industry", () => {
    expect(companyRowDescription({ description: "Dental practice group", industry: "Healthcare" })).toBe(
      "Dental practice group",
    );
    expect(companyRowDescription({ description: " ", industry: "Healthcare" })).toBe("Healthcare");
    expect(companyRowDescription({ description: null, industry: null })).toBeUndefined();
  });

  it("lists what a delete takes with it (companies-delete-typed)", () => {
    const lines = deleteImpactLines({
      customerAgents: 1,
      operatorAgents: 2,
      conversations: 40,
      schedules: 3,
      packages: ["Lead engine"],
      members: 1,
    });
    expect(lines.map((l) => l.text)).toEqual([
      "3 agents: 1 customer, 2 operator",
      "All conversations",
      "All schedules and run history",
      "Installed packages, including Lead engine",
      "1 member loses access",
    ]);
  });

  it("asks for the typed name only when the company holds something", () => {
    expect(deleteImpactLines(empty)).toEqual([]);
    expect(needsTypedConfirm(empty)).toBe(false);
    expect(needsTypedConfirm({ ...empty, conversations: 1 })).toBe(true);
  });

  it("matches the typed name exactly, ignoring outer whitespace", () => {
    expect(typedNameMatches(" Brightline Dental ", "Brightline Dental")).toBe(true);
    expect(typedNameMatches("brightline dental", "Brightline Dental")).toBe(false);
  });
});
