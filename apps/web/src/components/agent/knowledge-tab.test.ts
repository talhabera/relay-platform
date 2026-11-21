import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(dashboard)/agents/actions", () => ({
  createKnowledgeEntry: vi.fn(),
  createKnowledgeFromWebsite: vi.fn(),
  updateKnowledgeEntry: vi.fn(),
  deleteKnowledgeEntry: vi.fn(),
}));

import { KnowledgeEntry } from "./knowledge-entry";
import { knowledgeEntryView, type KnowledgeEntryData } from "./knowledge-model";
import { KnowledgeTab } from "./knowledge-tab";

const at = new Date(2026, 8, 24);
const pdf: KnowledgeEntryData = {
  id: "k-pdf",
  name: "Acme price list 2026.pdf",
  type: "file",
  status: "ready",
  fileType: "application/pdf",
  fileSize: 412 * 1024,
  sourceUrl: null,
  content: "prices",
  errorMessage: null,
  metadata: null,
  updatedAt: at,
};
const faq: KnowledgeEntryData = {
  ...pdf,
  id: "k-faq",
  name: "acme-reinigung.de/faq",
  type: "website",
  status: "processing",
  fileType: null,
  fileSize: null,
  sourceUrl: "https://acme-reinigung.de/faq",
  metadata: { pagesDone: 4, pagesTotal: 9 },
};
const karriere: KnowledgeEntryData = {
  ...faq,
  id: "k-karriere",
  name: "acme-reinigung.de/karriere",
  status: "error",
  sourceUrl: "https://acme-reinigung.de/karriere",
  errorMessage: "Could not fetch the page (403).",
  metadata: null,
};

const props = { agentId: "a1", companyId: "c1", agentName: "Acme Website Assistant" };

describe("KnowledgeTab", () => {
  it("lists sources under the count label with the add row and note (knowledge)", () => {
    const html = renderToStaticMarkup(h(KnowledgeTab, { ...props, entries: [pdf] }));
    expect(html).toContain("Knowledge · 1 source");
    expect(html).toContain("Acme price list 2026.pdf");
    expect(html).toContain("PDF · 412 KB");
    expect(html).toContain("Updated 24 Sep");
    expect(html).toContain("Ready");
    for (const label of ["Upload file", "Add website", "Add text"]) expect(html).toContain(label);
    expect(html).toContain("The agent answers from ready sources only.");
    expect(html).toContain('aria-label="Acme price list 2026.pdf actions"');
  });

  it("shows the empty state for an agent without knowledge (knowledge-empty)", () => {
    const html = renderToStaticMarkup(h(KnowledgeTab, { ...props, entries: [] }));
    expect(html).toContain("No knowledge yet");
    expect(html).toContain("Acme Website Assistant answers from ready sources only.");
    expect(html).toContain("Upload file");
    expect(html).not.toContain("Knowledge ·");
  });

  it("shows progress and the processing note (knowledge-processing)", () => {
    const html = renderToStaticMarkup(h(KnowledgeTab, { ...props, entries: [faq, pdf] }));
    expect(html).toContain("Processing");
    expect(html).toContain("4 of 9 pages");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("acme-reinigung.de/faq joins the answers when reading finishes.");
  });

  it("shows the error line with Retry (knowledge-error)", () => {
    const html = renderToStaticMarkup(h(KnowledgeTab, { ...props, entries: [pdf, karriere] }));
    expect(html).toContain("Knowledge · 2 sources");
    expect(html).toContain("Could not fetch the page (403).");
    expect(html).toContain("Retry");
  });

  it("uses operator copy (agents-operator/knowledge, knowledge-empty)", () => {
    const op = { ...props, agentName: "Lead Qualifier", kind: "operator" as const };
    expect(renderToStaticMarkup(h(KnowledgeTab, { ...op, entries: [pdf] }))).toContain(
      "Shared by all versions of Lead Qualifier.",
    );
    expect(renderToStaticMarkup(h(KnowledgeTab, { ...op, agentName: "Mail Marketer", entries: [] }))).toContain(
      "Every version of Mail Marketer uses the same knowledge.",
    );
  });

  it("is read-only without manage rights", () => {
    const html = renderToStaticMarkup(h(KnowledgeTab, { ...props, entries: [karriere], canManage: false }));
    expect(html).toContain("Could not fetch the page (403).");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Upload file");
    expect(html).not.toContain("actions\"");
  });
});

describe("KnowledgeEntry", () => {
  it("renders the meta line and status chip", () => {
    const html = renderToStaticMarkup(h(KnowledgeEntry, { name: pdf.name, view: knowledgeEntryView(pdf) }));
    expect(html).toContain('data-slot="knowledge-entry"');
    expect(html).toContain('data-kind="file"');
    expect(html).toContain('data-icon="file-text"');
    expect(html).toContain('data-tone="success"');
  });
});
