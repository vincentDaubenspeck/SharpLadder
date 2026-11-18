import { expect, type Locator, type Page } from "@playwright/test";
import { scan } from "./axe.ts";
import { test } from "./fixture.ts";
import { perimeter, resize } from "./indicators.ts";
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

test(
  "the rendered fixture keeps heading order, anchors, labels and link text",
  {
    tag: "@single",
  },
  async ({ page }) => {
    expect(
      await page.getByRole("heading", { level: 1 }).allTextContents(),
    ).toEqual(["Fixture Basics"]);
    expect(await page.getByRole("heading").count()).toBeGreaterThan(3);
    expect(await page.locator('a[href^="#"]').count()).toBeGreaterThan(0);
    expect(await page.locator("pre[aria-labelledby]").count()).toBeGreaterThan(
      0,
    );
    expect(
      await page.locator("pre:not([aria-labelledby])").count(),
    ).toBeGreaterThan(0);
    expect(await structureProblems(page)).toEqual([]);
  },
);

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

// The check reads only the DOM, so one engine proves it is not vacuous.
test(
  "control: each structure fault fails the structure check",
  {
    tag: "@single",
  },
  async ({ page }) => {
    for (const [name, script, problem] of controls) {
      await openHarness(page);
      await page.evaluate(script);
      await settle(page);
      const problems = await structureProblems(page);
      expect(
        problems.some((p) => p.includes(problem)),
        `${name}: ${problems.join("; ")}`,
      ).toBe(true);
    }
  },
);

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

// Each desktop engine paints its own ring, so the check must fail without one in each.
test(
  "control: a focused link without an outline fails the paint check",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
    expect(
      await plainLinkFocusVisible(page),
      "a plain link matches :focus-visible",
    ).toBe(true);
    await openHarness(page);
    await page.addStyleTag({
      content: "a { outline-style: none !important; }",
    });
    await settle(page);
    const { paint, floor } = await focusPaint(page);
    expect(paint).toBeLessThan(floor);
  },
);

const buildSection = (page: Page, id: string): Locator =>
  page.locator(`section[data-section-id="${id}"]`);

// Found by structure, so the paint check can still reach a button it has hidden.
const approachButton = (section: Locator, name: string): Locator =>
  section
    .locator('[role="group"][aria-label="Build approaches"] > button')
    .filter({ hasText: new RegExp(`^${name}$`, "u") });

test(
  "an approach picker mounts the chosen approach and keeps focus on its button",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
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
    expect(await section.locator("h4").getAttribute("id")).toBe(
      "build-fix-sum",
    );
    await settle(page);
    await insidePage(page, section.locator("h4"));
    await loop.focus();
    await page.keyboard.press("Space");
    expect(await focused(loop)).toBe(true);
    await expect(loop).toHaveAttribute("aria-pressed", "true");
    expect(await library.getAttribute("aria-pressed")).toBe("false");
    expect(await section.locator("h4").count()).toBe(1);
    expect(await section.locator("h4").getAttribute("id")).toBe(
      "build-fix-loop",
    );
    expect(await other.locator("h4").count()).toBe(0);
    await settle(page);
    expect(await structureProblems(page)).toEqual([]);
  },
);

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

// Found by structure: a walk-through stepper is the one div with an id and no block hook.
const stepperRoots = "main div[id]:not([data-block-id])";
const steppers = (page: Page): Locator => page.locator(stepperRoots);
const stepperOf = (page: Page, walkId: string): Locator =>
  page.locator(`${stepperRoots}[id=${JSON.stringify(walkId)}]`);
const stepButton = (stepper: Locator, name: "Prev" | "Next"): Locator =>
  stepper.locator("> button").filter({ hasText: new RegExp(`^${name}$`, "u") });
const stepText = (stepper: Locator): Locator =>
  stepper.locator("> p:not([data-block-id]):not([aria-live])");
const liveRegion = (stepper: Locator): Locator =>
  stepper.locator('> p[aria-live="polite"]');
const sequenceButtons = (stepper: Locator): Locator =>
  stepper.locator('> [role="group"][aria-label="Walk sequences"] > button');

// Every shown walk's step text and live region, by walk id, in one read.
const walkStates = (page: Page) =>
  steppers(page).evaluateAll((roots) =>
    Object.fromEntries(
      roots.map((root) => [
        root.id,
        {
          step:
            root.querySelector(
              ":scope > p:not([data-block-id]):not([aria-live])",
            )?.textContent ?? null,
          region:
            root.querySelector(':scope > p[aria-live="polite"]')?.textContent ??
            null,
        },
      ]),
    ),
  );

// Before any approach is picked; the build's own walk shows only with its approach.
const shownWalks = [
  "walk-fix-intro",
  "walk-fix-parts",
  "walk-fix-shift",
  "walk-fix-nest",
  "walk-fix-short",
  "walk-fix-easy",
  "walk-fix-set",
  "walk-fix-shape",
  "walk-fix-null",
];
const atStart = Object.fromEntries(
  shownWalks.map((walkId) => [walkId, { step: "Start", region: "" }]),
);

// The page's channel for a position set from outside the walk, as an owning page would set it.
async function moveFromOutside(
  page: Page,
  detail: { walkId: string; sequence: number; step: number },
): Promise<void> {
  await page.evaluate((move) => {
    window.dispatchEvent(
      new CustomEvent("sharpladder-walk-position", { detail: move }),
    );
  }, detail);
}

// Focus is read before the key as well as after, so a key that moved it cannot pass unseen.
async function pressOn(button: Locator, key: string): Promise<void> {
  expect(await focused(button), `focus is on the button before ${key}`).toBe(
    true,
  );
  await button.page().keyboard.press(key);
  expect(await focused(button), `focus stays on the button after ${key}`).toBe(
    true,
  );
}

const plainButtonsPage = `<!doctype html><html lang="en"><title>Buttons</title>
<button type="button" id="first">first</button>
<button type="button" id="second" aria-disabled="true">second</button></html>`;

// WebKit leaves buttons out of the Tab order on some platforms, so Tab is first measured on a
// plain button marked unavailable, as Prev is at Start.
async function tabReachesPlainButton(page: Page): Promise<boolean> {
  await page.setContent(plainButtonsPage);
  await page.locator("#first").focus();
  await page.keyboard.press("Tab");
  return focused(page.locator("#second"));
}

test(
  "Tab reaches every walk-through button in page order",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
    expect(
      await tabReachesPlainButton(page),
      "Tab reaches a plain button",
    ).toBe(true);
    await openHarness(page);
    expect(await steppers(page).count()).toBe(shownWalks.length);
    // A Term in a walk's title is the Term's own control, not the walk's.
    const buttons = await page.evaluateHandle(
      (roots) =>
        [...document.querySelectorAll(roots)].flatMap((root) => [
          ...root.querySelectorAll("button:not([popovertarget])"),
        ]),
      stepperRoots,
    );
    const count = await buttons.evaluate((list) => list.length);
    expect(count).toBe(shownWalks.length * 2 + 3);
    // No more presses than the page has stops, so a Tab order that never gets there still ends.
    const stops = await page.evaluate(
      () =>
        document.querySelectorAll(
          "a[href], button, input, select, textarea, [tabindex]",
        ).length,
    );
    const reached: number[] = [];
    for (
      let press = 0;
      press <= stops && reached.at(-1) !== count - 1;
      press += 1
    ) {
      await page.keyboard.press("Tab");
      const index = await buttons.evaluate((list) =>
        list.findIndex((button) => button === document.activeElement),
      );
      if (index !== -1) reached.push(index);
    }
    expect(reached).toEqual([...Array(count).keys()]);
  },
);

test(
  "Enter and Space move a walk-through, each move is read out, and focus stays at either end",
  {
    tag: "@single",
  },
  async ({ page }) => {
    const shift = stepperOf(page, "walk-fix-shift");
    const prev = stepButton(shift, "Prev");
    const next = stepButton(shift, "Next");
    const step = stepText(shift);
    const region = liveRegion(shift);
    expect(await step.textContent()).toBe("Start");
    expect(await region.textContent()).toBe("");
    await next.focus();
    await pressOn(next, "Enter");
    await expect(step).toHaveText("Step 1 of 2");
    expect(await region.textContent()).toBe(
      "Step 1 of 2: Copy the text to the spare cell.",
    );
    await pressOn(next, "Space");
    await expect(step).toHaveText("Step 2 of 2");
    expect(await region.textContent()).toBe(
      "Step 2 of 2: Write over the text.",
    );
    expect(await next.getAttribute("aria-disabled")).toBe("true");
    await pressOn(next, "Enter");
    expect(await step.textContent()).toBe("Step 2 of 2");
    expect(await region.textContent()).toBe(
      "Step 2 of 2: Write over the text.",
    );
    await prev.focus();
    await pressOn(prev, "Space");
    await expect(step).toHaveText("Step 1 of 2");
    expect(await region.textContent()).toBe(
      "Step 1 of 2: Copy the text to the spare cell.",
    );
    await pressOn(prev, "Enter");
    await expect(step).toHaveText("Start");
    expect(await region.textContent()).toBe(
      "Start: Copy first, as the sizes allow.",
    );
    expect(await prev.getAttribute("aria-disabled")).toBe("true");
    await pressOn(prev, "Space");
    expect(await step.textContent()).toBe("Start");
    expect(await region.textContent()).toBe(
      "Start: Copy first, as the sizes allow.",
    );
  },
);

test(
  "an outside move to a place the walk lacks shows no step, and a valid one shows it again",
  {
    tag: "@single",
  },
  async ({ page }) => {
    const shift = stepperOf(page, "walk-fix-shift");
    const pressed = () =>
      sequenceButtons(shift).evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-pressed")),
      );
    await stepButton(shift, "Next").click();
    await expect(stepText(shift)).toHaveText("Step 1 of 2");
    expect(await liveRegion(shift).textContent()).toBe(
      "Step 1 of 2: Copy the text to the spare cell.",
    );
    await moveFromOutside(page, {
      walkId: "walk-fix-shift",
      sequence: 1,
      step: 9,
    });
    await expect(shift.locator("> button")).toHaveCount(0);
    expect(await shift.locator("> p[data-block-id]").count()).toBe(1);
    expect(await stepText(shift).count()).toBe(0);
    expect(await shift.locator("> ol").count()).toBe(0);
    expect(await liveRegion(shift).textContent()).toBe("");
    expect(await pressed()).toEqual(["false", "false", "false"]);
    await moveFromOutside(page, {
      walkId: "walk-fix-shift",
      sequence: 2,
      step: 1,
    });
    await expect(stepText(shift)).toHaveText("Step 1 of 1");
    expect(await liveRegion(shift).textContent()).toBe("");
    expect(await pressed()).toEqual(["false", "true", "false"]);
    expect(await stepButton(shift, "Prev").getAttribute("aria-disabled")).toBe(
      "false",
    );
    expect(await stepButton(shift, "Next").getAttribute("aria-disabled")).toBe(
      "true",
    );
  },
);

test(
  "moving one walk-through leaves the others where they were, and one shown again stays silent",
  {
    tag: "@single",
  },
  async ({ page }) => {
    const intro = stepperOf(page, "walk-fix-intro");
    const shift = stepperOf(page, "walk-fix-shift");
    const sum = stepperOf(page, "walk-fix-sum");
    const total = buildSection(page, "build-fix-total");
    expect(await walkStates(page)).toEqual(atStart);
    await stepButton(intro, "Next").click();
    await expect(stepText(intro)).toHaveText("Step 1 of 1");
    const introMoved = {
      step: "Step 1 of 1",
      region: "Step 1 of 1: The cell now holds two.",
    };
    expect(await walkStates(page)).toEqual({
      ...atStart,
      "walk-fix-intro": introMoved,
    });
    await stepButton(shift, "Next").click();
    await expect(stepText(shift)).toHaveText("Step 1 of 2");
    const bothMoved = {
      ...atStart,
      "walk-fix-intro": introMoved,
      "walk-fix-shift": {
        step: "Step 1 of 2",
        region: "Step 1 of 2: Copy the text to the spare cell.",
      },
    };
    expect(await walkStates(page)).toEqual(bothMoved);
    // Several steppers share one page only here: each Term names its own definition, none is spare.
    const terms = await page.evaluate(() => {
      const targets = [
        ...document.querySelectorAll("main button[popovertarget]"),
      ].map((button) => button.getAttribute("popovertarget") ?? "");
      return {
        targets,
        named: targets.map((target) => {
          const owners = [...document.querySelectorAll("[id]")].filter(
            (el) => el.id === target,
          );
          return {
            owners: owners.length,
            popover: owners.every((el) => el.hasAttribute("popover")),
          };
        }),
        popovers: [...document.querySelectorAll("[popover]")].map(
          (popover) => popover.id,
        ),
      };
    });
    expect(terms.targets).toHaveLength(7);
    expect(new Set(terms.targets).size).toBe(terms.targets.length);
    expect(terms.named).toEqual(
      terms.targets.map(() => ({ owners: 1, popover: true })),
    );
    expect(terms.popovers.toSorted()).toEqual(terms.targets.toSorted());
    await approachButton(total, "the library").click();
    await expect(stepText(sum)).toHaveText("Start");
    await stepButton(sum, "Next").click();
    await expect(stepText(sum)).toHaveText("Step 1 of 1");
    expect(await liveRegion(sum).textContent()).toBe(
      "Step 1 of 1: The call stores the whole total at once.",
    );
    await approachButton(total, "a loop").click();
    await expect(sum).toHaveCount(0);
    await approachButton(total, "the library").click();
    await expect(stepText(sum)).toHaveText("Step 1 of 1");
    expect(await walkStates(page)).toEqual({
      ...bothMoved,
      "walk-fix-sum": { step: "Step 1 of 1", region: "" },
    });
  },
);

// Two positions of one walk that between them show every cell state the theme marks: an empty
// destination and an empty source, then a struck original in a destination beside an empty cell.
const markedPositions = [
  {
    sequence: "spare",
    region: "Step 1 of 1: Copy the empty cell.",
    cells: ["empty destination", null, "empty source"],
    struck: 0,
  },
  {
    sequence: "risky",
    region: "Step 1 of 1: The text is gone.",
    cells: [null, "destination", "empty"],
    struck: 1,
  },
] as const;

// Reached with the walk's own buttons; the pressed switch, then the region, marks each render.
async function showPosition(
  walk: Locator,
  position: (typeof markedPositions)[number],
): Promise<void> {
  const choice = sequenceButtons(walk).filter({
    hasText: new RegExp(`^${position.sequence}$`, "u"),
  });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await stepButton(walk, "Next").click();
  await expect(liveRegion(walk)).toHaveText(position.region);
  expect(
    await walk
      .locator("> ol > li")
      .evaluateAll((cells) =>
        cells.map((cell) => cell.getAttribute("data-cell")),
      ),
  ).toEqual(position.cells);
  expect(await walk.locator("> ol > li > s").count()).toBe(position.struck);
  await walk.scrollIntoViewIfNeeded();
  await settle(walk.page());
}

test(
  "a walk-through showing every cell state has no detectable WCAG A or AA violation in either scheme",
  {
    tag: "@single",
  },
  async ({ page }) => {
    const shift = stepperOf(page, "walk-fix-shift");
    for (const position of markedPositions) {
      await showPosition(shift, position);
      for (const scheme of ["light", "dark"] as const) {
        await setState(page, { theme: null, scheme, print: false });
        expect(
          (await scan(page, "#walk-fix-shift")).map((found) => found.line),
          `${position.sequence} in the ${scheme} scheme`,
        ).toEqual([]);
      }
    }
  },
);

test(
  "a walk-through fits 320 pixels wide at a 20 pixel default font, and its text scales",
  {
    tag: "@single",
  },
  async ({ page }) => {
    const shift = stepperOf(page, "walk-fix-shift");
    const sizes = () =>
      shift.evaluate((root) =>
        [root, ...root.querySelectorAll("*")].map((el) =>
          Number.parseFloat(getComputedStyle(el).fontSize),
        ),
      );
    // Outside the page, or wider than its own box, as text that does not wrap would be.
    const overflow = () =>
      shift.evaluate((root) => {
        const limit = document.documentElement.clientWidth;
        return [root, ...root.querySelectorAll("*")].flatMap((el) => {
          const box = el.getBoundingClientRect();
          const name = `${el.tagName} "${el.textContent.trim().slice(0, 24)}"`;
          return [
            ...(box.width > 0 && (box.left < 0 || box.right > limit)
              ? [`${name} lies outside the page width`]
              : []),
            ...(el.scrollWidth > el.clientWidth
              ? [`${name} is wider than its own box`]
              : []),
          ];
        });
      });
    const before: number[][] = [];
    for (const position of markedPositions) {
      await showPosition(shift, position);
      before.push(await sizes());
    }
    // The setting belongs to the DevTools session, so the session stays open for the test.
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Page.setFontSizes", {
        fontSizes: { standard: 20 },
      });
      await openHarness(page);
      await resize(page, { width: 320, height: 844 });
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize,
        ),
        "the browser default font size took effect",
      ).toBe("20px");
      for (const [index, position] of markedPositions.entries()) {
        await showPosition(shift, position);
        expect(await overflow(), position.sequence).toEqual([]);
        const after = await sizes();
        const base = before[index] ?? [];
        expect(
          after.map(
            (size, at) => Math.round((size / (base[at] ?? 0)) * 1000) / 1000,
          ),
          `${position.sequence}: every size follows the default font`,
        ).toEqual(base.map(() => 1.25));
      }
    } finally {
      await session.detach();
    }
  },
);

async function plainButtonFocusVisible(page: Page): Promise<boolean> {
  await page.setContent(plainButtonsPage);
  await settle(page);
  const button = page.locator("#first");
  await page.locator("body").focus();
  await page.keyboard.press("Shift");
  await button.focus();
  return button.evaluate((el) => el.matches(":focus-visible"));
}

// The paint a button's focus ring adds, and a floor of half a 2px ring drawn 2px outside it.
async function ringPaint(page: Page, button: Locator) {
  await page.locator("body").focus();
  await page.keyboard.press("Shift");
  await button.focus();
  expect(await button.evaluate((el) => el.matches(":focus-visible"))).toBe(
    true,
  );
  await settle(page);
  const box = await button.boundingBox();
  if (box === null) throw new Error("the focused button has no box");
  const paint = await paintOf(page, button, { "outline-style": "none" });
  return { paint, floor: perimeter(box, 2, 2) / 2 };
}

test(
  "forced colours keep a walk-through's controls, its state marks and both focus rings visible",
  {
    tag: "@single",
  },
  async ({ page }) => {
    expect(
      await plainButtonFocusVisible(page),
      "a plain button matches :focus-visible",
    ).toBe(true);
    await openHarness(page);
    await page.emulateMedia({ forcedColors: "active" });
    await settle(page);
    expect(
      await page.evaluate(() => matchMedia("(forced-colors: active)").matches),
    ).toBe(true);
    const shift = stepperOf(page, "walk-fix-shift");
    const prev = stepButton(shift, "Prev");
    const next = stepButton(shift, "Next");
    const style = (target: Locator, name: string) =>
      target.evaluate(
        (el, n) => getComputedStyle(el).getPropertyValue(n),
        name,
      );
    // A dashed edge marks an empty or a written cell; either edge must still be drawn.
    const cellEdges = async () => {
      for (const cell of await shift.locator("> ol > li").all()) {
        const state = (await cell.getAttribute("data-cell")) ?? "none";
        const dashed = /\b(?:empty|destination)\b/u.test(state);
        expect(await style(cell, "border-top-style"), state).toBe(
          dashed ? "dashed" : "solid",
        );
        expect(
          await paintOf(page, cell, {
            "border-style": dashed ? "solid" : "dashed",
          }),
          state,
        ).toBeGreaterThan(0);
      }
    };
    const [spare, risky] = markedPositions;
    await showPosition(shift, spare);
    // The Term in a walk's title is the Term's own control, not the walk's.
    for (const control of [
      ...(await sequenceButtons(shift).all()),
      prev,
      next,
    ]) {
      await insidePage(page, control);
      expect(
        await paintOf(page, control, { visibility: "hidden" }),
      ).toBeGreaterThan(0);
    }
    // Pressed is an underline and unavailable a dashed edge, so neither rests on colour.
    const pressed = sequenceButtons(shift).filter({ hasText: /^spare$/u });
    expect(
      await sequenceButtons(shift).evaluateAll((buttons) =>
        buttons.map((button) => [
          button.getAttribute("aria-pressed"),
          getComputedStyle(button).textDecorationLine,
        ]),
      ),
    ).toEqual([
      ["false", "none"],
      ["false", "none"],
      ["true", "underline"],
    ]);
    expect(
      await paintOf(page, pressed, { "text-decoration-line": "none" }),
    ).toBeGreaterThan(0);
    expect(await next.getAttribute("aria-disabled")).toBe("true");
    expect(await style(next, "border-top-style")).toBe("dashed");
    expect(await style(prev, "border-top-style")).toBe("solid");
    expect(
      await paintOf(page, next, { "border-style": "solid" }),
    ).toBeGreaterThan(0);
    await cellEdges();
    for (const button of [pressed, prev]) {
      const { paint, floor } = await ringPaint(page, button);
      expect(paint).toBeGreaterThanOrEqual(floor);
    }
    await showPosition(shift, risky);
    await cellEdges();
    const struck = shift.locator("> ol > li > s");
    expect(await style(struck, "text-decoration-line")).toBe("line-through");
    expect(
      await paintOf(page, struck, { "text-decoration-line": "none" }),
    ).toBeGreaterThan(0);
  },
);
