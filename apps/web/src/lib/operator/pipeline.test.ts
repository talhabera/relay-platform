import { describe, expect, it } from "vitest";
import { filterPipelineRecords } from "./pipeline";

const rows = [
  { name: "Acme", domain: "acme.com", status: "researched" },
  { name: "Beta LLC", domain: "beta.io", status: "outreach_pending" },
  { name: "Gamma", domain: null, status: "researched" },
];

describe("filterPipelineRecords", () => {
  it("returns all rows when query is empty", () => {
    expect(filterPipelineRecords(rows, {})).toEqual(rows);
  });

  it("filters by exact status", () => {
    expect(filterPipelineRecords(rows, { status: "researched" })).toEqual([
      rows[0],
      rows[2],
    ]);
  });

  it("matches q against name or domain case-insensitively", () => {
    expect(filterPipelineRecords(rows, { q: "ACME" })).toEqual([rows[0]]);
    expect(filterPipelineRecords(rows, { q: "beta.io" })).toEqual([rows[1]]);
  });
});
