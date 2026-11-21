import type { PagePermissionKey } from "@/db/schema";

export const PAGE_PERMISSION_CATALOG: {
  key: PagePermissionKey;
  label: string;
  description: string;
}[] = [
  {
    key: "operator",
    label: "Operator",
    description: "Operator workbench, versions, and cron",
  },
  {
    key: "agents",
    label: "Customer agents",
    description: "View customer agents for this company",
  },
  {
    key: "messaging",
    label: "Inbox",
    description: "View customer messaging conversations",
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "View company analytics",
  },
];

export function pagePermissionLabel(page: PagePermissionKey): string {
  switch (page) {
    case "operator":
      return "Operator";
    case "agents":
      return "Customer agents";
    case "messaging":
      return "Inbox";
    case "analytics":
      return "Analytics";
    default: {
      const _exhaustive: never = page;
      throw new Error(`Unhandled page permission: ${_exhaustive}`);
    }
  }
}
