"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeBase } from "@/db/schema";
import {
  createCustomerAgent,
  updateCustomerAgent,
  deleteCustomerAgent,
  createChannel as createChannelOp,
  updateChannel as updateChannelOp,
  setChannelFlag as setChannelFlagOp,
  deleteChannel as deleteChannelOp,
  createIntegration as createIntegrationOp,
  updateIntegration as updateIntegrationOp,
  deleteIntegration as deleteIntegrationOp,
  createTextKnowledge,
  beginWebsiteKnowledge,
  completeWebsiteKnowledge,
  failWebsiteKnowledge,
  updateKnowledge,
  deleteKnowledge,
} from "@relay/agent-ops";
import type { ChannelFlag } from "@relay/agent-ops";
import { requireSession } from "@/lib/auth-server";
import { requireAgentAccess } from "@/lib/authorization";
import {
  leadCaptureSettingsSchema,
  updateLeadCaptureSettings,
  updateLeadIntake,
  type LeadCaptureSettingsInput,
} from "@/lib/leads/lead-capture";
import { leadIntakeSchema, type LeadIntakeInput } from "@/lib/validators/lead-settings";
import { processWebsiteContent } from "@/lib/ai/content-processor";
import { RATE_LIMIT_SURFACES, assertWithinLimits } from "@/lib/rate-limit";
import {
  createCustomerAgentDialogSchema,
  type CreateAgentInput,
  type CreateCustomerAgentDialogInput,
  type UpdateAgentInput,
} from "@/lib/validators/agent";
import { customerStartInstructions } from "@/components/agent/agent-templates";
import {
  type CreateChannelInput,
  type UpdateChannelInput,
} from "@/lib/validators/channel";
import {
  type CreateIntegrationInput,
  type UpdateIntegrationInput,
} from "@/lib/validators/integration";
import {
  createKnowledgeFromWebsiteSchema,
  type CreateKnowledgeEntryInput,
  type UpdateKnowledgeEntryInput,
  type CreateKnowledgeFromWebsiteInput,
} from "@/lib/validators/knowledge";

// ──────────────────────────────────────────────
// Agent CRUD
// ──────────────────────────────────────────────

export async function createAgent(data: CreateAgentInput) {
  const session = await requireSession();
  const result = await createCustomerAgent(session.user.id, data);
  revalidatePath("/agents");
  return result;
}

/** Create customer agent dialog: create, then apply the chosen model and starting instructions. */
export async function createAgentFromDialog(data: CreateCustomerAgentDialogInput) {
  const session = await requireSession();
  const parsed = createCustomerAgentDialogSchema.parse(data);
  const result = await createCustomerAgent(session.user.id, {
    name: parsed.name,
    companyId: parsed.companyId,
  });
  const instructions = customerStartInstructions(parsed.start);
  await updateCustomerAgent(session.user.id, result.id, {
    model: parsed.model,
    ...(instructions ? { instructions } : {}),
  });
  revalidatePath("/agents");
  return result;
}

export async function updateAgent(id: string, data: UpdateAgentInput) {
  const session = await requireSession();
  await updateCustomerAgent(session.user.id, id, data);
  revalidatePath("/agents");
  revalidatePath(`/agents/${id}`);
}

export async function deleteAgent(id: string) {
  const session = await requireSession();
  await deleteCustomerAgent(session.user.id, id);
  revalidatePath("/agents");
}

// ──────────────────────────────────────────────
// Channel CRUD
// ──────────────────────────────────────────────

export async function createChannel(data: CreateChannelInput) {
  const session = await requireSession();
  const result = await createChannelOp(session.user.id, data);
  revalidatePath("/agents");
  return result;
}

export async function updateChannel(id: string, data: UpdateChannelInput) {
  const session = await requireSession();
  await updateChannelOp(session.user.id, id, data);
  revalidatePath("/agents");
}

/**
 * The auto-reply flags have their own action because `updateChannel` replaces
 * `config` wholesale — sending `{ config: { autoReply } }` through it would
 * wipe the channel's credentials. The merge happens server-side in agent-ops.
 */
export async function setChannelFlag(
  id: string,
  flag: ChannelFlag,
  enabled: boolean,
) {
  const session = await requireSession();
  await setChannelFlagOp(session.user.id, id, flag, enabled);
  revalidatePath("/agents");
}

export async function deleteChannel(id: string) {
  const session = await requireSession();
  await deleteChannelOp(session.user.id, id);
  revalidatePath("/agents");
}

// ──────────────────────────────────────────────
// Integration CRUD
// ──────────────────────────────────────────────

export async function createIntegration(data: CreateIntegrationInput) {
  const session = await requireSession();
  const result = await createIntegrationOp(session.user.id, data);
  revalidatePath("/agents");
  return result;
}

export async function updateIntegration(
  id: string,
  data: UpdateIntegrationInput,
) {
  const session = await requireSession();
  await updateIntegrationOp(session.user.id, id, data);
  revalidatePath("/agents");
}

export async function deleteIntegration(id: string) {
  const session = await requireSession();
  await deleteIntegrationOp(session.user.id, id);
  revalidatePath("/agents");
}

// ──────────────────────────────────────────────
// Knowledge CRUD
// ──────────────────────────────────────────────

export async function createKnowledgeEntry(data: CreateKnowledgeEntryInput) {
  const session = await requireSession();
  const result = await createTextKnowledge(session.user.id, data);
  revalidatePath("/agents");
  revalidatePath(`/agents/${data.agentId}`);
  return result;
}

export async function updateKnowledgeEntry(
  id: string,
  data: UpdateKnowledgeEntryInput,
) {
  const session = await requireSession();
  const entry = await db.query.knowledgeBase.findFirst({
    where: eq(knowledgeBase.id, id),
  });
  await updateKnowledge(session.user.id, id, data);
  revalidatePath("/agents");
  if (entry) {
    revalidatePath(`/agents/${entry.agentId}`);
  }
}

export async function deleteKnowledgeEntry(id: string) {
  const session = await requireSession();
  const entry = await db.query.knowledgeBase.findFirst({
    where: eq(knowledgeBase.id, id),
  });
  await deleteKnowledge(session.user.id, id);
  revalidatePath("/agents");
  if (entry) {
    revalidatePath(`/agents/${entry.agentId}`);
  }
}

// ──────────────────────────────────────────────
// Knowledge — Website Fetch + AI Processing
// ──────────────────────────────────────────────

export async function createKnowledgeFromWebsite(
  data: CreateKnowledgeFromWebsiteInput,
) {
  const session = await requireSession();
  const parsed = createKnowledgeFromWebsiteSchema.parse(data);
  await assertWithinLimits(
    RATE_LIMIT_SURFACES.knowledgeIngest({ userId: session.user.id }),
  );
  const { id } = await beginWebsiteKnowledge(session.user.id, parsed);

  try {
    const { markdown, metadata } = await processWebsiteContent(parsed.url);
    const result = await completeWebsiteKnowledge(session.user.id, id, {
      content: markdown,
      metadata,
      name:
        parsed.name || metadata.title || new URL(parsed.url).hostname,
    });
    revalidatePath("/agents");
    revalidatePath(`/agents/${parsed.agentId}`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const result = await failWebsiteKnowledge(session.user.id, id, message);
    revalidatePath("/agents");
    revalidatePath(`/agents/${parsed.agentId}`);
    return { ...result, error: message };
  }
}

// ──────────────────────────────────────────────
// Lead capture (customer inspector, Figma 07 lead-capture-*)
// ──────────────────────────────────────────────

/** Owner-only. Turn Lead capture on or off and pick the workflow its leads feed. */
export async function updateAgentLeadCapture(agentId: string, input: LeadCaptureSettingsInput) {
  const { agent } = await requireAgentAccess(agentId);
  const data = leadCaptureSettingsSchema.parse(input);
  const result = await updateLeadCaptureSettings(agent.id, agent.companyId, data);
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/agents");
  return result.settings;
}

/** Owner-only. Save the intake of the workflow the agent's Lead capture feeds. */
export async function updateAgentLeadIntake(agentId: string, input: LeadIntakeInput) {
  const { agent } = await requireAgentAccess(agentId);
  const fields = leadIntakeSchema.parse(input);
  const result = await updateLeadIntake(agent.id, agent.companyId, fields);
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/agents");
  return result.intake;
}
