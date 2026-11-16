import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./fixture.ts";
import { distUrl, settle } from "./probe.ts";

// The engine has no wcag22a tag and an unknown tag selects nothing, so it is never passed.
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  const report = (kind: string, rule: (typeof results.violations)[number]) =>
    `${kind} ${rule.id}: ${rule.help}; targets ${JSON.stringify(rule.nodes.map((node) => node.target))}`;
  const ran =
    results.passes.length +
    results.violations.length +
    results.incomplete.length +
    results.inapplicable.length;
  // A configuration that selects no rule reports no violation, which must not read as a pass.
  if (ran === 0) throw new Error("scan: the configuration selected no rule");
  // Nobody reviews an unresolved result by hand, so it blocks without being called a violation.
  expect
    .soft(
      results.incomplete.map((rule) => report("incomplete", rule)),
      "incomplete results",
    )
    .toEqual([]);
  return results.violations.map((rule) => ({
    id: rule.id,
    line: report("violation", rule),
  }));
}

for (const scheme of ["light", "dark"] as const)
  test(
    `the built page has no automatically detectable WCAG A or AA violation (${scheme} scheme)`,
    {
      tag: "@single",
    },
    async ({ page }) => {
      const loaded = await page.goto(distUrl);
      await settle(page);
      expect(loaded?.status(), "the document response").toBe(200);
      await page.emulateMedia({ colorScheme: scheme });
      await settle(page);
      expect(
        (await scan(page)).map((found) => found.line),
        "violations",
      ).toEqual([]);
    },
  );

// The shipped page passes, so only a page built to fail shows the configuration catches anything.
test(
  "control: the scan configuration reports a nameless button and low-contrast text",
  {
    tag: "@single",
  },
  async ({ page }) => {
    await page.setContent(
      `<!doctype html><html lang="en"><head><title>Control</title></head><body><main>
<button></button><p style="color: #777777; background: #888888">Low contrast text</p>
</main></body></html>`,
    );
    await settle(page);
    const found = await scan(page);
    expect(
      found.map((rule) => rule.id),
      found.map((rule) => rule.line).join("\n"),
    ).toEqual(expect.arrayContaining(["button-name", "color-contrast"]));
  },
);
