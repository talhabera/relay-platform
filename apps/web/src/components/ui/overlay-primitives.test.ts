import { createElement as h, Fragment, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Radix portals render nothing on the server; pass children through so the content
// renders into static markup.
vi.mock("radix-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("radix-ui")>();
  const Passthrough = ({ children }: { children?: ReactNode }) => h(Fragment, null, children);
  const withPortal = <T extends object>(ns: T) => ({ ...ns, Portal: Passthrough });
  return {
    ...actual,
    Dialog: withPortal(actual.Dialog),
    DropdownMenu: withPortal(actual.DropdownMenu),
    Popover: withPortal(actual.Popover),
    Tooltip: withPortal(actual.Tooltip),
  };
});

const sonnerProps: Record<string, unknown>[] = [];
vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    sonnerProps.push(props);
    return null;
  },
}));

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "./popover";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "./sheet";
import { Toaster, toastClassNames } from "./sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m ? (m[1] ?? m[2]).replaceAll("&amp;", "&") : "";
};
const expectAll = (cls: string, tokens: string[]) => {
  for (const t of tokens) expect(cls.split(/\s+/)).toContain(t);
};

// Figma 02 `338:559`: Dropdown menu 4:220, Command 4:247, Tooltip 4:268, Popover 4:270,
// Dialog set 709:95882 (4:306 danger/inline, 709:95962 success/stacked), Sheet 4:315, Toast 4:292.

describe("Dropdown menu", () => {
  const menu = () =>
    render(
      h(
        DropdownMenu,
        { open: true },
        h(DropdownMenuTrigger, null, "Open"),
        h(
          DropdownMenuContent,
          null,
          h(DropdownMenuLabel, null, "Session"),
          h(DropdownMenuItem, null, "Duplicate"),
          h(DropdownMenuSeparator),
          h(DropdownMenuItem, { variant: "destructive" }, "Delete"),
        ),
      ),
    );

  it("content is radius/xl, elevation/2, padding and gap space/1", () => {
    expectAll(classOf(menu(), "dropdown-menu-content"), [
      "bg-popover",
      "rounded-xl",
      "border",
      "border-border",
      "p-1",
      "gap-1",
      "flex-col",
      "shadow-elevation-2",
    ]);
  });

  it("items are 32 high, radius/md, type/body; hover=accent, keyboard focus=ring", () => {
    const cls = classOf(menu(), "dropdown-menu-item");
    expectAll(cls, [
      "h-8",
      "rounded-md",
      "px-2",
      "type-body",
      "focus:bg-accent",
      "focus:text-accent-foreground",
      "focus-visible:bg-popover",
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
      "focus-visible:ring-inset",
    ]);
    expect(cls).not.toContain("rounded-sm");
    expect(cls).not.toContain("text-sm");
  });

  it("renders the label, separator and destructive item", () => {
    const html = menu();
    expect(classOf(html, "dropdown-menu-label")).toContain("type-body-strong");
    expect(html).toContain('data-slot="dropdown-menu-separator"');
    expect(html).toContain('data-variant="destructive"');
  });
});

describe("Command", () => {
  const list = () =>
    h(
      CommandList,
      null,
      h(CommandEmpty, null, "No results"),
      h(CommandGroup, null, h(CommandItem, null, "Go to dashboard"), h(CommandItem, null, "Sign out")),
    );

  it("bare Command stays chrome-less (Combobox composes it in a Popover)", () => {
    const cls = classOf(render(h(Command, null, h(CommandInput, { placeholder: "Placeholder" }), list())), "command");
    expectAll(cls, ["bg-popover", "text-popover-foreground"]);
    expect(cls).not.toContain("shadow-elevation-3");
    expect(cls).not.toContain("border");
  });

  it("items are 32 high, radius/md, type/body, accent when selected", () => {
    const cls = classOf(render(h(Command, null, list())), "command-item");
    expectAll(cls, ["h-8", "rounded-md", "px-2", "type-body", "data-[selected=true]:bg-accent"]);
  });

  it("input uses type/body with a muted placeholder", () => {
    const cls = classOf(render(h(Command, null, h(CommandInput, { placeholder: "Search" }))), "command-input");
    expectAll(cls, ["type-body", "placeholder:text-muted-foreground"]);
  });

  it("CommandDialog is the palette: radius/2xl, elevation/3, space/2 padding, 360 wide, bordered search", () => {
    const html = render(h(CommandDialog, { open: true }, h(CommandInput, { placeholder: "Placeholder" }), list()));
    const content = classOf(html, "command-dialog");
    expectAll(content, ["rounded-2xl", "shadow-elevation-3", "p-2", "gap-0", "sm:max-w-[360px]"]);
    const surface = classOf(html, "command");
    expectAll(surface, [
      "gap-1",
      "**:data-[slot=command-input-wrapper]:h-10",
      "**:data-[slot=command-input-wrapper]:rounded-lg",
      "**:data-[slot=command-input-wrapper]:border-input",
      "[&_[cmdk-item][data-selected=true]]:ring-2",
      "[&_[cmdk-item][data-selected=true]]:ring-ring",
    ]);
    expect(html).not.toContain('data-slot="dialog-close"');
  });
});

describe("Tooltip", () => {
  const tip = () =>
    render(
      h(
        TooltipProvider,
        null,
        h(Tooltip, { open: true }, h(TooltipTrigger, null, "?"), h(TooltipContent, null, "Approve this run")),
      ),
    );

  it("is the inverted surface at radius/xl, elevation/2, type/small, space/2 x space/1", () => {
    expectAll(classOf(tip(), "tooltip-content"), [
      "bg-foreground",
      "text-background",
      "rounded-xl",
      "px-2",
      "py-1",
      "type-small",
      "shadow-elevation-2",
    ]);
  });

  it("has no arrow", () => {
    expect(tip()).not.toContain("rotate-45");
  });
});

describe("Popover", () => {
  const pop = () =>
    render(
      h(
        Popover,
        { open: true },
        h(PopoverTrigger, null, "Filters"),
        h(
          PopoverContent,
          null,
          h(PopoverHeader, null, h(PopoverTitle, null, "Filters"), h(PopoverDescription, null, "Narrow the list.")),
        ),
      ),
    );

  it("content is 280 wide, radius/xl, elevation/2, padding space/3", () => {
    expectAll(classOf(pop(), "popover-content"), [
      "bg-popover",
      "w-[280px]",
      "rounded-xl",
      "border-border",
      "p-3",
      "shadow-elevation-2",
    ]);
  });

  it("title is type/body-strong and description type/small muted, 4 apart", () => {
    const html = pop();
    expect(classOf(html, "popover-header")).toContain("gap-1");
    expect(classOf(html, "popover-title")).toContain("type-body-strong");
    expectAll(classOf(html, "popover-description"), ["type-small", "text-muted-foreground"]);
  });
});

describe("Dialog", () => {
  const dialog = (opts: {
    showCloseButton?: boolean;
    icon?: ReactNode;
    tone?: "danger" | "success" | "neutral";
    layout?: "inline" | "stacked";
    note?: string;
  } = {}) =>
    render(
      h(
        Dialog,
        { open: true },
        h(
          DialogContent,
          { showCloseButton: opts.showCloseButton },
          h(
            DialogHeader,
            null,
            h(DialogTitle, { icon: opts.icon, tone: opts.tone }, "Approve cron run?"),
            h(DialogDescription, null, "This will publish the digest."),
          ),
          h(DialogFooter, { layout: opts.layout, note: opts.note }, h("button", null, "Cancel"), h("button", null, "Approve")),
        ),
      ),
    );

  it("content is the popover surface at 480, radius/2xl, elevation/3, padding space/6, gap space/4", () => {
    expectAll(classOf(dialog(), "dialog-content"), [
      "bg-popover",
      "text-popover-foreground",
      "rounded-2xl",
      "border-border",
      "p-6",
      "gap-4",
      "shadow-elevation-3",
      "sm:max-w-[480px]",
    ]);
  });

  it("header is left-aligned, title type/h3, description type/body muted", () => {
    const html = dialog();
    expectAll(classOf(html, "dialog-header"), ["gap-4", "text-left"]);
    expectAll(classOf(html, "dialog-title"), ["type-h3", "text-popover-foreground"]);
    expectAll(classOf(html, "dialog-description"), ["type-body", "text-muted-foreground"]);
  });

  it("showCloseButton renders a 32px ghost icon button 24px from the corner", () => {
    const html = dialog({ showCloseButton: true });
    const cls = classOf(html, "dialog-close");
    expect(html).toContain('data-variant="ghost"');
    expectAll(cls, ["size-8", "absolute", "top-6", "right-6"]);
    expect(html).toContain("Close");
  });

  it("showCloseButton=false hides the close button", () => {
    expect(dialog({ showCloseButton: false })).not.toContain('data-slot="dialog-close"');
  });

  it("no title icon by default", () => {
    expect(dialog()).not.toContain('data-slot="dialog-title-icon"');
  });

  it.each([
    ["danger", "text-destructive"],
    ["success", "text-success"],
    ["neutral", "text-popover-foreground"],
  ] as const)("icon=true renders the 20px triangle-alert colored by tone=%s", (tone, color) => {
    const html = dialog({ icon: true, tone });
    const cls = classOf(html, "dialog-title-icon");
    expectAll(cls, ["size-5", color]);
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain("lucide-triangle-alert");
  });

  it("icon accepts a swapped node", () => {
    const html = dialog({ icon: h("svg", { "data-icon": "check" }), tone: "success" });
    expect(html).toContain('data-icon="check"');
    expect(html).not.toContain("lucide-triangle-alert");
  });

  it("footer=inline right-aligns the buttons and ignores note", () => {
    const html = dialog({ note: "ignored" });
    expect(html).toContain('data-layout="inline"');
    expectAll(classOf(html, "dialog-footer"), ["sm:flex-row", "sm:justify-end", "gap-2"]);
    expect(html).not.toContain("dialog-footer-note");
  });

  it("footer=stacked is full width with a caption note below", () => {
    const html = dialog({ layout: "stacked", note: "By requesting access you agree to our Privacy policy." });
    expect(html).toContain('data-layout="stacked"');
    expectAll(classOf(html, "dialog-footer"), ["flex-col", "items-stretch", "gap-3"]);
    expectAll(classOf(html, "dialog-footer-note"), ["type-caption", "text-muted-foreground", "text-center"]);
    expect(html).toContain("Privacy policy");
  });
});

describe("Sheet", () => {
  const sheet = (side?: "right" | "left") =>
    render(
      h(
        Sheet,
        { open: true },
        h(
          SheetContent,
          { side },
          h(SheetHeader, null, h(SheetTitle, null, "Session details"), h(SheetDescription, null, "Body")),
          h(SheetFooter, null, h("button", null, "Cancel"), h("button", null, "Save")),
        ),
      ),
    );

  it("content is the popover surface at 400, radius/2xl inner edge, elevation/3, padding space/6", () => {
    expectAll(classOf(sheet(), "sheet-content"), [
      "bg-popover",
      "text-popover-foreground",
      "p-6",
      "gap-4",
      "shadow-elevation-3",
      "sm:max-w-[400px]",
      "rounded-l-2xl",
    ]);
    expect(classOf(sheet("left"), "sheet-content")).toContain("rounded-r-2xl");
  });

  it("title type/h3, description type/body muted, footer right-aligned, ghost close", () => {
    const html = sheet();
    expect(classOf(html, "sheet-title")).toContain("type-h3");
    expectAll(classOf(html, "sheet-description"), ["type-body", "text-muted-foreground"]);
    expectAll(classOf(html, "sheet-footer"), ["mt-auto", "sm:justify-end"]);
    expectAll(classOf(html, "sheet-close"), ["size-8", "top-6", "right-6"]);
  });
});

describe("Toast", () => {
  it("Toaster is unstyled with the Figma classNames, 320 wide, no richColors", () => {
    sonnerProps.length = 0;
    render(h(Toaster));
    const props = sonnerProps[0];
    expect(props.richColors).toBeUndefined();
    expect(props.toastOptions).toEqual({ unstyled: true, classNames: toastClassNames });
    expect((props.style as Record<string, string>)["--width"]).toBe("320px");
  });

  it("variant=default is the popover surface at radius/xl, elevation/3, space/4 x space/3", () => {
    expectAll(toastClassNames.toast, [
      "bg-popover",
      "border-border",
      "rounded-xl",
      "px-4",
      "py-3",
      "shadow-elevation-3",
    ]);
    expect(toastClassNames.title).toContain("type-body-strong");
    expectAll(toastClassNames.description, ["type-small", "text-muted-foreground"]);
  });

  it("variant=error (toast.error) is a solid destructive fill", () => {
    expectAll(toastClassNames.error, ["bg-destructive", "text-destructive-foreground", "border-destructive"]);
  });

  it("hides status icons but keeps the loading spinner", () => {
    expectAll(toastClassNames.icon, ["hidden", "in-data-[type=loading]:flex"]);
  });
});
