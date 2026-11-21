import { METRIC_KEYS, type MetricKey } from "@/lib/fixtures/interfaces";

// Metric-key catalog (workflow spec decision 5). Keys are fixed in code and
// stored as text on stages and on a workflow's target. S23 implements each
// key as a weekly query in company time behind `MetricSource`; until then
// the null source reports no data, so stages render "no value yet".

export { METRIC_KEYS, type MetricKey };

const KEY_SET: ReadonlySet<string> = new Set(METRIC_KEYS);

export function isMetricKey(key: string | null | undefined): key is MetricKey {
  return typeof key === "string" && KEY_SET.has(key);
}

/** Week-to-date inbound counts; summed for the inbound node. */
export const INBOUND_LEADS_METRIC: MetricKey = "leads.inbound";
export const INBOUND_CONVERSATIONS_METRIC: MetricKey = "conversations.started";

export interface MetricSource {
  /**
   * Week-to-date value of each requested key for the company, in company
   * time. A key with no data source yet is left out of the result.
   */
  getValues(
    companyId: string,
    keys: readonly MetricKey[],
    now: Date,
  ): Promise<Partial<Record<MetricKey, number>>>;
}

/** Stand-in until S23: no key has a data source. */
export const nullMetricSource: MetricSource = {
  async getValues() {
    return {};
  },
};
