export function getPendingAction(output: unknown): ParsedPendingAction | null {
  const record = asRecord(output);
  if (!record) return null;
  if (record.kind !== "action") return null;
  if (record.status !== "pending_approval") return null;
  if (record.actionType !== "outreach") return null;

  const pendingId = stringField(record, "pendingId");
  const toolName = stringField(record, "toolName");
  const channel = stringField(record, "channel");
  const recipient = stringField(record, "recipient");
  const body = stringField(record, "body");
  const reason = stringField(record, "reason");
  const recordName = stringField(record, "recordName");
  const message = stringField(record, "message");
  if (
    !pendingId ||
    !toolName ||
    !channel ||
    !recipient ||
    !body ||
    !reason ||
    !recordName ||
    !message
  ) {
    return null;
  }

  const subject = stringField(record, "subject");
  return {
    kind: "action",
    pendingId,
    actionType: "outreach",
    toolName,
    channel,
    recipient,
    ...(subject ? { subject } : {}),
    body,
    reason,
    recordName,
    message,
  };
}

export type ParsedPendingAction = {
  kind: "action";
  pendingId: string;
  actionType: "outreach";
  toolName: string;
  channel: string;
  recipient: string;
  subject?: string;
  body: string;
  reason: string;
  recordName: string;
  message: string;
};

function asRecord(output: unknown): Record<string, unknown> | null {
  if (!output || typeof output !== "object") return null;
  return output as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}
