import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "./breadcrumb";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Combobox } from "./combobox";
import { Input } from "./input";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Select, SelectTrigger, SelectValue } from "./select";
import { Switch } from "./switch";
import { Textarea } from "./textarea";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m ? (m[1] ?? m[2]) : "";
};

// Figma 02 `338:559`: Button 4:42, Input 4:67, Textarea 4:76, Select 4:89, Combobox 4:117,
// Checkbox 4:133, Radio 4:149, Switch 4:170, Breadcrumb 4:277.

describe("Button", () => {
  const variants = ["default", "secondary", "outline", "ghost", "destructive"] as const;
  const sizes = { sm: "h-8", md: "h-10", lg: "h-11" } as const;

  it.each(variants.flatMap((v) => (Object.keys(sizes) as (keyof typeof sizes)[]).map((s) => [v, s] as const)))(
    "renders variant=%s size=%s at the Figma height with radius/lg",
    (variant, size) => {
      const html = render(h(Button, { variant, size }, "Button"));
      const cls = classOf(html, "button");
      expect(html).toContain(`data-variant="${variant}"`);
      expect(html).toContain(`data-size="${size}"`);
      expect(cls).toContain(sizes[size]);
      expect(cls).toContain("rounded-lg");
      expect(cls).toContain("focus-visible:shadow-focus-ring");
    },
  );

  it("defaults to variant=default size=md (40 high, primary fill)", () => {
    const cls = classOf(render(h(Button, null, "Go")), "button");
    expect(cls).toContain("h-10");
    expect(cls).toContain("bg-primary");
    expect(cls).toContain("px-4");
  });

  it("keeps size=default as an alias of md", () => {
    const html = render(h(Button, { size: "default" }, "Go"));
    expect(classOf(html, "button")).toContain("h-10");
  });

  it("destructive is a solid fill with destructive-foreground", () => {
    const cls = classOf(render(h(Button, { variant: "destructive" }, "Delete")), "button");
    expect(cls).toContain("bg-destructive");
    expect(cls).toContain("text-destructive-foreground");
  });

  it("disabled default uses primary-soft, not opacity", () => {
    const cls = classOf(render(h(Button, { disabled: true }, "Go")), "button");
    expect(cls).toContain("disabled:bg-primary-soft");
    expect(cls).toContain("disabled:text-primary-soft-foreground");
    expect(cls).not.toContain("disabled:opacity-50");
  });

  it("outline and ghost go accent on hover", () => {
    for (const variant of ["outline", "ghost"] as const) {
      const cls = classOf(render(h(Button, { variant }, "x")), "button");
      expect(cls).toContain("hover:bg-accent");
      expect(cls).toContain("hover:text-accent-foreground");
    }
  });

  it("renders icon sizes and an icon child", () => {
    const html = render(h(Button, { size: "icon", "aria-label": "Add" }, h("svg", { "data-icon": "plus" })));
    expect(html).toContain('data-size="icon"');
    expect(html).toContain('aria-label="Add"');
    expect(html).toContain("<svg");
  });

  it("supports asChild", () => {
    const html = render(h(Button, { asChild: true }, h("a", { href: "/x" }, "Link")));
    expect(html).toMatch(/^<a /);
    expect(html).toContain('data-slot="button"');
  });
});

describe("Input / Textarea", () => {
  it("Input is 40 high, radius/lg, input border, primary focus border + ring, error via aria-invalid", () => {
    const cls = classOf(render(h(Input, { placeholder: "Placeholder" })), "input");
    for (const c of ["h-10", "rounded-lg", "border-input", "bg-background", "px-3", "text-sm", "placeholder:text-muted-foreground", "focus-visible:border-primary", "focus-visible:shadow-focus-ring", "aria-invalid:border-destructive", "disabled:opacity-50"]) {
      expect(cls).toContain(c);
    }
  });

  it("Input passes value and aria-invalid through", () => {
    const html = render(h(Input, { defaultValue: "Value", "aria-invalid": true }));
    expect(html).toContain('value="Value"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("Textarea is at least 96 high with the same states", () => {
    const cls = classOf(render(h(Textarea, { placeholder: "Placeholder" })), "textarea");
    for (const c of ["min-h-24", "rounded-lg", "border-input", "px-3", "py-2", "focus-visible:border-primary", "focus-visible:shadow-focus-ring", "aria-invalid:border-destructive"]) {
      expect(cls).toContain(c);
    }
  });
});

describe("Select", () => {
  it("trigger is 40 high with a chevron-down and the field states", () => {
    const html = render(
      h(Select, null, h(SelectTrigger, null, h(SelectValue, { placeholder: "Select an option" }))),
    );
    const cls = classOf(html, "select-trigger");
    for (const c of ["data-[size=default]:h-10", "rounded-lg", "border-input", "focus-visible:border-primary", "focus-visible:shadow-focus-ring", "aria-invalid:border-destructive"]) {
      expect(cls).toContain(c);
    }
    expect(html).toContain("lucide-chevron-down");
    expect(html).toContain("Select an option");
  });
});

describe("Combobox", () => {
  const options = [
    { value: "one", label: "Option one" },
    { value: "two", label: "Option two" },
  ];

  it("renders a combobox trigger with placeholder and chevron", () => {
    const html = render(h(Combobox, { options, placeholder: "Search…" }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Search…");
    expect(html).toContain("lucide-chevron-down");
    const cls = classOf(html, "combobox-trigger");
    expect(cls).toContain("h-10");
    expect(cls).toContain("data-[state=open]:border-ring");
  });

  it("shows the selected option label", () => {
    const html = render(h(Combobox, { options, value: "two", placeholder: "Search…" }));
    expect(html).toContain("Option two");
    expect(html).not.toContain("Search…");
  });

  it("passes disabled and aria-invalid to the trigger", () => {
    const html = render(h(Combobox, { options, disabled: true, "aria-invalid": true }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain('aria-invalid="true"');
  });
});

describe("Checkbox", () => {
  it("renders a 16px radius/sm box with border-strong and primary checked fill", () => {
    const html = render(h(Checkbox, { "aria-label": "Label" }));
    const cls = classOf(html, "checkbox");
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="false"');
    for (const c of ["size-4", "rounded-sm", "border-border-strong", "data-[state=checked]:bg-primary", "data-[state=checked]:border-primary", "focus-visible:shadow-focus-ring", "aria-invalid:border-destructive"]) {
      expect(cls).toContain(c);
    }
  });

  it("checked renders the check indicator", () => {
    const html = render(h(Checkbox, { defaultChecked: true, "aria-label": "Label" }));
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("lucide-check");
  });
});

describe("RadioGroup", () => {
  it("renders round 16px items; the checked one shows a 6px dot", () => {
    const html = render(
      h(RadioGroup, { defaultValue: "a" }, h(RadioGroupItem, { value: "a", "aria-label": "A" }), h(RadioGroupItem, { value: "b", "aria-label": "B" })),
    );
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)?.length).toBe(2);
    const cls = classOf(html, "radio-group-item");
    for (const c of ["size-4", "rounded-full", "border-border-strong", "data-[state=checked]:bg-primary", "focus-visible:shadow-focus-ring"]) {
      expect(cls).toContain(c);
    }
    expect(html).toContain('data-slot="radio-group-indicator"');
    expect(classOf(html, "radio-group-dot")).toContain("size-1.5");
  });
});

describe("Switch", () => {
  it("track is 36x20 muted/primary, thumb 16px muted-foreground/primary-foreground", () => {
    const html = render(h(Switch, { "aria-label": "Label" }));
    expect(html).toContain('role="switch"');
    const track = classOf(html, "switch");
    for (const c of ["data-[size=default]:h-5", "data-[size=default]:w-9", "rounded-full", "data-[state=unchecked]:bg-muted", "data-[state=checked]:bg-primary"]) {
      expect(track).toContain(c);
    }
    const thumb = classOf(html, "switch-thumb");
    for (const c of ["data-[state=unchecked]:bg-muted-foreground", "data-[state=checked]:bg-primary-foreground", "group-data-[size=default]/switch:size-4"]) {
      expect(thumb).toContain(c);
    }
  });

  it("checked sets aria-checked", () => {
    expect(render(h(Switch, { defaultChecked: true }))).toContain('aria-checked="true"');
  });
});

describe("Breadcrumb", () => {
  it("renders a nav with muted links, slash separators and a current page", () => {
    const html = render(
      h(
        Breadcrumb,
        null,
        h(
          BreadcrumbList,
          null,
          h(BreadcrumbItem, null, h(BreadcrumbLink, { href: "/operator" }, "Operator")),
          h(BreadcrumbSeparator),
          h(BreadcrumbItem, null, h(BreadcrumbPage, null, "Session 41")),
        ),
      ),
    );
    expect(html).toMatch(/^<nav aria-label="breadcrumb"/);
    expect(classOf(html, "breadcrumb-list")).toContain("type-small");
    expect(classOf(html, "breadcrumb-list")).toContain("text-muted-foreground");
    expect(html).toContain('href="/operator"');
    expect(html).toMatch(/aria-hidden="true"[^>]*>\/</);
    expect(html).toContain('aria-current="page"');
    expect(classOf(html, "breadcrumb-page")).toContain("text-foreground");
  });
});
