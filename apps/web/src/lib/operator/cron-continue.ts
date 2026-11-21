export async function pokeCronContinue(runId: string): Promise<void> {
  const base = process.env.CRON_URL;
  const secret = process.env.WORKER_SECRET;
  if (!base || !secret) return;
  await fetch(`${base.replace(/\/$/, "")}/internal/cron/continue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ runId }),
  }).catch(() => undefined);
}
