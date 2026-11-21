import "./load-root-env";
import { createServer } from "node:http";
import { and, isNull, lt } from "drizzle-orm";
import { adClicks, db } from "@relay/db";
import { createPgTickDeps, runCronTick } from "./cron-tick";
import {
  continueCronRun,
  failStuckLiveRuns,
  pollOpenBatches,
  resumeApprovedCronRuns,
  startCronBatch,
  startCronLive,
} from "./cron-run";
import { assertWorkerSecret } from "./internal-auth";
import { sweepResearchQueue } from "./operator/research-sweep";
import { sweepHandoffRequests } from "./handoff/sweep";
import { freezeDueReportSnapshots } from "./reports/freeze";
import { deliverDueReportEmails } from "./reports/email";
import { enrichQuietChats } from "./enrichment/chat-enrichment";
import { sweepUnpushedQualifiedLeads } from "./leads/unpushed-sweep";
import { expireAdChangeCards } from "./ads/expire-ad-changes";
import {
  createPgRateLimitStore,
  pruneRateLimits,
} from "@relay/db/rate-limit";

const port = Number(process.env.CRON_PORT ?? "3011");
const rateLimitStore = createPgRateLimitStore(db);

/** Expired rate-limit windows and leases, swept by the single cron replica. */
async function pruneExpiredRateLimits(now: Date) {
  try {
    await pruneRateLimits(rateLimitStore, now);
  } catch (error) {
    console.error("rate limit prune failed", error);
  }
}

/** `ad_change` cards nobody answered within 24 hours are discarded, never applied (08b2). */
async function expireAdChanges(now: Date) {
  try {
    await expireAdChangeCards(now);
  } catch (error) {
    console.error("ad change expiry failed", error);
  }
}

/** Days an unlinked ad click is kept after it stops being bindable. */
const AD_CLICK_RETENTION_DAYS = 30;

/**
 * Ad clicks that never bound to a lead, deleted 30 days after they stopped
 * being bindable. Linked clicks are kept as attribution history.
 */
async function pruneExpiredAdClicks(now: Date) {
  try {
    const cutoff = new Date(now.getTime() - AD_CLICK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db
      .delete(adClicks)
      .where(and(isNull(adClicks.linkedRecordId), lt(adClicks.expiresAt, cutoff)));
  } catch (error) {
    console.error("ad click prune failed", error);
  }
}

/** Closed days, weeks and months frozen into report snapshots (S86-87). */
async function freezeReports(now: Date) {
  try {
    await freezeDueReportSnapshots(now);
  } catch (error) {
    console.error("report snapshot freeze failed", error);
  }
}

/** Frozen daily reports mailed to client users (S88); off without SMTP_USER/SMTP_PASS. */
async function emailReports(now: Date) {
  try {
    await deliverDueReportEmails(now);
  } catch (error) {
    console.error("report email delivery failed", error);
  }
}
/** Qualified leads whose push never landed get the WhatsApp backup. */
async function sweepUnpushedLeads(now: Date) {
  try {
    await sweepUnpushedQualifiedLeads(now);
  } catch (error) {
    console.error("unpushed lead sweep failed", error);
  }
}

/** Quiet customer conversations get sentiment, language and duration (S83). */
async function enrichChats(now: Date) {
  try {
    await enrichQuietChats(now);
  } catch (error) {
    console.error("chat enrichment failed", error);
  }
}

const deps = createPgTickDeps(db, {
  startLive: startCronLive,
  startBatch: startCronBatch,
});

function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

let tickInFlight: Promise<void> | null = null;

async function tick() {
  if (tickInFlight) {
    return tickInFlight;
  }

  tickInFlight = (async () => {
    const now = new Date();
    try {
      await failStuckLiveRuns(now);
      await pollOpenBatches(now);
      await resumeApprovedCronRuns();
      await runCronTick(now, deps);
      await sweepResearchQueue(now);
      await sweepHandoffRequests(now);
      await freezeReports(now);
      await emailReports(now);
      await enrichChats(now);
      await sweepUnpushedLeads(now);
      await pruneExpiredRateLimits(now);
      await expireAdChanges(now);
      await pruneExpiredAdClicks(now);
    } catch (error) {
      console.error("cron tick failed", error);
    }
  })().finally(() => {
    tickInFlight = null;
  });

  return tickInFlight;
}

void tick();
setInterval(() => {
  void tick();
}, 60_000);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/cron/continue") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    void readJsonBody(req)
      .then(async (body) => {
        const runId = (body as { runId?: string }).runId;
        if (!runId || typeof runId !== "string") {
          res.writeHead(400);
          res.end("Invalid JSON");
          return;
        }

        await continueCronRun(runId);
        res.writeHead(202);
        res.end();
      })
      .catch(() => {
        res.writeHead(400);
        res.end("Invalid JSON");
      });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`cron worker listening on ${port}`);
});
