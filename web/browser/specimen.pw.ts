import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { environments, host, type Environment } from "./fonts.ts";
import {
  indicators,
  judge,
  perimeter,
  resize,
  setTheme,
  spec,
  tabTo,
  type Indicators,
} from "./indicators.ts";
import { themes } from "./group-d.ts";
import {
  applyEnvironment,
  paintOf,
  setState,
  settle,
  specimenUrl,
} from "./probe.ts";

// Observed per engine at the pinned versions; a change in either direction fails and is reviewed.
const forcedEmulation: Record<string, boolean> = {
  chromium: true,
  firefox: true,
  webkit: true,
};

// Whether the emulation also repaints with system colours, observed per engine.
const forcedRemap: Record<string, boolean> = {
  chromium: true,
  firefox: true,
  webkit: false,
};

const engineOf = (info: TestInfo) => String(info.project.metadata["engine"]);

const envs = environments(host().platform);

// A family no environment can resolve, so its rendering is the engine's last resort.
const control = "sl-control-absent-family";

/**
 * Puts the specimen in one named font environment and proves it: each shipped face the
 * environment expects has loaded, and the specimen's text and code render the expected family
 * (the same advances as that family alone), not the last-resort control.
 */
async function inEnvironment(page: Page, env: Environment) {
  await page.goto(specimenUrl);
  await expect(spec(page, "dst")).toBeVisible();
  await settle(page);
  await applyEnvironment(page, env);
  await settle(page);
  const roles = [
    { tag: "span", want: env.expect.ui },
    { tag: "code", want: env.expect.code },
  ];
  await page.evaluate(
    ({ roles, control }) => {
      roles.forEach(({ tag, want }, i) => {
        const kinds = [
          { kind: "stack", family: null },
          { kind: "alone", family: `"${want.family}"` },
          { kind: "control", family: `"${control}"` },
        ];
        for (const { kind, family } of kinds) {
          const element = document.createElement(tag);
          element.dataset["envProbe"] = `${String(i)}-${kind}`;
          element.style.cssText =
            "position:absolute;left:0;top:0;white-space:pre;font-size:100px;";
          if (family !== null) element.style.fontFamily = family;
          element.textContent = "Grow Marvel 0137@&?";
          document.body.append(element);
        }
      });
    },
    { roles, control },
  );
  await settle(page);
  const proof = await page.evaluate(
    (roles) =>
      roles.map(({ want }, i) => {
        const width = (kind: string) => {
          const element = document.querySelector(
            `[data-env-probe="${String(i)}-${kind}"]`,
          );
          if (element === null)
            throw new Error(`probe ${String(i)}-${kind} missing`);
          return element.getBoundingClientRect().width;
        };
        const face = Array.from(document.fonts).find(
          (font) => font.family.replace(/^"|"$/g, "") === want.family,
        );
        return {
          family: want.family,
          status: want.kind === "shipped" ? (face?.status ?? "absent") : null,
          stack: width("stack"),
          alone: width("alone"),
          control: width("control"),
        };
      }),
    roles,
  );
  await page.evaluate(() => {
    document.querySelectorAll("[data-env-probe]").forEach((element) => {
      element.remove();
    });
  });
  await settle(page);
  for (const row of proof) {
    const where = `${env.name} ${row.family}`;
    if (row.status !== null) expect(row.status, where).toBe("loaded");
    expect(row.stack, `${where}: renders the expected family`).toBe(row.alone);
    expect(row.stack, `${where}: differs from the control`).not.toBe(
      row.control,
    );
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(specimenUrl);
  await expect(spec(page, "dst")).toBeVisible();
  await settle(page);
});

test("the engine is the pinned build", ({ browser }, info) => {
  expect(browser.version()).toBe(info.project.metadata["version"]);
});

test("TH3 two modules with the same local class render distinct styles", async ({
  page,
}) => {
  const a = spec(page, "iso-a");
  const b = spec(page, "iso-b");
  const [ca, cb] = [
    await a.getAttribute("class"),
    await b.getAttribute("class"),
  ];
  expect(ca).toMatch(/_box$/u);
  expect(cb).toMatch(/_box$/u);
  expect(ca).not.toBe(cb);
  const colour = (l: typeof a) =>
    l.evaluate((el) => getComputedStyle(el).color);
  expect(await colour(a)).not.toBe(await colour(b));
  // Control: one global class shared by both, as an unscoped sheet would give.
  await page.setContent(
    "<style>.box{color:#286773}.box{color:#95533f}</style><div class=box id=a>A</div><div class=box id=b>B</div>",
  );
  await settle(page);
  const same = await page.evaluate(() =>
    ["a", "b"].map(
      (id) =>
        getComputedStyle(document.getElementById(id) ?? document.body).color,
    ),
  );
  expect(same[0]).toBe(same[1]);
});

/** The layered rule wins over base when the components value reaches the element. */
async function layeredWins(page: Page) {
  return page.evaluate(() => {
    const layered = document.querySelector('[data-spec="order"]');
    const plain = document.querySelector('[data-spec="plain"]');
    if (layered === null || plain === null) throw new Error("specimen missing");
    return (
      getComputedStyle(layered).fontFamily !==
      getComputedStyle(plain).fontFamily
    );
  });
}

test("TH3 layer precedence holds with the imports reversed", async ({
  page,
}) => {
  const want = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.setProperty("font-family", "var(--font-ui)");
    document.body.append(probe);
    const value = getComputedStyle(probe).fontFamily;
    probe.remove();
    return value;
  });
  await settle(page);
  expect(
    await spec(page, "order").evaluate((el) => getComputedStyle(el).fontFamily),
  ).toBe(want);
  expect(await layeredWins(page)).toBe(true);
});

test("control: an unlayered rule, a lower-layer !important and no layer statement each beat the module", async ({
  page,
}) => {
  await page.addStyleTag({ content: "code { font-family: serif; }" });
  await settle(page);
  expect(await layeredWins(page)).toBe(false);
  await page.reload();
  await expect(spec(page, "dst")).toBeVisible();
  await page.addStyleTag({
    content: "@layer base { code { font-family: serif !important; } }",
  });
  await settle(page);
  expect(await layeredWins(page)).toBe(false);
  await page.setContent(
    `<style>@layer components{.c{font-family:serif}}@layer base{code{font-family:monospace}}</style>
<code data-spec="order" class="c">x</code><code data-spec="plain">y</code>`,
  );
  await settle(page);
  expect(await layeredWins(page)).toBe(false);
});

for (const env of envs)
  test(`TH4 focus, rings, strokes and state shapes paint in every theme (${env.name})`, async ({
    page,
  }, info) => {
    await inEnvironment(page, env);
    const matrix: Record<string, Indicators> = {};
    const fails: string[] = [];
    for (const theme of themes)
      for (const scheme of ["light", "dark"] as const) {
        await setState(page, { theme, scheme, print: false });
        const key = `${theme ?? "absent"}/${scheme}`;
        matrix[key] = await indicators(page);
        fails.push(...judge(matrix[key]).map((f) => `${key}: ${f}`));
      }
    await info.attach(`th4-matrix-${env.name}.json`, {
      body: JSON.stringify(matrix, null, 2),
      contentType: "application/json",
    });
    expect(fails).toEqual([]);
  });

test("TH4 focus outline computes as 2px solid accent at offset 2px", async ({
  page,
}) => {
  await tabTo(page, "focus");
  const got = await spec(page, "focus").evaluate((el) => {
    const s = getComputedStyle(el);
    const probe = document.createElement("div");
    probe.style.setProperty("color", "var(--accent)");
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return [
      s.outlineStyle,
      s.outlineWidth,
      s.outlineOffset,
      s.outlineColor === accent,
    ];
  });
  expect(got).toEqual(["solid", "2px", "2px", true]);
});

test("control: each indicator check fails when its paint is gone, and the rest-state check fails when a visible stroke is present", async ({
  page,
}) => {
  // The tab rule adds a visible rest stroke; it proves neither paint removal nor selection geometry.
  await page.addStyleTag({
    content: `@layer overrides {
  [data-spec] { outline-style: none !important; }
  [data-spec="stroke"] { border-inline-start-color: transparent !important; }
  [data-spec="tab"] { border-block-end: 2px solid currentcolor !important; }
  [data-spec="dst"] { border-style: solid !important; }
  [data-spec="panel"] { padding: 0 !important; }
}`,
  });
  const fails = judge(await indicators(page));
  for (const key of [
    "focusOutline",
    "nestedFocus",
    "nestedRing",
    "clippedFocus",
    "rungRing",
    "readRing",
    "stroke",
    "restBorder",
    "sourceVsDestination",
  ])
    expect(fails.some((f) => f.startsWith(key))).toBe(true);
});

test("control: an outline clipped by its scroll panel fails", async ({
  page,
}) => {
  await page.addStyleTag({
    content:
      '@layer overrides { [data-spec="panel"] { padding: 0 !important; } }',
  });
  await tabTo(page, "clipped");
  const clipped = spec(page, "clipped");
  const box = await clipped.boundingBox();
  if (box === null) throw new Error("no clipped box");
  expect(
    (await paintOf(page, clipped, { "outline-style": "none" })) /
      perimeter(box, 2, 2),
  ).toBeLessThan(0.6);
});

/** Every element whose right edge passes the viewport, named so a failure says which. */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.body.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > limit)
      .map((el) => `${el.tagName}${el.getAttribute("data-spec") ?? ""}`);
  });

/** Resizes to the phone width and returns the viewport width and anything that overflows it. */
async function reflowAt390(page: Page) {
  await resize(page, { width: 390, height: 844 });
  return {
    width: await page.evaluate(() => document.documentElement.clientWidth),
    overflow: await overflow(page),
  };
}

for (const env of envs)
  test(`TH4 reflow at 390 and the backdrop blur support record (${env.name})`, async ({
    page,
  }, info) => {
    await inEnvironment(page, env);
    expect(await reflowAt390(page)).toEqual({ width: 390, overflow: [] });
    const blur = await page.evaluate(() => ({
      standard: CSS.supports("backdrop-filter", "blur(0.625rem)"),
      prefixed: CSS.supports("-webkit-backdrop-filter", "blur(0.625rem)"),
    }));
    info.annotations.push({
      type: "blur(0.625rem)",
      description: JSON.stringify(blur),
    });
    expect(blur.standard || blur.prefixed).toBe(true);
    // Control: a fixed-width block wider than the phone viewport overflows.
    await page.evaluate(() => {
      const wide = document.createElement("div");
      wide.style.setProperty("inline-size", "30rem");
      document.body.append(wide);
    });
    await settle(page);
    expect(await overflow(page)).not.toEqual([]);
  });

/**
 * Every Group D cell under emulated forced colours: light and dark scheme, each theme attribute,
 * at 1920 and 390. Null when the engine does not detect the emulation (recorded per engine).
 */
async function forcedMatrix(page: Page, info: TestInfo) {
  const engine = engineOf(info);
  await page.emulateMedia({ forcedColors: "active" });
  await settle(page);
  const active = await page.evaluate(
    () => matchMedia("(forced-colors: active)").matches,
  );
  expect(active).toBe(forcedEmulation[engine]);
  if (!active) return null;
  const matrix: Record<string, Indicators> = {};
  const fails: string[] = [];
  for (const width of [1920, 390]) {
    await resize(page, { width, height: width === 390 ? 844 : 1080 });
    for (const theme of themes)
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({
          forcedColors: "active",
          colorScheme: scheme,
          media: "screen",
        });
        await setTheme(page, theme);
        const key = `${String(width)}/${theme ?? "absent"}/${scheme}`;
        matrix[key] = await indicators(page);
        fails.push(...judge(matrix[key]).map((f) => `${key}: ${f}`));
      }
  }
  return { matrix, fails };
}

for (const env of envs)
  test(`Group D forced colours: every indicator stays visible, light and dark, all themes, 1920 and 390 (${env.name})`, async ({
    page,
  }, info) => {
    await inEnvironment(page, env);
    const result = await forcedMatrix(page, info);
    if (result === null) {
      info.annotations.push({
        type: "unsupported",
        description: `${engineOf(info)}: forced-colours emulation not detected`,
      });
      return;
    }
    await info.attach(`group-d-matrix-${env.name}.json`, {
      body: JSON.stringify(result.matrix, null, 2),
      contentType: "application/json",
    });
    expect(result.fails).toEqual([]);
  });

// How each engine sets the browser default font size (not the html font-size); Playwright has none for WebKit.
const defaultFont: Record<string, "devtools" | "prefs" | null> = {
  chromium: "devtools",
  firefox: "prefs",
  webkit: null,
};
const enlarged = 20;

for (const env of envs)
  test(`Group D enlarged browser default font: indicators and reflow hold (${env.name})`, async ({
    page,
    playwright,
    launchOptions,
  }, info) => {
    const engine = engineOf(info);
    const how = defaultFont[engine];
    if (how === undefined) throw new Error(`unrecorded engine ${engine}`);
    if (how === null) {
      info.annotations.push({
        type: "unsupported",
        description: `${engine}: no browser default font size setting is exposed`,
      });
      return;
    }
    let target = page;
    let own: Browser | null = null;
    // The DevTools session stays open for the test, since the setting belongs to it.
    const session =
      how === "devtools" ? await page.context().newCDPSession(page) : null;
    try {
      if (session !== null)
        await session.send("Page.setFontSizes", {
          fontSizes: { standard: enlarged },
        });
      else {
        const launched = await playwright.firefox.launch({
          ...launchOptions,
          firefoxUserPrefs: { "font.size.variable.x-western": enlarged },
        });
        own = launched;
        expect(
          launched.version(),
          "the relaunched engine is the pinned build",
        ).toBe(info.project.metadata["version"]);
        const use = info.project.use;
        target = await launched.newPage({
          viewport: use.viewport ?? null,
          ...(use.deviceScaleFactor === undefined
            ? {}
            : { deviceScaleFactor: use.deviceScaleFactor }),
          ...(use.locale === undefined ? {} : { locale: use.locale }),
          colorScheme: "light",
          reducedMotion: "reduce",
        });
      }
      await inEnvironment(target, env);
      expect(
        await target.evaluate(
          () => getComputedStyle(document.documentElement).fontSize,
        ),
        "the browser default font size took effect",
      ).toBe(`${String(enlarged)}px`);
      const result = await forcedMatrix(target, info);
      expect(result, `${engine}: forced-colours emulation`).not.toBeNull();
      await target.emulateMedia({ forcedColors: "none" });
      const reflow = await reflowAt390(target);
      await info.attach(`group-d-default-font-${env.name}.json`, {
        body: JSON.stringify({ enlarged, reflow, ...result }, null, 2),
        contentType: "application/json",
      });
      expect(result?.fails).toEqual([]);
      expect(reflow).toEqual({ width: 390, overflow: [] });
    } finally {
      await session?.detach();
      await own?.close();
    }
  });

test("control: under forced colours a shadow-only state and a hue-only state vanish", async ({
  page,
}, info) => {
  await page.emulateMedia({ forcedColors: "active" });
  await settle(page);
  if (
    !(await page.evaluate(() => matchMedia("(forced-colors: active)").matches))
  ) {
    expect(forcedEmulation[engineOf(info)]).toBe(false);
    info.annotations.push({
      type: "unsupported",
      description: "forced-colours emulation not detected",
    });
    return;
  }
  // The state is switched on by a shadow alone, or by a border hue alone.
  await page.addStyleTag({
    content: '@layer overrides { [data-spec="rung"] { outline: none; } }',
  });
  await settle(page);
  const shadowOn = { "box-shadow": "0 0 0 4px #286773" };
  // WebKit matches the emulated query but repaints nothing, so its cells are unsupported.
  if (!forcedRemap[engineOf(info)]) {
    expect(await paintOf(page, spec(page, "rung"), shadowOn)).toBeGreaterThan(
      0,
    );
    info.annotations.push({
      type: "unsupported",
      description: "forced-colours emulation detected without remapping",
    });
    return;
  }
  const hueOn = { "border-color": "#95533f" };
  expect(await paintOf(page, spec(page, "rung"), shadowOn)).toBe(0);
  expect(await paintOf(page, spec(page, "dst"), hueOn, 0)).toBe(0);
  // The same two changes are visible without forced colours, so the zero is the mode's doing.
  await page.emulateMedia({ forcedColors: "none" });
  await settle(page);
  expect(await paintOf(page, spec(page, "rung"), shadowOn)).toBeGreaterThan(0);
  expect(await paintOf(page, spec(page, "dst"), hueOn, 0)).toBeGreaterThan(0);
});
