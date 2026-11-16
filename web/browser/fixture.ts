import { test as base } from "@playwright/test";
import { endTest, startTest } from "./evidence.ts";

/** The suite's test, with the wait evidence attached to every test whatever its outcome. */
export const test = base.extend<{ waitEvidence: undefined }>({
  waitEvidence: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern.
    async ({}, runTest, info) => {
      startTest();
      try {
        await runTest(undefined);
      } finally {
        // Teardown also runs after a test timeout, so a stalled test still leaves its record.
        await info.attach("wait-evidence.json", {
          body: JSON.stringify(endTest(), null, 2),
          contentType: "application/json",
        });
      }
    },
    { auto: true },
  ],
});
