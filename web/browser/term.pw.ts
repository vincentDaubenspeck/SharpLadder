import { expect, test, type Locator, type Page } from "@playwright/test";
import { focused, harnessUrl, settle } from "./probe.ts";

const loop = {
  href: "/glossary#term-fixture-loop",
  short: "Code that runs the same statements again while a condition holds.",
};
const set = {
  href: "/glossary#term-fixture-set",
  short: 'A collection of unique values with fast "is it here?" checks.',
};
type Entry = typeof loop;

// Every Term shown before an approach is picked, in page order: the syntax part's paragraph, list
// item and table cell, a card field's table cell, then two paragraphs of drill prose.
const placed: readonly { parent: string; name: string; entry: Entry }[] = [
  { parent: "P", name: "loop", entry: loop },
  { parent: "LI", name: "loop", entry: loop },
  { parent: "TD", name: "loop", entry: loop },
  { parent: "TD", name: "set", entry: set },
  { parent: "P", name: "loop", entry: loop },
  { parent: "P", name: "set", entry: set },
];

test.beforeEach(async ({ page }) => {
  await page.goto(harnessUrl);
  await expect(page.locator("main[data-harness]")).toBeVisible();
});

// Found by structure: a Term is the one kind of button that names a definition.
const terms = (page: Page): Locator =>
  page.locator("main button[popovertarget]");

async function definitionOf(term: Locator): Promise<Locator> {
  const id = await term.getAttribute("popovertarget");
  if (id === null) throw new Error("a Term button names no definition");
  return term.page().locator(`[id=${JSON.stringify(id)}]`);
}

// The entry's own page section repeats the short text, so a Term is judged inside its block.
const blockOf = (term: Locator): Locator => term.locator("xpath=..");

const holdsFocus = (definition: Locator): Promise<boolean> =>
  definition.evaluate((el) => el.contains(document.activeElement));

// The engine decides whether a key moves focus to a link, and WebKit's choice differs by platform
// with Option inverting it, so each key is first measured on a plain link.
const linkKeys = (browserName: string): string[] =>
  browserName === "webkit" ? ["Tab", "Alt+Tab"] : ["Tab"];

const plainLinkPage = `<!doctype html><html lang="en"><title>Links</title>
<button type="button" id="before">before</button> <a href="#x">link</a>
<button type="button" id="after">after</button></html>`;

// A key that skips the link must land on the next button, so one that moves focus nowhere fails.
async function reachesPlainLink(page: Page, key: string): Promise<boolean> {
  await page.setContent(plainLinkPage);
  await page.locator("#before").focus();
  await page.keyboard.press(key);
  const reached = await focused(page.getByRole("link"));
  if (!reached)
    expect(
      await focused(page.locator("#after")),
      `${key} skips to the next button`,
    ).toBe(true);
  return reached;
}

const plainButtonPage = `<!doctype html><html lang="en"><title>Button</title>
<button type="button" id="plain">plain</button></html>`;

// WebKit focuses a button it clicks on some platforms and not on others, so a click is first
// measured on a plain button.
async function clickFocusesPlainButton(page: Page): Promise<boolean> {
  await page.setContent(plainButtonPage);
  const button = page.locator("#plain");
  await button.click();
  return button.evaluate((el) => el === document.activeElement);
}

// Where a key that skips links lands: the first visible control after the definition.
const nextControl = (definition: Locator) =>
  definition.evaluateHandle((el) => {
    const controls = document.querySelectorAll(
      "button, input, select, textarea, [tabindex]",
    );
    return [...controls].find(
      (c) =>
        (el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) !==
          0 &&
        !el.contains(c) &&
        c.getAttribute("tabindex") !== "-1" &&
        c.checkVisibility(),
    );
  });

const shownBy = (term: Locator) =>
  term.evaluate((button) => {
    const definition = document.getElementById(
      button.getAttribute("popovertarget") ?? "",
    );
    if (definition === null)
      throw new Error("a Term button names no definition");
    const active = document.activeElement;
    return {
      open: definition.matches(":popover-open"),
      visible: definition.checkVisibility(),
      text: definition.textContent.replaceAll(/\s+/gu, " "),
      hrefs: [...definition.querySelectorAll("a[href]")].map((a) =>
        a.getAttribute("href"),
      ),
      onTerm: active === button,
      inDefinition: definition.contains(active),
      activeTag: active?.tagName,
    };
  });
type Shown = Awaited<ReturnType<typeof shownBy>>;

// The snapshot is YAML, and a quoted text there escapes its double quotes.
const inSnapshot = (snapshot: string, text: string): boolean =>
  snapshot.includes(text) || snapshot.includes(text.replaceAll('"', '\\"'));

async function closedSnapshot(term: Locator, entry: Entry): Promise<void> {
  await settle(term.page());
  const snapshot = await blockOf(term).ariaSnapshot();
  expect(snapshot).not.toContain("Definition");
  expect(inSnapshot(snapshot, entry.short)).toBe(false);
}

async function expectStartsClosed(term: Locator, entry: Entry): Promise<void> {
  await expect(await definitionOf(term)).toBeHidden();
  await closedSnapshot(term, entry);
}

async function expectClosed(
  term: Locator,
  entry: Entry,
  shown: Shown,
): Promise<void> {
  expect(shown.open).toBe(false);
  expect(shown.visible).toBe(false);
  await closedSnapshot(term, entry);
}

async function expectOpen(
  term: Locator,
  entry: Entry,
  shown: Shown,
): Promise<void> {
  expect(shown.open).toBe(true);
  expect(shown.visible).toBe(true);
  expect(shown.text).toContain(entry.short);
  expect(shown.hrefs).toEqual([entry.href]);
  await settle(term.page());
  const snapshot = await blockOf(term).ariaSnapshot();
  expect(snapshot).toContain("Definition");
  expect(inSnapshot(snapshot, entry.short)).toBe(true);
}

async function openByKeyboard(term: Locator, entry: Entry): Promise<void> {
  await term.focus();
  await term.page().keyboard.press("Enter");
  const shown = await shownBy(term);
  expect(shown.onTerm).toBe(true);
  await expectOpen(term, entry, shown);
}

test("Terms sit in paragraphs, list items and table cells across parts, each with its own closed definition", async ({
  page,
}) => {
  expect(await terms(page).count()).toBe(placed.length);
  expect(
    await terms(page).evaluateAll((buttons) =>
      buttons.map((b) => b.parentElement?.tagName ?? ""),
    ),
  ).toEqual(placed.map((p) => p.parent));
  const targets = await terms(page).evaluateAll((buttons) =>
    buttons.map((b) => b.getAttribute("popovertarget") ?? ""),
  );
  expect(new Set(targets).size).toBe(placed.length);
  for (const [index, { name, entry }] of placed.entries()) {
    const term = terms(page).nth(index);
    expect(await term.getAttribute("type")).toBe("button");
    expect(await term.getAttribute("popovertargetaction")).toBe("toggle");
    expect(
      await term.and(page.getByRole("button", { name, exact: true })).count(),
    ).toBe(1);
    expect(await (await definitionOf(term)).getAttribute("popover")).toBe(
      "auto",
    );
    await expectStartsClosed(term, entry);
  }
});

test("a click opens a Term's definition and a second click closes it", async ({
  page,
}) => {
  expect(await terms(page).count()).toBe(placed.length);
  for (const [index, { entry }] of placed.entries()) {
    const term = terms(page).nth(index);
    await term.click();
    await expectOpen(term, entry, await shownBy(term));
    await term.click();
    await expectClosed(term, entry, await shownBy(term));
  }
});

test("Enter opens a Term's definition and a second Enter closes it", async ({
  page,
}) => {
  expect(await terms(page).count()).toBe(placed.length);
  for (const [index, { entry }] of placed.entries()) {
    const term = terms(page).nth(index);
    await openByKeyboard(term, entry);
    await page.keyboard.press("Enter");
    const shown = await shownBy(term);
    expect(shown.onTerm).toBe(true);
    await expectClosed(term, entry, shown);
  }
});

test("a Term in a build approach's table cell shows once that approach is picked", async ({
  page,
}) => {
  const section = page.locator('section[data-section-id="build-fix-total"]');
  const term = section.locator("button[popovertarget]");
  expect(await term.count()).toBe(0);
  await section
    .locator('[role="group"][aria-label="Build approaches"] > button')
    .filter({ hasText: /^the library$/u })
    .click();
  await expect(term).toHaveCount(1);
  expect(await terms(page).count()).toBe(placed.length + 1);
  const targets = await terms(page).evaluateAll((buttons) =>
    buttons.map((b) => b.getAttribute("popovertarget") ?? ""),
  );
  expect(new Set(targets).size).toBe(placed.length + 1);
  expect(await term.evaluate((b) => b.parentElement?.tagName)).toBe("TD");
  expect(
    await term
      .and(page.getByRole("button", { name: "loop", exact: true }))
      .count(),
  ).toBe(1);
  await expectStartsClosed(term, loop);
  await term.click();
  await expectOpen(term, loop, await shownBy(term));
  await term.click();
  await expectClosed(term, loop, await shownBy(term));
});

test("Escape closes a keyboard-opened definition and focus is on its button", async ({
  page,
}) => {
  const term = terms(page).first();
  await openByKeyboard(term, loop);
  await page.keyboard.press("Escape");
  const shown = await shownBy(term);
  expect(shown.onTerm).toBe(true);
  await expectClosed(term, loop, shown);
});

test("Escape from inside a keyboard-opened definition returns focus to its button", async ({
  page,
}) => {
  const term = terms(page).first();
  const definition = await definitionOf(term);
  await openByKeyboard(term, loop);
  await definition.getByRole("link").focus();
  expect(await holdsFocus(definition)).toBe(true);
  await page.keyboard.press("Escape");
  const shown = await shownBy(term);
  expect(shown.onTerm).toBe(true);
  await expectClosed(term, loop, shown);
});

test("Escape after pointer opening closes the definition and keeps the engine's own focus", async ({
  page,
  browserName,
}) => {
  const focuses = await clickFocusesPlainButton(page);
  if (browserName !== "webkit")
    expect(focuses, "a click focuses a plain button").toBe(true);
  await page.goto(harnessUrl);
  const term = terms(page).first();
  await term.click();
  await expectOpen(term, loop, await shownBy(term));
  await page.keyboard.press("Escape");
  const shown = await shownBy(term);
  expect(shown.inDefinition).toBe(false);
  // Focus stays where a click on a plain button leaves it: on the button, or where it was before.
  if (focuses) expect(shown.onTerm).toBe(true);
  else expect(shown.activeTag).toBe("BODY");
  await expectClosed(term, loop, shown);
});

test("focus moved into a pointer-opened definition never stays in it after Escape", async ({
  page,
  browserName,
}) => {
  const focuses = await clickFocusesPlainButton(page);
  if (browserName !== "webkit")
    expect(focuses, "a click focuses a plain button").toBe(true);
  await page.goto(harnessUrl);
  const term = terms(page).first();
  const definition = await definitionOf(term);
  await term.click();
  await expectOpen(term, loop, await shownBy(term));
  await definition.getByRole("link").focus();
  expect(await holdsFocus(definition)).toBe(true);
  await page.keyboard.press("Escape");
  const shown = await shownBy(term);
  if (focuses) expect(shown.inDefinition).toBe(false);
  else
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body))
      .toBe(true);
  await expectClosed(term, loop, shown);
});

// Native-navigation parity: where the engine skips every link, this is not keyboard reachability.
test("each key reaches the definition link exactly when it reaches a plain link", async ({
  page,
  browserName,
}) => {
  for (const key of linkKeys(browserName)) {
    const plain = await reachesPlainLink(page, key);
    if (browserName !== "webkit")
      expect(plain, `${key} reaches a plain link`).toBe(true);
    await page.goto(harnessUrl);
    const term = terms(page).first();
    const definition = await definitionOf(term);
    await openByKeyboard(term, loop);
    const next = await nextControl(definition);
    await page.keyboard.press(key);
    if (plain)
      expect(await focused(definition.getByRole("link")), key).toBe(true);
    else
      expect(
        await next.evaluate((el) => el === document.activeElement),
        `${key} skips the link to the next control`,
      ).toBe(true);
  }
});

test("Enter activates the definition link once it holds focus", async ({
  page,
}) => {
  await page.route("**/glossary", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Glossary</title>",
    }),
  );
  const term = terms(page).first();
  const link = (await definitionOf(term)).getByRole("link");
  await openByKeyboard(term, loop);
  await link.focus();
  expect(await focused(link)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    (url) => url.pathname === "/glossary" && url.hash === "#term-fixture-loop",
  );
});

test("a closed definition's link is never reached from the keyboard", async ({
  page,
  browserName,
}) => {
  const all = await terms(page).all();
  for (const key of linkKeys(browserName))
    for (const term of all) {
      await term.focus();
      await page.keyboard.press(key);
      for (const other of all)
        expect(await holdsFocus(await definitionOf(other))).toBe(false);
    }
});

test("a click outside dismisses an open definition", async ({ page }) => {
  const term = terms(page).first();
  await term.click();
  await expectOpen(term, loop, await shownBy(term));
  await page.getByRole("heading", { level: 1 }).click();
  await expectClosed(term, loop, await shownBy(term));
});

test("opening one Term closes another and never opens its definition", async ({
  page,
}) => {
  const [first, second] = await terms(page).all();
  if (first === undefined || second === undefined)
    throw new Error("the fixture needs two Terms");
  await first.click();
  await expectOpen(first, loop, await shownBy(first));
  await expect(await definitionOf(second)).toBeHidden();
  await second.click();
  const opened = await shownBy(second);
  const closed = await shownBy(first);
  await expectOpen(second, loop, opened);
  await expectClosed(first, loop, closed);
});
