import { expect } from "@playwright/test";
import { test } from "./fixture.ts";
import {
  contexts,
  expectedTokens,
  tokenProbes,
  type PageState,
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

// No token reads the viewport width (widthQueries holds that), so the phones would repeat desktop.
test(
  "TH1 every token in every state equals the catalogue",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
    expect(probes).toHaveLength(186);
    const failures: string[] = [];
    for (const state of states)
      for (const line of await mismatches(page, state))
        failures.push(`${label(state)}: ${line}`);
    expect(failures).toEqual([]);
  },
);

test(
  "TH1/TH5 parity: both dark selectors give the same computed set",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
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
  },
);

test(
  "TH2 System, Light, Dark and print precedence",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
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
  },
);

// Each engine's own reading is held to the catalogue by TH1; this proves only the comparison bites.
test(
  "control: a changed token and a dropped print block are caught",
  {
    tag: "@single",
  },
  async ({ page }) => {
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
  },
);
