import {
  expect,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import { test } from "./fixture.ts";
import { focused, harnessUrl, settle } from "./probe.ts";

const loop = {
  href: "/glossary#term-fixture-loop",
  short: "Code that runs the same statements again while a condition holds.",
};
type Entry = typeof loop;

// Terms shown before an approach is picked: four in the syntax part, one in a card field and two
// in drill prose. Each is the same component, so one of them stands for all in the browser.
const shownTerms = 7;

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

test("a click opens a Term's definition and a second click closes it", async ({
  page,
}) => {
  expect(await terms(page).count()).toBe(shownTerms);
  const term = terms(page).first();
  await term.click();
  await expectOpen(term, loop, await shownBy(term));
  await term.click();
  await expectClosed(term, loop, await shownBy(term));
});

test(
  "Enter opens a Term's definition and a second Enter closes it",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
    expect(await terms(page).count()).toBe(shownTerms);
    const term = terms(page).first();
    await openByKeyboard(term, loop);
    await page.keyboard.press("Enter");
    const shown = await shownBy(term);
    expect(shown.onTerm).toBe(true);
    await expectClosed(term, loop, shown);
  },
);

test(
  "Escape closes a keyboard-opened definition and focus is on its button",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
    const term = terms(page).first();
    await openByKeyboard(term, loop);
    await page.keyboard.press("Escape");
    const shown = await shownBy(term);
    expect(shown.onTerm).toBe(true);
    await expectClosed(term, loop, shown);
  },
);

test(
  "Escape from inside a keyboard-opened definition returns focus to its button",
  {
    tag: "@desktop",
  },
  async ({ page }) => {
    const term = terms(page).first();
    const definition = await definitionOf(term);
    await openByKeyboard(term, loop);
    await definition.getByRole("link").focus();
    expect(await holdsFocus(definition)).toBe(true);
    await page.keyboard.press("Escape");
    const shown = await shownBy(term);
    expect(shown.onTerm).toBe(true);
    await expectClosed(term, loop, shown);
  },
);

test(
  "Escape after pointer opening closes the definition, from its button or from inside it",
  {
    tag: "@desktop",
  },
  async ({ page, browserName }) => {
    const focuses = await clickFocusesPlainButton(page);
    if (browserName !== "webkit")
      expect(focuses, "a click focuses a plain button").toBe(true);
    await page.goto(harnessUrl);
    const term = terms(page).first();
    const definition = await definitionOf(term);
    await term.click();
    await expectOpen(term, loop, await shownBy(term));
    await page.keyboard.press("Escape");
    const shown = await shownBy(term);
    expect(shown.inDefinition).toBe(false);
    // Focus stays where a click on a plain button leaves it: on the button, or where it was before.
    if (focuses) expect(shown.onTerm).toBe(true);
    else expect(shown.activeTag).toBe("BODY");
    await expectClosed(term, loop, shown);
    await term.click();
    await expectOpen(term, loop, await shownBy(term));
    await definition.getByRole("link").focus();
    expect(await holdsFocus(definition)).toBe(true);
    await page.keyboard.press("Escape");
    const fromInside = await shownBy(term);
    if (focuses) expect(fromInside.inDefinition).toBe(false);
    else
      await expect
        .poll(() =>
          page.evaluate(() => document.activeElement === document.body),
        )
        .toBe(true);
    await expectClosed(term, loop, fromInside);
  },
);

// Native-navigation parity: where the engine skips every link, this is not keyboard reachability.
test(
  "each key reaches the definition link exactly when it reaches a plain link",
  {
    tag: "@desktop",
  },
  async ({ page, browserName }) => {
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
  },
);

test(
  "a closed definition's link is never reached from the keyboard",
  {
    tag: "@desktop",
  },
  async ({ page, browserName }) => {
    const all = await terms(page).all();
    for (const key of linkKeys(browserName))
      for (const term of all) {
        await term.focus();
        await page.keyboard.press(key);
        for (const other of all)
          expect(await holdsFocus(await definitionOf(other))).toBe(false);
      }
  },
);

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
  // Read once: a retrying assertion would wait out a wrong opening instead of failing on it.
  expect(await (await definitionOf(second)).isHidden()).toBe(true);
  await second.click();
  const opened = await shownBy(second);
  const closed = await shownBy(first);
  await expectOpen(second, loop, opened);
  await expectClosed(first, loop, closed);
});

// The DOM's text node type; the Node global exists only in the page.
const textNode = 3;

interface Parts {
  trigger: number;
  definition: number;
  link: number;
  text: number;
}

interface AXValue {
  value?: unknown;
  relatedNodes?: { backendDOMNodeId: number }[];
}

interface AXNode {
  ignored: boolean;
  backendDOMNodeId?: number;
  role?: AXValue;
  name?: AXValue;
  properties?: { name: string; value: AXValue }[];
}

// A backend node id lasts as long as its node, so each part is matched by identity, never by text.
async function partsOf(session: CDPSession, trigger: string): Promise<Parts> {
  const { root } = await session.send("DOM.getDocument", { depth: 0 });
  const nodeOf = async (from: number, selector: string) => {
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: from,
      selector,
    });
    if (nodeId === 0) throw new Error(`nothing matches ${selector}`);
    const { node } = await session.send("DOM.describeNode", {
      nodeId,
      depth: 1,
    });
    return { nodeId, node };
  };
  const button = await nodeOf(root.nodeId, trigger);
  const attributes = button.node.attributes ?? [];
  const at = attributes.findIndex(
    (name, index) => index % 2 === 0 && name === "popovertarget",
  );
  const id = attributes[at + 1];
  if (at < 0 || id === undefined)
    throw new Error(`${trigger} names no definition`);
  const definition = await nodeOf(root.nodeId, `[id=${JSON.stringify(id)}]`);
  const link = await nodeOf(definition.nodeId, "a");
  const text = definition.node.children?.find(
    (child) => child.nodeType === textNode,
  );
  if (text === undefined) throw new Error(`${trigger} defines no text`);
  return {
    trigger: button.node.backendNodeId,
    definition: definition.node.backendNodeId,
    link: link.node.backendNodeId,
    text: text.backendNodeId,
  };
}

const trimmed = (value: unknown): unknown =>
  typeof value === "string" ? value.trim() : value;

// What one tree read exposes of a control's parts; an absent or ignored node is not exposed.
function viewOf(nodes: readonly AXNode[], parts: Parts) {
  const exposed = (id: number) =>
    nodes.filter((node) => node.backendDOMNodeId === id && !node.ignored);
  const placeOf = (id: number) =>
    (["trigger", "definition", "link"] as const).find(
      (place) => parts[place] === id,
    ) ?? "unresolved";
  const named = (node: AXNode) => ({
    role: node.role?.value,
    name: node.name?.value,
  });
  const [trigger] = exposed(parts.trigger);
  const expanded = trigger?.properties?.find(
    (found) => found.name === "expanded",
  );
  return {
    trigger: exposed(parts.trigger).map(named),
    expanded: { present: expanded !== undefined, value: expanded?.value.value },
    // The protocol marks a relationship only by the related nodes its value carries.
    relations: (trigger?.properties ?? []).flatMap(({ name, value }) =>
      value.relatedNodes === undefined
        ? []
        : [
            {
              kind: name,
              targets: value.relatedNodes.map((node) =>
                placeOf(node.backendDOMNodeId),
              ),
            },
          ],
    ),
    definition: exposed(parts.definition).length,
    text: exposed(parts.text).map((node) => trimmed(node.name?.value)),
    link: exposed(parts.link).map(named),
  };
}

// Each state is reached by Enter on the focused trigger and read once: the protocol promises no
// freshness, so polling would only wait for the expected answer.
async function statesOf(
  session: CDPSession,
  trigger: Locator,
  definition: Locator,
  parts: Parts,
) {
  const page = trigger.page();
  const read = async (open: boolean) => {
    await trigger.focus();
    await page.keyboard.press("Enter");
    expect(
      await definition.evaluate((el) => el.matches(":popover-open")),
      open ? "Enter opens the definition" : "Enter closes the definition",
    ).toBe(open);
    await settle(page);
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    return viewOf(nodes, parts);
  };
  const open = await read(true);
  const closed = await read(false);
  return { open, closed };
}

// A thrown value can be falsy, so the flag keeps the failure apart from its value.
function rethrow(failed: boolean, failure: unknown, cleanup: unknown[]): void {
  if (cleanup.length === 0) {
    if (failed) throw failure;
    return;
  }
  const cause =
    cleanup.length === 1
      ? cleanup[0]
      : new AggregateError(cleanup, "both clean-ups failed");
  if (!failed) throw cause;
  throw new AggregateError(
    [failure, ...cleanup],
    "the tree measurement and its clean-up failed",
    { cause },
  );
}

// Outside main, so no product locator ever finds the plain control.
const plainMark = "data-plain-popover";
const plainRoot = `[${plainMark}]`;

test(
  "a Term's engine accessibility tree holds its minima and matches a plain popover button",
  {
    tag: "@single",
  },
  async ({ page }) => {
    const term = terms(page).first();
    const definition = await definitionOf(term);
    const label = ((await term.textContent()) ?? "")
      .replaceAll(/\s+/gu, " ")
      .trim();
    const shown = await definition.evaluate((el) => ({
      short:
        [...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
          ?.textContent ?? "",
      link: el.querySelector("a")?.textContent ?? "",
    }));
    const plainTrigger = page.locator(`${plainRoot} > button`);
    const plainDefinition = page.locator(`${plainRoot} > [popover]`);
    const session = await page.context().newCDPSession(page);
    let failed = false;
    let failure: unknown;
    try {
      await session.send("Accessibility.enable");
      await page.evaluate(
        ({ mark, trigger, short, link }) => {
          const control = document.createElement("div");
          control.setAttribute(mark, "");
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("popovertarget", "plain-definition");
          button.textContent = trigger;
          const popover = document.createElement("div");
          popover.id = "plain-definition";
          popover.setAttribute("popover", "");
          const anchor = document.createElement("a");
          anchor.href = "#x";
          anchor.textContent = link;
          popover.append(short, " ", anchor);
          control.append(button, popover);
          document.body.append(control);
        },
        { mark: plainMark, trigger: label, ...shown },
      );
      await settle(page);
      // The first match, as terms(page).first() finds the Term.
      const termStates = await statesOf(
        session,
        term,
        definition,
        await partsOf(session, "main button[popovertarget]"),
      );
      const plainStates = await statesOf(
        session,
        plainTrigger,
        plainDefinition,
        await partsOf(session, `${plainRoot} > button`),
      );
      for (const state of ["closed", "open"] as const) {
        const view = termStates[state];
        const plain = plainStates[state];
        expect(view.trigger, `${state}: the trigger`).toEqual([
          { role: "button", name: label },
        ]);
        expect(view.expanded, `${state}: expanded`).toEqual(plain.expanded);
        for (const relation of plain.relations) {
          expect(
            relation.targets,
            `${state}: the plain ${relation.kind}`,
          ).not.toContain("unresolved");
          expect(
            view.relations.find((found) => found.kind === relation.kind),
            `${state}: ${relation.kind}`,
          ).toEqual(relation);
        }
      }
      expect(termStates.closed.definition, "closed: the definition").toBe(0);
      expect(termStates.closed.link, "closed: the link").toEqual([]);
      // The engine may add line boxes for the same text node, each named by its own part.
      expect(termStates.open.text, "open: the definition's text").toContain(
        loop.short,
      );
      expect(termStates.open.link, "open: the link").toEqual([
        { role: "link", name: "Definition" },
      ]);
    } catch (error: unknown) {
      failed = true;
      failure = error;
    }
    const cleanup: unknown[] = [];
    try {
      await page.evaluate((root) => {
        document.querySelector(root)?.remove();
      }, plainRoot);
    } catch (error: unknown) {
      cleanup.push(error);
    }
    try {
      await session.detach();
    } catch (error: unknown) {
      cleanup.push(error);
    }
    rethrow(failed, failure, cleanup);
  },
);
