import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSessionFile,
  saveSessionFile,
  sessionStorageRoot,
} from "./session-file-store";

describe("session-file-store", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createTempRoot() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "relay-session-files-"));
    tempDirs.push(dir);
    return dir;
  }

  it("sessionStorageRoot defaults to cwd/storage", () => {
    expect(sessionStorageRoot()).toBe(path.join(process.cwd(), "storage"));
  });

  it("rejects storage keys that escape session-files", async () => {
    const rootDir = await createTempRoot();

    await expect(readSessionFile("../secrets.txt", rootDir)).rejects.toThrow(
      /invalid storage key/i,
    );
    await expect(
      readSessionFile("other-dir/file.xlsx", rootDir),
    ).rejects.toThrow(/invalid storage key/i);
  });

  it("saveSessionFile then readSessionFile roundtrips bytes", async () => {
    const rootDir = await createTempRoot();
    const bytes = Buffer.from("excel-bytes");

    const saved = await saveSessionFile(bytes, "report.xlsx", rootDir);

    expect(saved.byteSize).toBe(bytes.byteLength);
    expect(saved.storageKey).toMatch(
      /^session-files\/[0-9a-f-]{36}\.xlsx$/,
    );

    const read = await readSessionFile(saved.storageKey, rootDir);
    expect(read).toEqual(bytes);
  });
});
