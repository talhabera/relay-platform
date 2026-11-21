import { describe, expect, it } from "vitest";
import {
  activeSettingsHref,
  SETTINGS_INDEX_HREF,
  settingsNavSections,
} from "./settings-nav";

describe("settingsNavSections", () => {
  it("groups Company, Agency and You in the Figma 08c order", () => {
    const sections = settingsNavSections("Acme GmbH");
    expect(sections.map((s) => s.label)).toEqual([
      "Company · Acme GmbH",
      "Agency",
      "You",
    ]);
    expect(sections.flatMap((s) => s.items.map((i) => i.title))).toEqual([
      "Access & roles",
      "Members",
      "Connectors",
      "Packages",
      "Companies",
      "Profile",
      "Preferences",
    ]);
  });

  it("ships every page, Packages included (S66)", () => {
    const unavailable = settingsNavSections("Acme")
      .flatMap((s) => s.items)
      .filter((i) => !i.available)
      .map((i) => i.title);
    expect(unavailable).toEqual([]);
  });

  it("labels the company section without a name when no company is active", () => {
    expect(settingsNavSections(null)[0].label).toBe("Company");
  });

  it("points moved routes under /settings", () => {
    const hrefs = settingsNavSections("Acme").flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/settings/companies");
    expect(hrefs).toContain("/settings/members");
    expect(hrefs).toContain("/settings/connectors");
    expect(hrefs).toContain("/settings/access");
    expect(hrefs.every((href) => href.startsWith("/settings/"))).toBe(true);
  });
});

describe("activeSettingsHref", () => {
  it.each([
    ["/settings/profile", "/settings/profile"],
    ["/settings/companies", "/settings/companies"],
    ["/settings/companies/c1", "/settings/companies"],
    ["/settings/members", "/settings/members"],
    ["/settings", null],
    ["/settings/companiesx", null],
  ])("%s -> %s", (pathname, expected) => {
    expect(activeSettingsHref(pathname)).toBe(expected);
  });
});

it("lands the /settings index on Profile, which every user has", () => {
  expect(SETTINGS_INDEX_HREF).toBe("/settings/profile");
});
