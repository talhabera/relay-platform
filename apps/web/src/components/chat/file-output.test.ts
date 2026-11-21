import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  fileAvailabilityFromHttpStatus,
  fileCardFromRow,
  fileOutputFromPart,
} from "./file-output";

function part(
  overrides: Record<string, unknown>,
): UIMessage["parts"][number] {
  return {
    type: "tool-excel",
    toolCallId: "file-1",
    state: "output-available",
    input: {},
    output: {},
    ...overrides,
  } as UIMessage["parts"][number];
}

describe("fileOutputFromPart", () => {
  it("returns path and filename for a completed excel tool", () => {
    expect(
      fileOutputFromPart(
        part({
          output: {
            downloadPath: "/api/operator/sessions/c1/files/f1",
            filename: "report.xlsx",
          },
        }),
      ),
    ).toEqual({
      downloadPath: "/api/operator/sessions/c1/files/f1",
      filename: "report.xlsx",
      kind: "xlsx",
    });
  });

  it("returns null without downloadPath", () => {
    expect(fileOutputFromPart(part({ output: { filename: "a.xlsx" } }))).toBeNull();
  });

  it("defaults filename to Excel file", () => {
    expect(
      fileOutputFromPart(
        part({
          output: { downloadPath: "/api/operator/sessions/c1/files/f1" },
        }),
      )?.filename,
    ).toBe("Excel file");
  });
});

describe("fileCardFromRow", () => {
  it("defaults filename when only downloadPath is set", () => {
    expect(
      fileCardFromRow({
        downloadPath: "/api/operator/sessions/c1/files/f1",
        filename: null,
      }),
    ).toEqual({
      downloadPath: "/api/operator/sessions/c1/files/f1",
      filename: "Excel file",
      kind: "file",
    });
  });

  it("returns null without downloadPath", () => {
    expect(
      fileCardFromRow({ downloadPath: null, filename: "report.xlsx" }),
    ).toBeNull();
  });
});

describe("fileAvailabilityFromHttpStatus", () => {
  it("marks 404 and 403 unavailable", () => {
    expect(fileAvailabilityFromHttpStatus(404)).toBe("unavailable");
    expect(fileAvailabilityFromHttpStatus(403)).toBe("unavailable");
    expect(fileAvailabilityFromHttpStatus(200)).toBe("available");
  });
});
