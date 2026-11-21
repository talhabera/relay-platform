import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compose = readFileSync(
  path.join(import.meta.dirname, "../docker-compose.yml"),
  "utf8",
);

describe("docker-compose Coolify network", () => {
  it("puts every service on the external coolify network only", () => {
    expect(compose.match(/networks: \[coolify\]/g)).toHaveLength(4);
    expect(compose).toMatch(/coolify:\s*\n\s+external:\s*true/);
  });
});
