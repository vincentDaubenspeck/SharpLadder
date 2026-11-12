import { expect, test } from "@playwright/test";
import {
  contexts,
  contrastPairs,
  expectedTokens,
  ratio,
  runtimeTokens,
  tokenProbes,
  workPairs,
  type PageState,
  type Pair,
} from "./catalogue.ts";
import { distUrl, readColours, readTokens, setState, settle } from "./probe.ts";

const sets = contexts();
const probes = tokenProbes();
const themes = [null, "light", "dark"] as const;
const states: PageState[] = themes.flatMap((theme) =>
  (["light", "dark"] as const).flatMap((scheme) =>
    [false, true].flatMap((print) =>
      [false, true].map((work) => ({ theme, scheme, print, work })),
    ),
  ),
);
const label = (s: PageState) =>
  `theme=${s.theme ?? "absent"} scheme=${s.scheme} ${s.print ? "print" : "screen"}${s.work ? " .work" : ""}`;

/** Every token that differs from the catalogue in one state; empty means the state matches. */
async function mismatches(
  page: import("@playwright/test").Page,
  state: PageState,
) {
  await setState(page, state);
  const expected = expectedTokens(state, sets);
  const readings = await readTokens(
    page,
    probes.map((p) => ({ ...p, expected: expected[p.name] ?? "" })),
    state.work,
  );
  return readings
    .filter((r) => r.actual !== r.expected || r.actual === "")
    .map((r) => `${r.name}: ${r.actual} != ${r.expected}`);
}

test.beforeEach(async ({ page }) => {
  await page.goto(distUrl);
  await settle(page);
});

test("TH1 every token in every state equals the catalogue", async ({
  page,
}) => {
  expect(probes).toHaveLength(186);
  const failures: string[] = [];
  for (const state of states)
    for (const line of await mismatches(page, state))
      failures.push(`${label(state)}: ${line}`);
  expect(failures).toEqual([]);
});

test("TH1 the runtime-only name is declared nowhere", async ({ page }) => {
  for (const state of states) {
    await setState(page, state);
    const values = await page.evaluate(
      (names) =>
        names.map((n) =>
          getComputedStyle(document.documentElement).getPropertyValue(n),
        ),
      runtimeTokens(),
    );
    expect(values.every((v) => v === "")).toBe(true);
  }
});

test("TH1/TH5 parity: both dark selectors give the same computed set", async ({
  page,
}) => {
  for (const work of [false, true]) {
    const names = probes
      .filter((p) => p.property === "color")
      .map((p) => p.name);
    await setState(page, { theme: "dark", scheme: "light", print: false });
    const explicit = await readColours(page, names, work);
    await setState(page, { theme: null, scheme: "dark", print: false });
    const system = await readColours(page, names, work);
    expect(system).toEqual(explicit);
    await setState(page, { theme: null, scheme: "light", print: false });
    expect(await readColours(page, names, work)).not.toEqual(explicit);
  }
});

test("TH2 System, Light, Dark and print precedence", async ({ page }) => {
  const bg = async (state: Omit<PageState, "work">) => {
    await setState(page, state);
    return page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      scheme: getComputedStyle(document.documentElement).colorScheme,
    }));
  };
  const light = await bg({ theme: null, scheme: "light", print: false });
  const dark = await bg({ theme: null, scheme: "dark", print: false });
  const print = await bg({ theme: "dark", scheme: "dark", print: true });
  expect(new Set([light.bg, dark.bg, print.bg]).size).toBe(3);
  expect(await bg({ theme: "light", scheme: "dark", print: false })).toEqual({
    ...light,
    scheme: "light",
  });
  expect(await bg({ theme: "dark", scheme: "light", print: false })).toEqual(
    dark,
  );
  for (const theme of themes)
    for (const scheme of ["light", "dark"] as const)
      expect((await bg({ theme, scheme, print: true })).bg).toBe(print.bg);
  expect(print.scheme).toBe("light");
});

test("control: a changed token and a dropped print block are caught", async ({
  page,
}) => {
  await page.addStyleTag({
    content: "@layer overrides { :root { --accent: #000001; } }",
  });
  await settle(page);
  const changed = await mismatches(page, {
    theme: null,
    scheme: "light",
    print: false,
    work: false,
  });
  expect(changed).toHaveLength(1);
  expect(changed[0]).toMatch(/^--accent: /u);
  const href = await page
    .locator('link[rel="stylesheet"]')
    .getAttribute("href");
  const css = await (
    await page.request.get(new URL(href ?? "", distUrl).href)
  ).text();
  const cut = css.replace(/@media print\{.*?\}\}/su, "");
  expect(cut).not.toBe(css);
  await page.setContent(
    `<html><head><style>${cut}</style></head><body></body></html>`,
  );
  await settle(page);
  expect(
    await mismatches(page, {
      theme: "dark",
      scheme: "dark",
      print: true,
      work: false,
    }),
  ).not.toEqual([]);
});

/** Pairs below their minimum in one state, from the engine's computed colours. */
async function belowMinimum(
  page: import("@playwright/test").Page,
  state: PageState,
  pairs: Pair[],
) {
  await setState(page, state);
  const names = [...new Set(pairs.flatMap((p) => [p.fg, p.bg]))];
  const colours = await readColours(page, names, state.work);
  return pairs
    .map((p) => ({
      ...p,
      ratio: ratio(colours[p.fg] ?? "", colours[p.bg] ?? ""),
    }))
    .filter((p) => p.ratio < p.min)
    .map(
      (p) =>
        `${label(state)} ${p.kind} ${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)} < ${String(p.min)}`,
    );
}

const contrastStates: PageState[] = [
  { theme: null, scheme: "light", print: false, work: false },
  { theme: "light", scheme: "dark", print: false, work: false },
  { theme: "dark", scheme: "light", print: false, work: false },
  { theme: null, scheme: "dark", print: false, work: false },
  { theme: null, scheme: "light", print: true, work: false },
  { theme: "dark", scheme: "dark", print: true, work: false },
];

test("contrast pairs reach their minimum in light, dark and print", async ({
  page,
}) => {
  const failures: string[] = [];
  for (const state of contrastStates)
    failures.push(...(await belowMinimum(page, state, contrastPairs)));
  for (const theme of [null, "dark"] as const)
    failures.push(
      ...(await belowMinimum(
        page,
        { theme, scheme: "dark", print: false, work: true },
        workPairs,
      )),
    );
  expect(failures).toEqual([]);
});

test("control: contrast thresholds and a decorative line fail", async ({
  page,
}) => {
  const state: PageState = {
    theme: "dark",
    scheme: "light",
    print: false,
    work: false,
  };
  const line = { fg: "--line", bg: "--surface", min: 3, kind: "control" };
  expect(await belowMinimum(page, state, [line])).toHaveLength(1);
  const colours = await readColours(page, ["--muted", "--surface"], false);
  const measured = ratio(colours["--muted"] ?? "", colours["--surface"] ?? "");
  const at = (min: number) => ({
    fg: "--muted",
    bg: "--surface",
    min,
    kind: "control",
  });
  expect(await belowMinimum(page, state, [at(measured + 0.01)])).toHaveLength(
    1,
  );
  expect(await belowMinimum(page, state, [at(measured - 0.01)])).toEqual([]);
});
