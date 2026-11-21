export function isChatBusy(status: string): boolean {
  return status === "streaming" || status === "submitted";
}
