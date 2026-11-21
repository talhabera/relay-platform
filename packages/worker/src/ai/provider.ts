import { anthropic } from "@ai-sdk/anthropic";
import { MODEL_IDS, resolveModelId } from "./model-keys";

export const DEFAULT_MODEL_ID = MODEL_IDS.haiku;

export function getModel(model?: string | null) {
  return anthropic(resolveModelId(model));
}
