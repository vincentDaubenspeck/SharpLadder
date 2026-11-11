import { expect, test, type Locator, type Page } from "@playwright/test";
import { perimeter } from "./indicators.ts";
import { harnessUrl, paintOf, setState } from "./probe.ts";

test.beforeEach(async ({ page }) => {
  await page.goto(harnessUrl);
  await expect(page.locator("main[data-harness]")).toBeVisible();
});

/**
 * What the rendered page breaks of the content structure rules, read from the live DOM: heading
 * order from the page's own h1, unique ids, same-page links reaching a content anchor, label
 * references resolving to visible text, and links named by their own text.
 */
async function structureProblems(page: Page): Promise<string[]> {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const levels = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(
      (h) => Number(h.tagName.slice(1)),
    );
    if (levels[0] !== 1) found.push("headings: the first heading is not h1");
    if (levels.filter((l) => l === 1).length !== 1)
      found.push("headings: the page has other than one h1");
    for (const [i, level] of levels.entries())
      if (i > 0 && level > (levels[i - 1] ?? 0) + 1)
        found.push(`headings: h${String(level)} skips a level`);
    const ids = [...document.querySelectorAll("[id]")];
    if (new Set(ids.map((e) => e.id)).size !== ids.length)
      found.push("ids: an id repeats");
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const id = decodeURIComponent((a.getAttribute("href") ?? "").slice(1));
      const target = document.getElementById(id);
      if (target === null || target.tagName === "SPAN")
        found.push(`links: #${id} reaches no content anchor`);
    }
    for (const pre of document.querySelectorAll("pre[aria-labelledby]")) {
      const id = pre.getAttribute("aria-labelledby") ?? "";
      const label = document.getElementById(id);
      if (label === null || label.textContent.trim() === "")
        found.push(`labels: ${id} names no visible label`);
      else if (label.getClientRects().length === 0)
        found.push(`labels: ${id} is not rendered`);
    }
    return found;
  });
  for (const link of await page.getByRole("link").all()) {
    const text = ((await link.textContent()) ?? "").trim();
    const href = (await link.getAttribute("href")) ?? "";
    if (text === "" || text === href)
      problems.push(`links: ${href} has no text of its own`);
  }
  return problems;
}

/**
 * Focuses the first link after a key press, so :focus-visible applies as it would for a keyboard
 * user; WebKit leaves links out of the Tab order by default, so Tab alone cannot reach them.
 */
async function focusLink(page: Page): Promise<Locator> {
  const link = page.locator("main a").first();
  await page.locator("body").focus();
  await page.keyboard.press("Shift");
  await link.focus();
  expect(await link.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  return link;
}

// The paint the focus outline adds, and a floor of half a 2px ring around the link's box.
async function focusPaint(page: Page) {
  const link = await focusLink(page);
  const box = await link.boundingBox();
  if (box === null) throw new Error("the focused link has no box");
  const paint = await paintOf(page, link, { "outline-style": "none" });
  return { link, paint, floor: perimeter(box, 0, 2) / 2 };
}

test("the page carries the digest its compiler preflight accepted", async ({
  page,
}) => {
  await expect(page.locator("main")).toHaveAttribute(
    "data-preflight",
    /^[0-9a-f]{64}$/u,
  );
});

test("the rendered fixture keeps heading order, anchors, labels and link text", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText([
    "Fixture Basics",
  ]);
  expect(await page.getByRole("heading").count()).toBeGreaterThan(3);
  expect(await page.locator('a[href^="#"]').count()).toBeGreaterThan(0);
  expect(await page.locator("pre[aria-labelledby]").count()).toBeGreaterThan(0);
  expect(
    await page.locator("pre:not([aria-labelledby])").count(),
  ).toBeGreaterThan(0);
  expect(await structureProblems(page)).toEqual([]);
});

test("every link's accessible name is its own text", async ({ page }) => {
  const links = await page.getByRole("link").all();
  expect(links.length).toBeGreaterThan(0);
  for (const link of links)
    await expect(link).toHaveAccessibleName(
      ((await link.textContent()) ?? "").trim(),
    );
});

const controls: [string, string, string][] = [
  [
    "a skipped heading level",
    `document.querySelector("h2")?.after(Object.assign(document.createElement("h4"), { textContent: "x" }))`,
    "headings: h4 skips a level",
  ],
  [
    "a second h1",
    `document.querySelector("main")?.append(Object.assign(document.createElement("h1"), { textContent: "x" }))`,
    "headings: the page has other than one h1",
  ],
  [
    "a repeated id",
    `document.querySelector("main")?.append(Object.assign(document.createElement("div"), { id: document.querySelector("h2")?.id ?? "", textContent: "x" }))`,
    "ids: an id repeats",
  ],
  [
    "a link to a missing anchor",
    `document.querySelector('a[href^="#"]')?.setAttribute("href", "#absent")`,
    "links: #absent reaches no content anchor",
  ],
  [
    "a label reference to a missing id",
    `document.querySelector("pre[aria-labelledby]")?.setAttribute("aria-labelledby", "absent")`,
    "labels: absent names no visible label",
  ],
  [
    "a link whose text is its address",
    `(() => { const a = document.querySelector('a[href^="#"]'); if (a) a.textContent = a.getAttribute("href"); })()`,
    "has no text of its own",
  ],
];

for (const [name, script, problem] of controls)
  test(`control: ${name} fails the structure check`, async ({ page }) => {
    await page.evaluate(script);
    const problems = await structureProblems(page);
    expect(
      problems.some((p) => p.includes(problem)),
      problems.join("; "),
    ).toBe(true);
  });

for (const theme of ["light", "dark"] as const)
  test(`a focused link paints a visible outline in the ${theme} theme`, async ({
    page,
  }) => {
    await setState(page, { theme, scheme: theme, print: false });
    const { paint, floor } = await focusPaint(page);
    expect(paint).toBeGreaterThanOrEqual(floor);
  });

test("forced colours keep link text and its focus outline visible", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  expect(
    await page.evaluate(() => matchMedia("(forced-colors: active)").matches),
  ).toBe(true);
  const { link, paint, floor } = await focusPaint(page);
  expect(paint).toBeGreaterThanOrEqual(floor);
  await link.evaluate((el) => {
    (el as HTMLElement).blur();
  });
  expect(await paintOf(page, link, { visibility: "hidden" })).toBeGreaterThan(
    0,
  );
});

test("control: a focused link without an outline fails the paint check", async ({
  page,
}) => {
  await page.addStyleTag({ content: "a { outline-style: none !important; }" });
  const { paint, floor } = await focusPaint(page);
  expect(paint).toBeLessThan(floor);
});
