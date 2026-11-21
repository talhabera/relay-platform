import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvFileIfExists } from "./load-root-env";

const KEY = "RELAY_TEST_ROOT_ENV";

describe("loadEnvFileIfExists", () => {
  let dir = "";

  afterEach(() => {
    delete process.env[KEY];
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("is a no-op when the file is missing", () => {
    expect(loadEnvFileIfExists("/no/such/relay.env")).toBe(false);
  });

  it("loads unset keys from a dotenv file", () => {
    dir = mkdtempSync(join(tmpdir(), "relay-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, `${KEY}=from-file\n`);
    delete process.env[KEY];

    expect(loadEnvFileIfExists(file)).toBe(true);
    expect(process.env[KEY]).toBe("from-file");
  });

  it("does not override a key already in the process environment", () => {
    dir = mkdtempSync(join(tmpdir(), "relay-env-"));
    const file = join(dir, ".env");
    writeFileSync(file, `${KEY}=from-file\n`);
    process.env[KEY] = "already-set";

    expect(loadEnvFileIfExists(file)).toBe(true);
    expect(process.env[KEY]).toBe("already-set");
  });
});
