import { expect } from "@playwright/test";
import { scan } from "./axe.ts";
import { test } from "./fixture.ts";
import { distUrl, settle } from "./probe.ts";

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
