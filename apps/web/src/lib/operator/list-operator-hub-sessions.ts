export type HubSessionRow = {
  id: string;
  channelType: string | null;
};

export function isOperatorHubSession(chat: { channelType: string | null }): boolean {
  return chat.channelType === "operator";
}

export function filterOperatorHubSessions<T extends HubSessionRow>(rows: T[]): T[] {
  return rows.filter(isOperatorHubSession);
}
