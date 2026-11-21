import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");

function webPackage(): {
  scripts: { build: string };
  dependencies: Record<string, string>;
} {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8"),
  );
}

describe("web production build", () => {
  it("uses webpack so Docker next build is not killed by Turbopack OOM", () => {
    expect(webPackage().scripts.build).toContain("--webpack");
  });

  it("declares @next/env so Docker pnpm can load next.config.ts", () => {
    const config = readFileSync(
      path.join(repoRoot, "apps/web/next.config.ts"),
      "utf8",
    );
    if (!config.includes("@next/env")) return;
    expect(webPackage().dependencies["@next/env"]).toBeTruthy();
  });
});
