import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { isRetryableMigrateError } from "./migrate-retry";

const MAX_ATTEMPTS = 10;
const RETRY_DELAY_MS = 2000;

const connectionString: string = process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Running migrations...");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await migrate(db, { migrationsFolder: "./drizzle" });
      console.log("Migrations complete.");
      await client.end();
      return;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (!isRetryableMigrateError(err) || attempt === MAX_ATTEMPTS) {
        throw err;
      }
      console.error(
        `Migration connection failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY_MS}ms...`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
