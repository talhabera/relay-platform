export const MODEL_KEYS = ["haiku", "sonnet", "opus"] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];

export const MODEL_IDS: Record<ModelKey, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
};

export const DEFAULT_MODEL_KEY: ModelKey = "haiku";
export const DEFAULT_MASTER_MODEL_KEY: ModelKey = "sonnet";

export const MODEL_LABELS: Record<ModelKey, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
};

export function isModelKey(value: string): value is ModelKey {
  return (MODEL_KEYS as readonly string[]).includes(value);
}

export function resolveModelId(key?: string | null): string {
  if (key && isModelKey(key)) {
    return MODEL_IDS[key];
  }
  return MODEL_IDS.haiku;
}
