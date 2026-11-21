import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Parity: docs/design/tokens.json (Figma export) must equal the vars in globals.css.

type Shadow = { x: number; y: number; blur: number; spread: number; color: string };
type TypeStyle = {
  size: number;
  line: number;
  weight: string;
  family: string;
  letterSpacing?: string;
  textCase?: string;
};
type Tokens = {
  primitive: Record<string, Record<string, string> | string>;
  semantic: Record<string, { light: string; dark: string }>;
  radius: Record<string, number>;
  type: Record<string, TypeStyle>;
  effect: Record<string, Shadow[]>;
};

const tokens: Tokens = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../docs/design/tokens.json"), "utf8"),
);
const css = readFileSync(path.resolve(__dirname, "globals.css"), "utf8");

function block(selector: string): string {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`no ${selector} block in globals.css`);
  return m[2];
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const root = vars(block(":root"));
const dark = { ...root, ...vars(block(".dark")) };
const theme = vars(block("@theme inline"));

function resolve(scope: Record<string, string>, value: string, depth = 0): string {
  const m = value.match(/^var\(--([\w-]+)\)$/);
  if (!m) return value.toLowerCase();
  if (depth > 5 || !(m[1] in scope)) throw new Error(`unresolved ${value}`);
  return resolve(scope, scope[m[1]], depth + 1);
}

// "teal/400" -> primitive hex; "white" -> #ffffff
function primitiveHex(ref: string): string {
  const [group, step] = ref.split("/");
  const g = tokens.primitive[group];
  const hex = typeof g === "string" ? g : g[step];
  if (!hex) throw new Error(`unknown primitive ${ref}`);
  return hex.toLowerCase();
}

function primitiveVarName(group: string, step?: string) {
  return step ? `${group}-${step}` : group;
}

const primitiveEntries: [string, string][] = Object.entries(tokens.primitive).flatMap(
  ([group, g]) =>
    typeof g === "string"
      ? [[primitiveVarName(group), g.toLowerCase()] as [string, string]]
      : Object.entries(g).map(([step, hex]) => [primitiveVarName(group, step), hex.toLowerCase()] as [string, string]),
);

const px = (n: number) => `${n}px`;
const weights: Record<string, string> = { Regular: "400", Medium: "500", SemiBold: "600", Bold: "700" };

describe("globals.css primitives", () => {
  it.each(primitiveEntries)("--%s is %s", (name, hex) => {
    expect(root[name]?.toLowerCase()).toBe(hex);
  });
});

describe("globals.css semantic tokens", () => {
  const entries = Object.entries(tokens.semantic);
  it.each(entries)("--%s light and dark", (name, { light, dark: darkRef }) => {
    expect(resolve(root, root[name] ?? "missing"), "light").toBe(primitiveHex(light));
    expect(resolve(dark, dark[name] ?? "missing"), "dark").toBe(primitiveHex(darkRef));
  });

  it.each(entries.filter(([n]) => !n.startsWith("shadow")))("--color-%s is exposed to Tailwind", (name) => {
    expect(theme[`color-${name}`]).toBe(`var(--${name})`);
  });

  it("dark block only overrides semantic tokens", () => {
    const darkOnly = Object.keys(vars(block(".dark")));
    expect(darkOnly.sort()).toEqual(Object.keys(tokens.semantic).sort());
  });
});

describe("globals.css radius", () => {
  it.each(Object.entries(tokens.radius))("--radius-%s is %dpx", (name, value) => {
    expect(theme[`radius-${name}`]).toBe(px(value));
  });

  it("has no radius steps Figma does not define", () => {
    const extra = Object.keys(theme).filter(
      (k) => k.startsWith("radius-") && !(k.slice("radius-".length) in tokens.radius),
    );
    expect(extra).toEqual([]);
  });
});

describe("globals.css type utilities", () => {
  it.each(Object.entries(tokens.type))("@utility type-%s", (name, t) => {
    const body = block(`@utility type-${name}`);
    const v: Record<string, string> = {};
    for (const m of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) v[m[1]] = m[2].trim();
    expect(v["font-size"]).toBe(px(t.size));
    expect(v["line-height"]).toBe(px(t.line));
    expect(v["font-weight"]).toBe(weights[t.weight]);
    expect(v["font-family"]).toBe(t.family === "Geist Mono" ? "var(--font-mono)" : "var(--font-sans)");
    if (t.letterSpacing) expect(v["letter-spacing"]).toBe(`${parseFloat(t.letterSpacing) / 100}em`);
    if (t.textCase === "upper") expect(v["text-transform"]).toBe("uppercase");
  });
});

describe("globals.css effects", () => {
  it.each(Object.entries(tokens.effect))("--shadow-%s", (name, layers) => {
    const expected = layers
      .map((l) => `${px(l.x)} ${px(l.y)} ${px(l.blur)} ${px(l.spread)} var(--${l.color.split("/")[1]})`)
      .join(", ");
    const key = `shadow-${name.replace("/", "-")}`;
    expect(theme[key]?.replace(/\s+/g, " ")).toBe(expected);
  });
});

describe("globals.css fonts", () => {
  it("uses Geist and Geist Mono", () => {
    expect(theme["font-sans"]).toMatch(/^var\(--font-geist-sans\)/);
    expect(theme["font-mono"]).toMatch(/^var\(--font-geist-mono\)/);
  });
});
