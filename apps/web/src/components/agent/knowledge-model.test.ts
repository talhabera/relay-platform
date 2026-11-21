import { describe, expect, it } from "vitest";

import {
  displayAddress,
  formatFileSize,
  knowledgeEmptyDescription,
  knowledgeEntryView,
  knowledgeGroupLabel,
  knowledgeNote,
  knowledgeSourceKind,
  textEntryName,
  type KnowledgeEntryData,
} from "./knowledge-model";

const base: KnowledgeEntryData = {
  id: "k1",
  name: "Acme price list 2026.pdf",
  type: "file",
  status: "ready",
  fileType: "application/pdf",
  fileSize: 412 * 1024,
  sourceUrl: null,
  content: "...",
  errorMessage: null,
  metadata: null,
  updatedAt: new Date(2026, 8, 24, 10, 0),
};

describe("knowledgeEntryView", () => {
  it("shows a ready file as extension and size (Figma knowledge)", () => {
    const v = knowledgeEntryView(base);
    expect(v).toMatchObject({
      kind: "file",
      icon: "file-text",
      source: "PDF · 412 KB",
      updated: "Updated 24 Sep",
      status: { tone: "success", label: "Ready" },
    });
    expect(v.progress).toBeUndefined();
    expect(v.error).toBeUndefined();
  });

  it("shows pasted text as Text with the pencil icon", () => {
    const v = knowledgeEntryView({ ...base, name: "Service areas", fileType: "text/plain", fileSize: null });
    expect(v.kind).toBe("text");
    expect(v.icon).toBe("pencil");
    expect(v.source).toBe("Text");
  });

  it("shows a processing website with page progress when known (knowledge-processing)", () => {
    const v = knowledgeEntryView({
      ...base,
      type: "website",
      status: "processing",
      name: "acme-reinigung.de/faq",
      metadata: { pagesDone: 4, pagesTotal: 9 },
      updatedAt: new Date(2026, 8, 25),
    });
    expect(v.icon).toBe("globe");
    expect(v.source).toBe("Website");
    expect(v.status).toEqual({ tone: "pending", label: "Processing" });
    expect(v.progress).toEqual({ value: 4, max: 9, label: "4 of 9 pages" });
  });

  it("shows a failed website with its error message (knowledge-error)", () => {
    const v = knowledgeEntryView({
      ...base,
      type: "website",
      status: "error",
      errorMessage: "Could not fetch the page (403).",
    });
    expect(v.status).toEqual({ tone: "error", label: "Error" });
    expect(v.error).toBe("Could not fetch the page (403).");
  });

  it("falls back to a generic error line", () => {
    expect(knowledgeEntryView({ ...base, status: "error", errorMessage: null }).error).toBe(
      "Could not read this source.",
    );
  });

  it("adds the word count to a ready website", () => {
    const v = knowledgeEntryView({ ...base, type: "website", metadata: { domain: "acme.de", wordCount: 1240 } });
    expect(v.source).toBe("Website · 1,240 words");
  });
});

describe("knowledge copy", () => {
  it("labels the group with the source count", () => {
    expect(knowledgeGroupLabel(3)).toBe("Knowledge · 3 sources");
    expect(knowledgeGroupLabel(1)).toBe("Knowledge · 1 source");
  });

  it("notes customer and operator knowledge differently", () => {
    expect(knowledgeNote("customer", "Acme Website Assistant", [base])).toBe(
      "The agent answers from ready sources only.",
    );
    expect(
      knowledgeNote("customer", "Acme Website Assistant", [
        { ...base, type: "website", status: "processing", sourceUrl: "https://www.acme-reinigung.de/faq/" },
      ]),
    ).toBe("acme-reinigung.de/faq joins the answers when reading finishes.");
    expect(knowledgeNote("operator", "Lead Qualifier", [base])).toBe("Shared by all versions of Lead Qualifier.");
  });

  it("describes the empty state per kind", () => {
    expect(knowledgeEmptyDescription("customer", "Acme Website Assistant")).toBe(
      "Add files, website pages or text. Acme Website Assistant answers from ready sources only.",
    );
    expect(knowledgeEmptyDescription("operator", "Mail Marketer")).toBe(
      "Add files, website pages or text. Every version of Mail Marketer uses the same knowledge.",
    );
  });
});

describe("helpers", () => {
  it("formats sizes", () => {
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("tells uploaded text files from pasted text", () => {
    expect(knowledgeSourceKind({ type: "file", fileType: "text/plain", fileSize: 120 })).toBe("file");
    expect(knowledgeSourceKind({ type: "file", fileType: "text/plain", fileSize: null })).toBe("text");
  });

  it("shortens addresses and names text entries", () => {
    expect(displayAddress("https://acme.de/")).toBe("acme.de");
    expect(displayAddress("not a url")).toBe("not a url");
    expect(textEntryName("  Service areas\nMunich")).toBe("Service areas");
    expect(textEntryName("")).toBe("Text");
  });
});
