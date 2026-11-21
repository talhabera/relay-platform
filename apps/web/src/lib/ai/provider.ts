import { anthropic } from "@ai-sdk/anthropic";
import { resolveModelId } from "./model-keys";

export function getModel(model?: string | null) {
  return anthropic(resolveModelId(model));
}
