// @vitest-environment node
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { productionPaths } from "./paths.js";
import { productionRegistry } from "./registry.js";

const mockup = JSON.parse(
  readFileSync(new URL("registry/mockup-tokens.json", import.meta.url), "utf8"),
);
const core = JSON.parse(
  readFileSync(new URL("registry/core.json", import.meta.url), "utf8"),
);
const registry = productionRegistry();

const contextOf = new Map([
  ["|:root", "light"],
  ['|[data-theme="dark"]', "dark"],
  ['|[data-theme="dark"] .work', "dark-work"],
  ["(prefers-color-scheme: dark)|:root:not([data-theme])", "system-dark"],
  [
    "(prefers-color-scheme: dark)|:root:not([data-theme]) .work",
    "system-dark-work",
  ],
  [
    "print|:root[data-theme], :root:not([data-theme]), :root[data-theme] .work, :root:not([data-theme]) .work",
    "print",
  ],
  ['|[data-theme="light"]', "light-scheme"],
]);

/** Every declaration per context in source order, so a duplicate stays visible. */
function shipped(css = readFileSync(productionPaths.tokensFile, "utf8")) {
  const found = {};
  postcss.parse(css).walkRules((rule) => {
    const media = rule.parent?.name === "media" ? rule.parent.params : "";
    const key = `${media}|${rule.selector.replace(/\s+/gu, " ")}`;
    const context = contextOf.get(key);
    if (context === undefined) throw new Error(`unknown context ${key}`);
    if (found[context] !== undefined) throw new Error(`duplicate ${key}`);
    found[context] = rule.nodes
      .filter((n) => n.type === "decl")
      .map((d) => [d.prop, d.value]);
  });
  return found;
}

const folded = (value) =>
  value.replace(/#[0-9a-f]+\b/giu, (hex) => hex.toLowerCase());
const tokensOnly = (list) =>
  Object.fromEntries(
    list.filter(([n]) => n.startsWith("--")).map(([n, v]) => [n, folded(v)]),
  );

const stacks = {
  "--font-ui": '"Segoe UI Variable Text", "Noto Sans", sans-serif',
  "--font-display":
    '"Segoe UI Variable Display", "Noto Sans Display", sans-serif',
  "--font-code": '"SL Code"',
};
const additions = [
  "--header-bg",
  "--shadow-press",
  "--shadow-lift",
  "--shadow-pop",
];
const invariants = [
  "--font-ui",
  "--font-display",
  "--font-code",
  "--r",
  "--r-sm",
  "--prose",
];

// Deviations approved in the brief; everything else must equal the mockup exactly.
function expected(context) {
  const out = {};
  for (const [name, value] of mockup.contexts[context]) out[name] = value;
  const dark = context.includes("dark");
  if (!context.endsWith("work")) {
    out["--ok"] = out["--second"];
    out["--ok-soft"] = out["--second-soft"];
    for (const name of additions)
      out[name] = core.colour.exact[name][dark ? "dark" : "light"];
  }
  if (context === "light") {
    Object.assign(out, stacks, { "--r": "0.625rem", "--r-sm": "0.5rem" });
  }
  return Object.fromEntries(
    Object.entries(out).map(([n, v]) => [n, folded(v)]),
  );
}

const mockupDerived = new Set([...invariants, ...core.colour.names]);
const ofMockup = (map) =>
  Object.fromEntries(Object.entries(map).filter(([n]) => mockupDerived.has(n)));

describe("production tokens.css", () => {
  const contexts = shipped();

  it.each([
    "light",
    "dark",
    "dark-work",
    "system-dark",
    "system-dark-work",
    "print",
  ])(
    "reconciles the %s context with the mockup and the approved deviations",
    (context) => {
      expect(ofMockup(tokensOnly(contexts[context]))).toEqual(
        expected(context),
      );
    },
  );

  it("declares each name once per context, print --bg included", () => {
    for (const list of Object.values(contexts)) {
      const names = list.map(([n]) => n);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(tokensOnly(contexts.print)["--bg"]).toBe("#ffffff");
  });

  it("declares exactly the 186 registry names in light :root, never --split", () => {
    const declared = Object.keys(tokensOnly(contexts.light)).sort();
    const names = [...registry.tokens.keys()]
      .filter((n) => n !== "--split")
      .sort();
    expect(declared).toEqual(names);
    expect(declared).toHaveLength(186);
    for (const list of Object.values(contexts))
      expect(list.some(([n]) => n === "--split")).toBe(false);
  });

  it("gives spacing, type and radius tokens their registry values", () => {
    const light = tokensOnly(contexts.light);
    for (const [name, token] of registry.tokens) {
      if (
        ["spacing", "font-size", "line-height", "radius"].includes(
          token.category,
        )
      )
        expect(light[name]).toBe(token.value);
    }
  });

  it("keeps --ok and --ok-soft equal to --second and --second-soft", () => {
    for (const context of ["light", "dark", "system-dark", "print"]) {
      const map = tokensOnly(contexts[context]);
      expect(map["--ok"]).toBe(map["--second"]);
      expect(map["--ok-soft"]).toBe(map["--second-soft"]);
    }
  });

  it("states the dark set verbatim under both dark selectors", () => {
    expect(contexts["system-dark"]).toEqual(contexts.dark);
    expect(contexts["system-dark-work"]).toEqual(contexts["dark-work"]);
    expect(Object.keys(tokensOnly(contexts.dark))).toHaveLength(43);
    expect(Object.keys(tokensOnly(contexts["dark-work"]))).toHaveLength(5);
    expect(Object.keys(tokensOnly(contexts.print))).toHaveLength(43);
    expect(contexts["light-scheme"]).toEqual([["color-scheme", "light"]]);
  });

  it("lists the six invariant tokens in light :root only", () => {
    const light = tokensOnly(contexts.light);
    for (const name of invariants) expect(light[name]).toBeDefined();
    for (const [context, list] of Object.entries(contexts)) {
      if (context === "light") continue;
      for (const name of invariants)
        expect(list.some(([n]) => n === name)).toBe(false);
    }
  });

  it("fails reconciliation on a missing, extra or differing token", () => {
    const css = readFileSync(productionPaths.tokensFile, "utf8");
    const changed = shipped(
      css.replace("--accent: #286773;", "--accent: #286774;"),
    );
    expect(ofMockup(tokensOnly(changed.light))).not.toEqual(expected("light"));
    const missing = shipped(css.replace("    --warn: #745b20;\n", ""));
    expect(ofMockup(tokensOnly(missing.light))).not.toEqual(expected("light"));
    const extra = { ...tokensOnly(contexts.dark), "--prose": "68ch" };
    expect(ofMockup(extra)).not.toEqual(expected("dark"));
    expect(() =>
      shipped(`${css}\n@layer tokens {\n  :root {\n    --bg: #fff;\n  }\n}\n`),
    ).toThrow(/duplicate/u);
  });
});

function luminance(hex) {
  const channels = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text on the surfaces it is set on; decorative lines are not held to 3:1.
const textPairs = [
  ["--text", "--bg"],
  ["--text", "--surface"],
  ["--text", "--surface-2"],
  ["--text-2", "--surface"],
  ["--muted", "--surface"],
  ["--accent", "--surface"],
  ["--accent-ink", "--accent"],
  ["--warm-ink", "--warm"],
  ["--ok", "--ok-soft"],
  ["--warn", "--warn-soft"],
  ["--bad", "--bad-soft"],
  ["--ed-text", "--ed-bg"],
  ["--ed-kw", "--ed-bg"],
  ["--ed-type", "--ed-bg"],
  ["--ed-str", "--ed-bg"],
  ["--ed-cm", "--ed-bg"],
  ["--ed-num", "--ed-bg"],
  ["--term-text", "--term-bg"],
];
// Boundaries that carry meaning: focus and link colour against the page.
const boundaryPairs = [
  ["--accent", "--bg"],
  ["--accent", "--surface"],
];

describe("contrast per context", () => {
  const contexts = shipped();
  const resolved = (context) => {
    const base = context.endsWith("work") ? context.slice(0, -5) : context;
    return {
      ...tokensOnly(contexts[base]),
      ...tokensOnly(contexts[context]),
    };
  };

  it.each(["light", "dark", "system-dark", "print"])(
    "text pairs reach 4.5:1 and boundaries 3:1 in %s",
    (context) => {
      const map = resolved(context);
      for (const [fg, bg] of textPairs)
        expect([fg, bg, contrast(map[fg], map[bg]) >= 4.5]).toEqual([
          fg,
          bg,
          true,
        ]);
      for (const [fg, bg] of boundaryPairs)
        expect([fg, bg, contrast(map[fg], map[bg]) >= 3]).toEqual([
          fg,
          bg,
          true,
        ]);
    },
  );

  it.each(["dark-work", "system-dark-work"])(
    "the workspace text reaches 4.5:1 in %s",
    (context) => {
      const map = resolved(context);
      for (const [fg, bg] of [
        ["--text", "--surface"],
        ["--text", "--surface-2"],
        ["--muted", "--surface"],
      ])
        expect([fg, bg, contrast(map[fg], map[bg]) >= 4.5]).toEqual([
          fg,
          bg,
          true,
        ]);
    },
  );
});
