const ANTHROPIC_API_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

function anthropicHeaders(): Record<string, string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
}

export async function submitMessageBatch(
  requests: Array<{ customId: string; params: Record<string, unknown> }>,
): Promise<string> {
  const response = await fetch(`${ANTHROPIC_API_URL}/messages/batches`, {
    method: "POST",
    headers: anthropicHeaders(),
    body: JSON.stringify({
      requests: requests.map((request) => ({
        custom_id: request.customId,
        params: request.params,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

export async function pollMessageBatch(
  batchId: string,
): Promise<"open" | "ended"> {
  const response = await fetch(
    `${ANTHROPIC_API_URL}/messages/batches/${batchId}`,
    { headers: anthropicHeaders() },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = (await response.json()) as { processing_status: string };
  return data.processing_status === "ended" ? "ended" : "open";
}

export async function fetchMessageBatchResults(
  batchId: string,
): Promise<Array<{ customId: string; ok: boolean; body: unknown }>> {
  const response = await fetch(
    `${ANTHROPIC_API_URL}/messages/batches/${batchId}/results`,
    { headers: anthropicHeaders() },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const text = await response.text();
  const results: Array<{ customId: string; ok: boolean; body: unknown }> = [];

  for (const line of text.split("\n").filter(Boolean)) {
    const row = JSON.parse(line) as {
      custom_id: string;
      result: { type: string; message?: unknown; error?: unknown };
    };

    if (row.result.type === "succeeded") {
      results.push({
        customId: row.custom_id,
        ok: true,
        body: row.result.message,
      });
      continue;
    }

    results.push({
      customId: row.custom_id,
      ok: false,
      body: row.result,
    });
  }

  return results;
}
