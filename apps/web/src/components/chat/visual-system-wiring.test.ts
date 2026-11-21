import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const chatDir = dirname(fileURLToPath(import.meta.url));
const operatorChat = readFileSync(
  join(chatDir, "../operator/operator-chat.tsx"),
  "utf8",
);

describe("operator chat wrapper", () => {
  it("uses the v2 session layout instead of bubble bubbles", () => {
    expect(operatorChat).toContain("SessionHeader");
    expect(operatorChat).toContain("OperatorChatConversation");
    expect(operatorChat).not.toContain("bg-primary text-primary-foreground");
    expect(operatorChat).not.toContain('Download {filename ?? "Excel file"}');
    expect(operatorChat).toContain("isChatBusy");
  });
});

describe("chat primitives completeness", () => {
  it("covers the file cards and keeps file inputs out of the composer", () => {
    const composer = readFileSync(join(chatDir, "../v2/session/chat-composer.tsx"), "utf8");
    const fileCard = readFileSync(join(chatDir, "file-output-card.tsx"), "utf8");
    expect(composer).not.toContain('type="file"');
    expect(fileCard).toContain("Unavailable");
    expect(fileCard).toContain("CHAT_OUTPUT_CARD_CLASS");
  });
});
