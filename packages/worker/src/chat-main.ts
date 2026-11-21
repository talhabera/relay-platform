import { enqueueHumanMessageDelivery } from "./handoff/deliver";
import "./load-root-env";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { assertWorkerSecret } from "./internal-auth";
import { healthzResponse } from "./healthz";
import { handleInternalChat, type InternalChatBody } from "./handle-internal-chat";
import { enqueueInboundRun } from "./handle-inbound-message";
import { parseInboundRequest } from "./inbound-request";
import { handleCommentRequest } from "./comment-request";
import { enqueueHandoffFollowUp } from "./handoff/follow-up";
import {
  handleRecipientConfirmationRequest,
  handleRecipientReply,
  type InternalResponse,
} from "./handoff/recipient-confirmation";
import {
  handleTeamChatAvailabilityRequest,
  handleTeamChatGroupRequest,
  handleTeamChatWebhook,
} from "./handoff/team-chat";
import { deliverLead, parseDeliverLeadBody } from "./leads/deliver-lead";
import { handleAdChangeRequest, parseAdChangeBody } from "./ads/ad-change-route";
import { onLeadAcceptedByPerson } from "./leads/score-lead";
import { parseSendOutreachBody, sendOutreach } from "./operator/send-outreach";
import { handleReportPdfRequest } from "./reports/pdf";
import { isRunActive } from "./operator/active-runs";

const port = Number(process.env.WORKER_PORT ?? "3001");

async function writeWebResponse(
  res: import("node:http").ServerResponse,
  web: Response,
) {
  const headers: Record<string, string> = {};
  web.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(web.status, headers);
  if (!web.body) {
    res.end();
    return;
  }
  Readable.fromWeb(web.body as import("node:stream/web").ReadableStream).pipe(
    res,
  );
}

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    const body = healthzResponse();
    res.writeHead(body.status, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  // Whether an operator session has a turn in flight (page load after a refresh).
  if (req.method === "GET" && url.pathname === "/internal/chat/running") {
    if (!assertWorkerSecret(req.headers.authorization ?? null, process.env.WORKER_SECRET ?? "")) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
    const chatId = url.searchParams.get("chatId") ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ running: chatId !== "" && isRunActive(chatId) }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/chat") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    try {
      const body = (await readJsonBody(req)) as InternalChatBody;
      const response = await handleInternalChat(body);
      await writeWebResponse(res, response);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/inbound") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    const request = parseInboundRequest(body);
    if (!request) {
      res.writeHead(400);
      res.end("Invalid inbound request");
      return;
    }

    // Answer immediately and run the agent in the background: the caller is a
    // webhook that must answer Meta inside its retry window.
    enqueueInboundRun(request);
    res.writeHead(202);
    res.end("Accepted");
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/comment") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    // Answer immediately and run the agent in the background: the caller is a
    // webhook that must answer Meta inside its retry window.
    try {
      const { status, text } = await handleCommentRequest(body);
      res.writeHead(status);
      res.end(text);
    } catch (cause) {
      console.error("[Comment] request failed", cause);
      res.writeHead(500);
      res.end("Comment request failed");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/handoff/follow-up") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    const requestId = (body as { requestId?: unknown } | null)?.requestId;
    if (typeof requestId !== "string" || requestId.length === 0) {
      res.writeHead(400);
      res.end("Invalid follow-up request");
      return;
    }

    // A colleague answered: the agent follows up in the background.
    try {
      const queued = await enqueueHandoffFollowUp(requestId);
      res.writeHead(queued ? 202 : 404);
      res.end(queued ? "Accepted" : "Not found");
    } catch (cause) {
      console.error("[Handoff] follow-up request failed", cause);
      res.writeHead(500);
      res.end("Follow-up request failed");
    }
    return;
  }

  const recipientRoutes: Record<string, (body: unknown) => Promise<InternalResponse>> = {
    "/internal/handoff/recipient-confirmation": handleRecipientConfirmationRequest,
    "/internal/handoff/recipient-reply": handleRecipientReply,
    // Team chat: the agent's WhatsApp group and invite link, and the group
    // part of a verified WhatsApp webhook body.
    "/internal/handoff/team-chat-group": handleTeamChatGroupRequest,
    "/internal/handoff/team-chat-availability": handleTeamChatAvailabilityRequest,
    "/internal/whatsapp/groups": handleTeamChatWebhook,
  };
  const recipientRoute = recipientRoutes[url.pathname];
  if (req.method === "POST" && recipientRoute) {
    const secret = process.env.WORKER_SECRET ?? "";
    if (!assertWorkerSecret(req.headers.authorization ?? null, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    // Staff notification: send the recipient confirmation, or record a tap on Confirm.
    try {
      const result = await recipientRoute(body);
      res.writeHead(result.status);
      res.end(result.body);
    } catch (cause) {
      console.error("[Handoff] recipient route failed", url.pathname, cause);
      res.writeHead(500);
      res.end("Recipient request failed");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/handoff/deliver") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    const messageId = (body as { messageId?: unknown } | null)?.messageId;
    if (typeof messageId !== "string" || messageId.length === 0) {
      res.writeHead(400);
      res.end("Invalid delivery request");
      return;
    }

    // A person wrote to the customer (quick-link answer or takeover): send it
    // out on the conversation's channel in the background.
    try {
      const queued = await enqueueHumanMessageDelivery(messageId);
      res.writeHead(queued ? 202 : 404);
      res.end(queued ? "Accepted" : "Not found");
    } catch (cause) {
      console.error("[Handoff] delivery request failed", cause);
      res.writeHead(500);
      res.end("Delivery request failed");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/ad-change") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    const request = parseAdChangeBody(body);
    if (!request) {
      res.writeHead(400);
      res.end("Invalid ad change request");
      return;
    }

    // Synchronous: web waits for the change to settle the approved card.
    try {
      const outcome = await handleAdChangeRequest(request.checkpointId);
      res.writeHead(outcome.ok ? 200 : outcome.status, {
        "content-type": "application/json",
      });
      res.end(
        JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
      );
    } catch (cause) {
      console.error("[Ad change] request failed", cause);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Reklam değişikliği çalıştırılamadı" }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/lead-delivery") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    const request = parseDeliverLeadBody(body);
    if (!request) {
      res.writeHead(400);
      res.end("Invalid lead delivery request");
      return;
    }

    // Synchronous: web waits for the send to settle the approved card.
    try {
      const outcome = await deliverLead(request.checkpointId);
      res.writeHead(outcome.ok ? 200 : outcome.status, {
        "content-type": "application/json",
      });
      res.end(
        JSON.stringify(
          outcome.ok ? outcome.result : { error: outcome.error },
        ),
      );
    } catch (cause) {
      console.error("[Lead delivery] request failed", cause);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Lead delivery failed" }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/outreach-send") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    const request = parseSendOutreachBody(body);
    if (!request) {
      res.writeHead(400);
      res.end("Invalid outreach send request");
      return;
    }

    // Synchronous: web waits for the Gmail send to settle the approved card (S73).
    try {
      const outcome = await sendOutreach(request.checkpointId);
      res.writeHead(outcome.ok ? 200 : outcome.status, {
        "content-type": "application/json",
      });
      res.end(
        JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }),
      );
    } catch (cause) {
      console.error("[Outreach send] request failed", cause);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Outreach send failed" }));
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/lead-notify") {
    const secret = process.env.WORKER_SECRET ?? "";
    const auth = req.headers.authorization ?? null;
    if (!assertWorkerSecret(auth, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    const leadId = (body as { leadId?: unknown } | null)?.leadId;
    if (typeof leadId !== "string" || leadId.length === 0) {
      res.writeHead(400);
      res.end("Invalid lead notify request");
      return;
    }

    // A person accepted a borderline lead (decision 16): notify, and for an
    // inbound lead open its delivery card (W3GAP). The claim on notified_at
    // and the one-pending-card index make a repeat a no-op; never throws.
    const { notify, deliveryCheckpointId } = await onLeadAcceptedByPerson(leadId);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ outcome: notify, deliveryCheckpointId }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/reports/pdf") {
    const secret = process.env.WORKER_SECRET ?? "";
    if (!assertWorkerSecret(req.headers.authorization ?? null, secret)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }

    // Report PDF (S89): web posts the print-CSS report HTML, Chromium prints it.
    const result = await handleReportPdfRequest(body);
    res.writeHead(result.status, { "content-type": result.contentType });
    res.end(result.body);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`worker chat listening on ${port}`);
});
