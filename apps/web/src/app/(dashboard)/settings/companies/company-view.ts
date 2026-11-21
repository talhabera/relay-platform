/**
 * Pure view helpers for Settings › Companies (Figma 08c `companies`, `companies-delete`,
 * `companies-delete-typed`). No I/O: the page and the delete action share them.
 */

export type CompanyAgentCounts = { customer: number; operator: number };

/** "2 customer · 5 operator agents" (Figma meta column). */
export function agentCountsLabel({ customer, operator }: CompanyAgentCounts): string {
  return `${customer} customer · ${operator} operator agent${operator === 1 ? "" : "s"}`;
}

/** Second line of a Company row: the description, else the industry. */
export function companyRowDescription(company: {
  description: string | null;
  industry: string | null;
}): string | undefined {
  return company.description?.trim() || company.industry?.trim() || undefined;
}

export type CompanyRowRole = "Owner" | "Member";

export type CompanyListItem = {
  id: string;
  name: string;
  description?: string;
  role: CompanyRowRole;
  current: boolean;
  meta: string;
};

/** What a delete takes with it; drives the impact list and whether the name must be typed. */
export type CompanyDeleteImpact = {
  customerAgents: number;
  operatorAgents: number;
  conversations: number;
  schedules: number;
  /** Display names of installed packages. */
  packages: string[];
  members: number;
};

export type DeleteImpactKey = "agents" | "conversations" | "schedules" | "packages" | "members";

export type DeleteImpactLine = { key: DeleteImpactKey; text: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The "Everything in X is deleted with it" list. Empty when the company holds nothing. */
export function deleteImpactLines(impact: CompanyDeleteImpact): DeleteImpactLine[] {
  const lines: DeleteImpactLine[] = [];
  const agents = impact.customerAgents + impact.operatorAgents;
  if (agents > 0) {
    lines.push({
      key: "agents",
      text: `${plural(agents, "agent")}: ${impact.customerAgents} customer, ${impact.operatorAgents} operator`,
    });
  }
  if (impact.conversations > 0) lines.push({ key: "conversations", text: "All conversations" });
  if (impact.schedules > 0) lines.push({ key: "schedules", text: "All schedules and run history" });
  if (impact.packages.length > 0) {
    lines.push({ key: "packages", text: `Installed packages, including ${impact.packages[0]}` });
  }
  if (impact.members > 0) {
    lines.push({ key: "members", text: impact.members === 1 ? "1 member loses access" : `${impact.members} members lose access` });
  }
  return lines;
}

/** `companies-delete-typed`: a company that holds anything needs its name typed to delete. */
export function needsTypedConfirm(impact: CompanyDeleteImpact): boolean {
  return deleteImpactLines(impact).length > 0;
}

export function typedNameMatches(input: string, name: string): boolean {
  return input.trim() === name.trim();
}

/** Tooltip on the disabled "Delete company" item of the current company. */
export function currentCompanyDeleteHint(name: string): string {
  return `Switch to another company to delete ${name}`;
}
