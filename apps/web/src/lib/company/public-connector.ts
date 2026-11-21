import type { IntegrationConfig } from "@/db/schema";

export type PublicConnector = {
  id: string;
  type: string;
  status: string | null;
  error: string | null;
  hasHunterKey: boolean;
  hasSnov: boolean;
  hasPlacesKey: boolean;
};

export function toPublicConnector(row: {
  id: string;
  type: string;
  status: string | null;
  error: string | null;
  config: IntegrationConfig | null;
}): PublicConnector {
  const config = row.config ?? {};

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    error: row.error,
    hasHunterKey: Boolean(config.hunter?.apiKey),
    hasSnov: Boolean(config.snov?.clientId && config.snov?.clientSecret),
    hasPlacesKey: Boolean(config.googlePlaces?.apiKey),
  };
}
