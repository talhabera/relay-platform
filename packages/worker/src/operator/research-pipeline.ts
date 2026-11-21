import { and, eq } from "drizzle-orm";
import {
  companyRecords,
  db,
  integrations,
  recordFallbackActor,
  transitionLeadStatus,
  type CompanyRecordStatus,
  type LeadEventActor,
} from "@relay/db";
import { fetchGooglePlacesSearch } from "../integrations/connectors/google-places";
import { fetchHunterDomainSearch } from "../integrations/connectors/hunter";
import { fetchSnovDomainEmails } from "../integrations/connectors/snov";
import {
  type ConnectorHttpResult,
  websiteToDomain,
} from "../integrations/connectors/website-domain";
import {
  RESEARCH_MAX_ATTEMPTS,
  claimResearch,
  revertUnconnectedClaim,
} from "./claim-research";
import { getCompanyRecord } from "./company-records";

export type ResearchMode = "all" | "google_places" | "hunter" | "snov";

type Vendor = "google_places" | "hunter" | "snov";

const VENDOR_ORDER: Vendor[] = ["google_places", "hunter", "snov"];

type VendorConfig = {
  google_places?: { apiKey: string };
  hunter?: { apiKey: string };
  snov?: { clientId: string; clientSecret: string };
};

function vendorsForMode(mode: ResearchMode): Vendor[] {
  if (mode === "all") {
    return [...VENDOR_ORDER];
  }
  return [mode];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("unique") ||
      error.message.includes("duplicate key"))
  );
}

function loadConnectedVendorConfigs(
  integrations: Array<{
    type: string;
    status: string | null;
    config: {
      hunter?: { apiKey: string };
      snov?: { clientId: string; clientSecret: string };
      googlePlaces?: { apiKey: string };
    } | null;
  }>,
): VendorConfig {
  const configs: VendorConfig = {};

  for (const integration of integrations) {
    if (integration.status !== "connected") {
      continue;
    }

    const config = integration.config ?? {};

    switch (integration.type) {
      case "hunter":
        if (config.hunter?.apiKey) {
          configs.hunter = { apiKey: config.hunter.apiKey };
        }
        break;
      case "snov":
        if (config.snov?.clientId && config.snov?.clientSecret) {
          configs.snov = {
            clientId: config.snov.clientId,
            clientSecret: config.snov.clientSecret,
          };
        }
        break;
      case "google_places":
        if (config.googlePlaces?.apiKey) {
          configs.google_places = { apiKey: config.googlePlaces.apiKey };
        }
        break;
      default:
        break;
    }
  }

  return configs;
}

function isVendorConnected(
  vendor: Vendor,
  configs: VendorConfig,
): boolean {
  switch (vendor) {
    case "google_places":
      return configs.google_places !== undefined;
    case "hunter":
      return configs.hunter !== undefined;
    case "snov":
      return configs.snov !== undefined;
    default: {
      const _exhaustive: never = vendor;
      return _exhaustive;
    }
  }
}

async function trySetDomain(input: {
  companyId: string;
  recordId: string;
  domain: string;
}): Promise<boolean> {
  try {
    await db
      .update(companyRecords)
      .set({ domain: input.domain })
      .where(
        and(
          eq(companyRecords.id, input.recordId),
          eq(companyRecords.companyId, input.companyId),
        ),
      );
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return false;
  }
}

function extractPlacesWebsiteUri(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null) {
    return undefined;
  }

  const places = (json as { places?: Array<{ websiteUri?: string }> }).places;
  return places?.[0]?.websiteUri;
}

export async function runResearchPipeline(input: {
  companyId: string;
  recordId: string;
  mode: ResearchMode;
  now?: Date;
  fetchImpl?: typeof fetch;
  /** The agent running the research tool; a sweep credits the record's agent or owner. */
  actor?: LeadEventActor;
}): Promise<
  | { ok: true; status: "researched" | "pending" | "failed" | "processing" }
  | { error: "not_found" | "locked" | "not_connected" }
> {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;

  const recordResult = await getCompanyRecord({
    companyId: input.companyId,
    recordId: input.recordId,
  });

  if ("error" in recordResult) {
    return { error: "not_found" };
  }

  const record = recordResult;
  const actor = input.actor ?? (await recordFallbackActor(db, record));

  const claimResult = await claimResearch({
    companyId: input.companyId,
    recordId: input.recordId,
    now,
    actor,
  });

  if ("error" in claimResult) {
    return { error: claimResult.error };
  }

  const integrationRows = await db.query.integrations.findMany({
    where: eq(integrations.companyId, input.companyId),
  });

  const vendorConfigs = loadConnectedVendorConfigs(integrationRows);
  const neededVendors = vendorsForMode(input.mode);
  const hasConnectedVendor = neededVendors.some((vendor) =>
    isVendorConnected(vendor, vendorConfigs),
  );

  if (!hasConnectedVendor) {
    await revertUnconnectedClaim({
      companyId: input.companyId,
      recordId: input.recordId,
      actor,
    });
    return { error: "not_connected" };
  }

  let payload = { ...record.payload };
  let domain = record.domain;
  let domainChanged = false;
  let successes = 0;
  let lastError = "";

  for (const vendor of VENDOR_ORDER) {
    if (!neededVendors.includes(vendor)) {
      continue;
    }

    if (!isVendorConnected(vendor, vendorConfigs)) {
      continue;
    }

    let result: ConnectorHttpResult;

    switch (vendor) {
      case "google_places":
        result = await fetchGooglePlacesSearch({
          apiKey: vendorConfigs.google_places!.apiKey,
          query: record.name,
          fetchImpl,
        });
        break;
      case "hunter":
        result = await fetchHunterDomainSearch({
          apiKey: vendorConfigs.hunter!.apiKey,
          domain,
          companyName: record.name,
          fetchImpl,
        });
        break;
      case "snov":
        result = await fetchSnovDomainEmails({
          clientId: vendorConfigs.snov!.clientId,
          clientSecret: vendorConfigs.snov!.clientSecret,
          domain,
          fetchImpl,
        });
        break;
      default: {
        const _exhaustive: never = vendor;
        throw new Error(`Unhandled vendor: ${_exhaustive}`);
      }
    }

    if (result.ok) {
      successes += 1;

      switch (vendor) {
        case "google_places": {
          payload = { ...payload, googlePlaces: result.json };
          const websiteUri = extractPlacesWebsiteUri(result.json);
          if (websiteUri && domain === null) {
            const derivedDomain = websiteToDomain(websiteUri);
            if (derivedDomain) {
              const set = await trySetDomain({
                companyId: input.companyId,
                recordId: input.recordId,
                domain: derivedDomain,
              });
              if (set) {
                domain = derivedDomain;
                domainChanged = true;
              }
            }
          }
          break;
        }
        case "hunter":
          payload = { ...payload, hunter: result.json };
          break;
        case "snov":
          payload = { ...payload, snov: result.json };
          break;
        default: {
          const _exhaustive: never = vendor;
          throw new Error(`Unhandled vendor: ${_exhaustive}`);
        }
      }
    } else {
      lastError = result.error;
    }
  }

  const attemptCount = record.researchAttemptCount + 1;

  if (successes >= 1) {
    await writeOutcome(input, actor, now, "researched", {
      researchedAt: now,
      researchLockedAt: null,
      researchLastError: null,
      payload,
      ...(domainChanged ? { domain } : {}),
      updatedAt: now,
    });

    return { ok: true, status: "researched" };
  }

  const status =
    attemptCount >= RESEARCH_MAX_ATTEMPTS ? "failed" : "pending";
  const researchLastError = lastError.slice(0, 500);

  await writeOutcome(input, actor, now, status, {
    researchLastError,
    researchLockedAt: null,
    payload,
    ...(domainChanged ? { domain } : {}),
    updatedAt: now,
  });

  return { ok: true, status };
}

type OutcomeFields = Omit<
  Partial<typeof companyRecords.$inferInsert>,
  "id" | "companyId" | "status" | "createdAt"
>;

/**
 * processing -> researched / pending / failed through the lead event log, with
 * the research fields in the same update. If the status already matches (a
 * concurrent writer), the fields are still written, without an event.
 */
async function writeOutcome(
  input: { companyId: string; recordId: string },
  actor: LeadEventActor,
  now: Date,
  status: CompanyRecordStatus,
  fields: OutcomeFields,
): Promise<void> {
  const moved = await transitionLeadStatus(db, {
    companyId: input.companyId,
    recordId: input.recordId,
    toStatus: status,
    actor,
    at: now,
    set: fields,
  });
  if (moved.changed || moved.reason !== "same_status") return;
  await db
    .update(companyRecords)
    .set(fields)
    .where(
      and(
        eq(companyRecords.id, input.recordId),
        eq(companyRecords.companyId, input.companyId),
      ),
    );
}
