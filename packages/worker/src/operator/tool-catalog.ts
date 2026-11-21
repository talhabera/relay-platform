export type OperatorToolStatus = "live" | "coming_soon";

export type OperatorToolId =
  | "webSearch"
  | "excel"
  | "companyMemory"
  | "proposeAction"
  | "whatsappNotification";

export const OPERATOR_TOOL_CATALOG: {
  id: OperatorToolId;
  label: string;
  status: OperatorToolStatus;
}[] = [
  { id: "webSearch", label: "Web search", status: "live" },
  { id: "excel", label: "Excel", status: "live" },
  { id: "companyMemory", label: "Company memory", status: "live" },
  { id: "proposeAction", label: "Propose action", status: "live" },
  {
    id: "whatsappNotification",
    label: "WhatsApp notification",
    status: "coming_soon",
  },
];

export function isLiveOperatorTool(id: string): boolean {
  return OPERATOR_TOOL_CATALOG.some(
    (tool) => tool.id === id && tool.status === "live",
  );
}
