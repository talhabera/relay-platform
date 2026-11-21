import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { existsSync } from "node:fs";
import path from "node:path";

function findMonorepoRoot(): string {
  const starts = [process.cwd(), __dirname];
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 6; i++) {
      if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
        return dir;
      }
      const parent = path.resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }
  return path.resolve(process.cwd(), "../..");
}

const repoRoot = findMonorepoRoot();
loadEnvConfig(repoRoot);

if (process.env.NODE_ENV !== "production") {
  if (!process.env.AUTH_SECRET) {
    console.warn(
      "[relay] AUTH_SECRET is unset. NextAuth will fail. Copy .env.example to .env at the repo root.",
    );
  }
  if (!process.env.WORKER_URL || !process.env.WORKER_SECRET) {
    console.warn(
      "[relay] WORKER_URL / WORKER_SECRET are unset. Chat returns 503. Copy .env.example to .env at the repo root and run `pnpm dev` (web + worker).",
    );
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  reactCompiler: true,
  serverExternalPackages: ["postgres"],
  transpilePackages: ["@relay/db", "@relay/agent-ops"],
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/home",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
