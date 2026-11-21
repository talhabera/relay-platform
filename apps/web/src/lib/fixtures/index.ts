// Fixtures layer entry point. Dev-only: screens that need an entity the
// backend has not built yet read through `getFixtureReaders()` while
// RELAY_FIXTURES=true, and switch to the real reader when its session lands.

import { fixtureData } from "./data";
import { createFixtureReaders } from "./loaders";
import type { RelayReaders } from "./interfaces";

export type * from "./interfaces";
export { createFixtureReaders, fitScoreBand, type FixtureData } from "./loaders";
export { FIXTURE_IDS, FIXTURE_NOW } from "./data";

/** On only with RELAY_FIXTURES=true, and never in a production build. */
export function isFixturesEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.RELAY_FIXTURES === "true"
  );
}

let cached: RelayReaders | null = null;

export function getFixtureReaders(): RelayReaders {
  if (!isFixturesEnabled()) {
    throw new Error(
      "Fixtures are disabled: set RELAY_FIXTURES=true outside production",
    );
  }
  cached ??= createFixtureReaders(fixtureData);
  return cached;
}
