import { expect, test, type Locator, type Page } from "@playwright/test";
import { perimeter } from "./indicators.ts";
import { focused, harnessUrl, paintOf, setState, settle } from "./probe.ts";

async function openHarness(page: Page): Promise<void> {
  await page.goto(harnessUrl);
  await expect(page.locator("main[data-harness]")).toBeVisible();
  await settle(page);
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
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
  // A closed Term definition holds a link too, and nothing can focus it.
  const link = page.locator("main a:visible").first();
  await page.locator("body").focus();
  await page.keyboard.press("Shift");
  await link.focus();
  expect(await link.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  return link;
}

const plainLinkPage = `<!doctype html><html lang="en"><title>Link</title>
<a href="#x">link</a></html>`;

async function plainLinkFocusVisible(page: Page): Promise<boolean> {
  await page.setContent(plainLinkPage);
  await settle(page);
  const link = page.getByRole("link");
  await page.locator("body").focus();
  await page.keyboard.press("Shift");
  await link.focus();
  return link.evaluate((el) => el.matches(":focus-visible"));
}

// The paint the focus outline adds, and a floor of half a 2px ring around the link's box.
async function focusPaint(page: Page) {
  const link = await focusLink(page);
  await settle(page);
  const box = await link.boundingBox();
  if (box === null) throw new Error("the focused link has no box");
  const paint = await paintOf(page, link, { "outline-style": "none" });
  return { link, paint, floor: perimeter(box, 0, 2) / 2 };
}

test("the page carries the digest its compiler preflight accepted", async ({
  page,
}) => {
  expect(await page.locator("main").getAttribute("data-preflight")).toMatch(
    /^[0-9a-f]{64}$/u,
  );
});

test("the rendered fixture keeps heading order, anchors, labels and link text", async ({
  page,
}) => {
  expect(
    await page.getByRole("heading", { level: 1 }).allTextContents(),
  ).toEqual(["Fixture Basics"]);
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
  for (const link of links) {
    const name = ((await link.textContent()) ?? "").trim();
    expect(
      await link.and(page.getByRole("link", { name, exact: true })).count(),
    ).toBe(1);
  }
});

// The box of a rendered part, which must lie inside the page width at every project's size.
async function insidePage(page: Page, part: Locator): Promise<void> {
  expect(await part.isVisible()).toBe(true);
  const box = await part.boundingBox();
  const width = page.viewportSize()?.width;
  if (box === null || width === undefined) throw new Error("a part has no box");
  expect(box.width).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}

test("every card shows its heading and labelled fields inside the page width", async ({
  page,
}) => {
  const headings = page.locator('h4[id^="card-"]');
  expect(await headings.count()).toBe(3);
  const lists = page.locator("h4 + dl");
  expect(await lists.count()).toBe(3);
  expect(await lists.first().locator("> dt").allTextContents()).toEqual([
    "Reach for",
    "Build",
    "Why",
    "Traps",
    "Also",
  ]);
  expect(await lists.last().locator("> dt").allTextContents()).toEqual([
    "Reach for",
    "Build",
    "Why",
  ]);
  for (const part of await page
    .locator('h4[id^="card-"], dl > dt, dl > dd > :first-child')
    .all())
    await insidePage(page, part);
  for (const value of await page.locator("dl > dd").all())
    expect(await value.locator("[data-block-id]").count()).toBeGreaterThan(0);
});

test("glossary and error entries show their headings and labelled parts", async ({
  page,
}) => {
  const ids = [
    "term-fixture-loop",
    "term-fixture-set",
    "err-fixture-cs0165",
    "err-fixture-null",
    "err-fixture-off-by-one",
  ];
  for (const id of ids) {
    const heading = page.locator(`h2[id="${id}"]`);
    await insidePage(page, heading);
    expect(((await heading.textContent()) ?? "").trim()).not.toBe("");
  }
  for (const name of ["Cause", "Hint"])
    expect(
      await page.getByRole("heading", { level: 3, name, exact: true }).count(),
    ).toBe(3);
  for (const label of ["You wrote", "You got"]) {
    const labels = page.locator("p > strong", { hasText: label });
    expect(await labels.count()).toBe(3);
    for (const one of await labels.all()) await insidePage(page, one);
  }
  const errorLinks = page.locator('a[href^="/errors#"]');
  expect(await errorLinks.count()).toBeGreaterThan(0);
  for (const link of await errorLinks.all()) {
    const id = ((await link.getAttribute("href")) ?? "").slice(
      "/errors#".length,
    );
    expect(ids).toContain(id);
  }
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
    await settle(page);
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
    expect(
      await plainLinkFocusVisible(page),
      "a plain link matches :focus-visible",
    ).toBe(true);
    await openHarness(page);
    await setState(page, { theme, scheme: theme, print: false });
    const { paint, floor } = await focusPaint(page);
    expect(paint).toBeGreaterThanOrEqual(floor);
  });

test("forced colours keep link text and its focus outline visible", async ({
  page,
}) => {
  expect(
    await plainLinkFocusVisible(page),
    "a plain link matches :focus-visible",
  ).toBe(true);
  await openHarness(page);
  await page.emulateMedia({ forcedColors: "active" });
  await settle(page);
  expect(
    await page.evaluate(() => matchMedia("(forced-colors: active)").matches),
  ).toBe(true);
  const { link, paint, floor } = await focusPaint(page);
  expect(paint).toBeGreaterThanOrEqual(floor);
  await link.evaluate((el) => {
    (el as HTMLElement).blur();
  });
  await settle(page);
  expect(await paintOf(page, link, { visibility: "hidden" })).toBeGreaterThan(
    0,
  );
});

test("control: a focused link without an outline fails the paint check", async ({
  page,
}) => {
  expect(
    await plainLinkFocusVisible(page),
    "a plain link matches :focus-visible",
  ).toBe(true);
  await openHarness(page);
  await page.addStyleTag({ content: "a { outline-style: none !important; }" });
  await settle(page);
  const { paint, floor } = await focusPaint(page);
  expect(paint).toBeLessThan(floor);
});

const buildSection = (page: Page, id: string): Locator =>
  page.locator(`section[data-section-id="${id}"]`);

// Found by structure, so the paint check can still reach a button it has hidden.
const approachButton = (section: Locator, name: string): Locator =>
  section
    .locator('[role="group"][aria-label="Build approaches"] > button')
    .filter({ hasText: new RegExp(`^${name}$`, "u") });

test("an approach picker mounts the chosen approach and keeps focus on its button", async ({
  page,
}) => {
  const section = buildSection(page, "build-fix-total");
  const other = buildSection(page, "build-fix-three");
  const library = approachButton(section, "the library");
  const loop = approachButton(section, "a loop");
  expect(await section.getByRole("button").count()).toBe(2);
  expect(await other.getByRole("button").count()).toBe(3);
  expect(await section.locator("h4").count()).toBe(0);
  for (const button of [library, loop]) {
    expect(await button.getAttribute("aria-pressed")).toBe("false");
    await insidePage(page, button);
  }
  await library.focus();
  await page.keyboard.press("Enter");
  expect(await focused(library)).toBe(true);
  await expect(library).toHaveAttribute("aria-pressed", "true");
  expect(await section.locator("h4").getAttribute("id")).toBe("build-fix-sum");
  await settle(page);
  await insidePage(page, section.locator("h4"));
  await loop.focus();
  await page.keyboard.press("Space");
  expect(await focused(loop)).toBe(true);
  await expect(loop).toHaveAttribute("aria-pressed", "true");
  expect(await library.getAttribute("aria-pressed")).toBe("false");
  expect(await section.locator("h4").count()).toBe(1);
  expect(await section.locator("h4").getAttribute("id")).toBe("build-fix-loop");
  expect(await other.locator("h4").count()).toBe(0);
  await settle(page);
  expect(await structureProblems(page)).toEqual([]);
});

test("forced colours tell the pressed approach apart without colour", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  const section = buildSection(page, "build-fix-three");
  const second = approachButton(section, "second, with a comma");
  const third = approachButton(section, "third");
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await settle(page);
  const line = (button: Locator) =>
    button.evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(await line(second)).toBe("underline");
  expect(await line(third)).toBe("none");
  for (const button of [second, third]) {
    await insidePage(page, button);
    expect(
      await paintOf(page, button, { visibility: "hidden" }),
    ).toBeGreaterThan(0);
  }
});

// Every text the fixture's ladders hide: headings, techniques, pattern titles and rungs.
const hiddenHints = [
  "Count every word first",
  "Track what came back",
  "tally first",
  "seen set",
  "Two passes",
  "Remember what was seen",
  "call it lone",
  "met again",
];
const firstCue =
  "You want the first word of a sentence that no other word repeats.";
const secondCue =
  "You want the earliest word in a sentence that appears just once.";

async function hintsExposed(page: Page): Promise<string> {
  const exposed = await page.evaluate(() =>
    [
      document.body.textContent,
      ...[...document.querySelectorAll("*")].flatMap((e) =>
        [...e.attributes].map((a) => a.value),
      ),
    ].join("\n"),
  );
  return `${exposed}\n${await page.locator("body").ariaSnapshot()}`;
}

test("a hint picker shows one cue at a time and nothing its ladders hide", async ({
  page,
}) => {
  const group = page.locator('[role="group"][aria-label="Hint approaches"]');
  const first = group.locator("> button").filter({ hasText: /^Approach A$/u });
  const second = group.locator("> button").filter({ hasText: /^Approach B$/u });
  const cues = page.locator(
    'section[data-section-id^="ladder-"] > p[data-block-id]',
  );
  expect(await group.locator("> button").count()).toBe(2);
  expect(await cues.count()).toBe(0);
  for (const button of [first, second]) {
    expect(await button.getAttribute("aria-pressed")).toBe("false");
    await insidePage(page, button);
  }
  for (const text of [...hiddenHints, firstCue, secondCue])
    expect(await hintsExposed(page)).not.toContain(text);
  await first.focus();
  await page.keyboard.press("Enter");
  expect(await focused(first)).toBe(true);
  await expect(first).toHaveAttribute("aria-pressed", "true");
  expect(await cues.allTextContents()).toEqual([firstCue]);
  expect(await cues.getAttribute("data-block-id")).toBe("ladder-lone-word/b1");
  await settle(page);
  await insidePage(page, cues);
  await second.focus();
  await page.keyboard.press("Space");
  expect(await focused(second)).toBe(true);
  await expect(second).toHaveAttribute("aria-pressed", "true");
  expect(await first.getAttribute("aria-pressed")).toBe("false");
  expect(await cues.allTextContents()).toEqual([secondCue]);
  expect(await cues.getAttribute("data-block-id")).toBe(
    "ladder-lone-word-alt/b1",
  );
  await settle(page);
  const exposed = await hintsExposed(page);
  for (const text of [...hiddenHints, firstCue])
    expect(exposed).not.toContain(text);
  expect(await structureProblems(page)).toEqual([]);
});
