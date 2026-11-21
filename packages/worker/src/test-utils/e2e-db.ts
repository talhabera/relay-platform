import { randomBytes } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Backend e2e harness (S95). The suites run only when RELAY_E2E_DB_URL points
// at a throwaway Postgres server the test may create databases on; they never
// read DATABASE_URL, so a dev or shared database is never touched. Each suite
// creates a fresh `relay_e2e_<random>` database, applies every migration with
// drizzle's migrator (same as `pnpm db:migrate`), and drops it afterwards.
//
// One-off server:
//   docker run --rm -d -e POSTGRES_PASSWORD=x -p 127.0.0.1:55432:5432 \
//     --tmpfs /var/lib/postgresql/data postgres:16-alpine
//   RELAY_E2E_DB_URL=postgres://postgres:x@127.0.0.1:55432/postgres \
//     pnpm --filter @relay/worker exec vitest run src/e2e
//
// Modules that read the global `db` (`@relay/db`, agent-ops) build their
// client from DATABASE_URL at import, so a suite sets it with `useE2eDatabase`
// first and imports them dynamically after.

export const E2E_ADMIN_URL = process.env.RELAY_E2E_DB_URL;

const MIGRATIONS = path.join(__dirname, "../../../db/drizzle");

export type E2eDatabase = {
  url: string;
  name: string;
  drop(): Promise<void>;
};

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Creates and migrates a fresh database on the RELAY_E2E_DB_URL server. */
export async function createE2eDatabase(): Promise<E2eDatabase> {
  if (!E2E_ADMIN_URL) throw new Error("RELAY_E2E_DB_URL is not set");
  const admin = E2E_ADMIN_URL;
  const name = `relay_e2e_${randomBytes(6).toString("hex")}`;
  const adminClient = postgres(admin, { max: 1, onnotice: () => undefined });
  await adminClient.unsafe(`CREATE DATABASE "${name}"`);
  await adminClient.end();

  const url = withDatabase(admin, name);
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.end();
  }

  return {
    url,
    name,
    async drop() {
      const c = postgres(admin, { max: 1, onnotice: () => undefined });
      await c.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await c.end();
    },
  };
}

/** Creates the database and points DATABASE_URL at it for later imports. */
export async function useE2eDatabase(): Promise<E2eDatabase> {
  const database = await createE2eDatabase();
  process.env.DATABASE_URL = database.url;
  return database;
}
