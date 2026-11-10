// The per-context token catalogue from the shipped tokens.css, and the contrast pairs the browser tests measure.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Declaration } from "postcss";
import { productionRegistry } from "../stylelint/registry.js";

const web = join(import.meta.dirname, "..");

/** One emulated page state: see expectedTokens. */
export interface PageState {
  theme: "light" | "dark" | null;
  scheme: "light" | "dark";
  print: boolean;
  work: boolean;
}

/** A foreground and background token pair with its minimum contrast ratio. */
export interface Pair {
  fg: string;
  bg: string;
  min: number;
  kind: string;
}

type Sets = Record<string, Record<string, string>>;

const contextOf = new Map([
  ["|:root", "light"],
  ['|[data-theme="light"]', "light-scheme"],
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
]);

/** Token declarations per context, read from the sheet the build ships. */
export function contexts(
  css: string = readFileSync(join(web, "src", "theme", "tokens.css"), "utf8"),
): Sets {
  const found: Sets = {};
  postcss.parse(css).walkRules((rule) => {
    const parent = rule.parent;
    const media =
      parent?.type === "atrule" && "name" in parent && parent.name === "media"
        ? parent.params
        : "";
    const key = `${media}|${rule.selector.replace(/\s+/gu, " ")}`;
    const context = contextOf.get(key);
    if (context === undefined) throw new Error(`unknown context ${key}`);
    if (context in found) throw new Error(`duplicate context ${key}`);
    found[context] = Object.fromEntries(
      rule.nodes
        .filter(
          (n): n is Declaration => n.type === "decl" && n.prop.startsWith("--"),
        )
        .map((d) => [d.prop, d.value]),
    );
  });
  for (const name of contextOf.values())
    if (!(name in found)) throw new Error(`tokens.css has no ${name} context`);
  // The cascade below holds only if print restates every name a dark context sets.
  const print = found["print"] ?? {};
  for (const name of ["dark", "dark-work", "system-dark", "system-dark-work"])
    for (const token of Object.keys(found[name] ?? {}))
      if (!(token in print))
        throw new Error(`print does not restate ${token} from ${name}`);
  return found;
}

/**
 * The expected value of every token for one page state: theme is "light", "dark" or null
 * (no data-theme), scheme the emulated colour scheme, print the emulated media, work
 * whether the probe sits inside .work.
 */
export function expectedTokens(
  { theme, scheme, print, work }: PageState,
  sets: Sets = contexts(),
): Record<string, string> {
  const dark = theme === "dark" || (theme === null && scheme === "dark");
  const out = { ...sets["light"] };
  if (dark) {
    Object.assign(out, theme === "dark" ? sets["dark"] : sets["system-dark"]);
    if (work)
      Object.assign(
        out,
        theme === "dark" ? sets["dark-work"] : sets["system-dark-work"],
      );
  }
  if (print) Object.assign(out, sets["print"]);
  return out;
}

const probeProperty: Record<string, string | undefined> = {
  colour: "color",
  "font-stack": "font-family",
  "font-size": "font-size",
  "line-height": "line-height",
  spacing: "margin-left",
  radius: "border-top-left-radius",
  layout: "width",
};

/** Each declared token with the property its value is measured through; an unknown category fails. */
export function tokenProbes(): { name: string; property: string }[] {
  const out: { name: string; property: string }[] = [];
  for (const [name, token] of productionRegistry().tokens) {
    if (token.runtime === true) continue;
    const property = probeProperty[token.category];
    if (property === undefined)
      throw new Error(`no probe property for ${name} (${token.category})`);
    out.push({ name, property });
  }
  return out;
}

/** The runtime-only names, which no stylesheet may declare. */
export const runtimeTokens = (): string[] =>
  [...productionRegistry().tokens]
    .filter(([, token]) => token.runtime === true)
    .map(([name]) => name);

const across = (
  fgs: string[],
  bgs: string[],
  min: number,
  kind: string,
): Pair[] => fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min, kind })));
const syntax = [
  "--ed-text",
  "--ed-kw",
  "--ed-type",
  "--ed-str",
  "--ed-num",
  "--ed-cm",
];
const neutral = ["--bg", "--surface", "--surface-2"];

/** Contrast pairs; the editor frame separator is decorative by owner decision and is not here. */
export const contrastPairs: Pair[] = [
  ...across(["--text", "--text-2", "--muted"], neutral, 4.5, "body"),
  ...[
    ["--accent-ink", "--accent"],
    ["--warm-ink", "--warm"],
    ["--accent", "--accent-soft"],
    ["--warm", "--warm-soft"],
    ["--ok", "--ok-soft"],
    ["--warn", "--warn-soft"],
    ["--bad", "--bad-soft"],
  ].map(([fg = "", bg = ""]) => ({ fg, bg, min: 4.5, kind: "tinted" })),
  ...across(["--accent"], neutral, 4.5, "link"),
  ...across(["--ok", "--warn", "--bad"], ["--surface"], 4.5, "status"),
  ...across(
    syntax,
    [
      "--ed-bg",
      "--ed-cur",
      "--sel",
      "--sel-inactive",
      "--warn-soft",
      "--find-other",
    ],
    4.5,
    "editor",
  ),
  { fg: "--ed-gutter-text", bg: "--ed-gutter", min: 4.5, kind: "editor" },
  { fg: "--ed-text", bg: "--ed-gutter", min: 4.5, kind: "editor" },
  { fg: "--term-text", bg: "--term-bg", min: 4.5, kind: "editor" },
  ...across(["--accent"], ["--surface-2", "--bg"], 3, "boundary"),
];

/** Pairs measured inside .work, where the workspace restates its surfaces. */
export const workPairs: Pair[] = [
  ...across(["--text", "--muted"], ["--surface", "--surface-2"], 4.5, "body"),
  ...across(["--accent"], ["--surface-2", "--surface"], 3, "boundary"),
];

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an opaque computed rgb() colour; anything else fails. */
export function luminance(computed: string): number {
  const m = /^rgba?\((\d+), (\d+), (\d+)(?:, (1|0?\.\d+))?\)$/u.exec(computed);
  if (m === null) throw new Error(`not an rgb() colour: ${computed}`);
  if (m[4] !== undefined && m[4] !== "1")
    throw new Error(`a translucent colour has no contrast ratio: ${computed}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => channel(Number(x))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
