import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Loads `KEY=value` lines without overwriting variables already in the environment. */
export function loadEnvFileIfExists(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  process.loadEnvFile(filePath);
  return true;
}

export function loadMonorepoRootEnv(): void {
  const root = resolve(import.meta.dirname, "../../..");
  loadEnvFileIfExists(resolve(root, ".env"));
  loadEnvFileIfExists(resolve(root, ".env.local"));
}

loadMonorepoRootEnv();
