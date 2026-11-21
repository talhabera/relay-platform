import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

describe("chat primitives", () => {
  it("creates the shared chat UI modules", () => {
    for (const file of [
      "tool-call-tree.tsx",
      "file-output-card.tsx",
      "chat-transcript.tsx",
      "format-markdown.ts",
    ]) {
      expect(existsSync(join(dir, file))).toBe(true);
    }
  });
});
