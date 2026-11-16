import { expect } from "@playwright/test";
import { test } from "./fixture.ts";
import { distUrl, settle } from "./probe.ts";

// The same body on every project, since a bundle can mount in one engine and fail in another.
test("smoke: the production build loads, shows its content, logs no error and does not overflow", async ({
  page,
}) => {
  // Attached before navigation, so a failure during the first load is seen.
  const failedRequests: string[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: { text: string; url: string }[] = [];
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedRequests.push(`${response.url()}: ${String(response.status())}`);
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push({ text: message.text(), url: message.location().url });
  });

  const loaded = await page.goto(distUrl);
  await settle(page);

  expect(loaded?.status(), "the document response").toBe(200);
  expect(failedRequests).toEqual([]);

  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 1, name: "SharpLadder", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByText(
      "C# fundamentals, reference and practice problems, with hints when you get stuck.",
      { exact: true },
    ),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
  // Chromium fetches /favicon.ico unprompted and the build ships no favicon.
  const exempted = consoleErrors.find(
    (entry) =>
      entry.url === new URL("/favicon.ico", distUrl).href &&
      entry.text ===
        "Failed to load resource: the server responded with a status of 404 (Not Found)",
  );
  if (exempted) {
    consoleErrors.splice(consoleErrors.indexOf(exempted), 1);
    test.info().annotations.push({
      type: "missing favicon",
      description: `The production favicon is not implemented; exempted: ${exempted.text} (${exempted.url})`,
    });
  }
  expect(consoleErrors).toEqual([]);

  // On the phone projects this is the narrowest supported width.
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
});
