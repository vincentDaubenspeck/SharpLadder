// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfig } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  caniuseVersion,
  classPattern,
  contractViolations,
  cssTarget,
  lightningTargets,
} from "./contract.js";

const web = join(import.meta.dirname, "..");

let resolved;
beforeAll(async () => {
  resolved = await resolveConfig(
    { root: web, configFile: join(web, "vite.config.ts") },
    "build",
    "production",
  );
}, 60_000);

// Each case changes one setting of the resolved config, so only that setting can fail.
const changed = (edit) => {
  const config = {
    ...resolved,
    build: {
      ...resolved.build,
      rolldownOptions: { ...resolved.build.rolldownOptions },
    },
    css: { ...resolved.css, lightningcss: { ...resolved.css.lightningcss } },
  };
  edit(config);
  return contractViolations(config);
};

describe("transformation contract", () => {
  it("pins the caniuse-lite data the targets were read from", () => {
    const { version } = JSON.parse(
      // The lockfile is what npm ci installs, so its record is the data the build reads.
      readFileSync(join(web, "package-lock.json"), "utf8"),
    ).packages["node_modules/caniuse-lite"];
    const installed = JSON.parse(
      readFileSync(join(web, "node_modules/caniuse-lite/package.json"), "utf8"),
    );
    expect(version).toBe(caniuseVersion);
    expect(installed.version).toBe(caniuseVersion);
    expect(caniuseVersion).toBe("1.0.30001822");
  });

  it("records the exact target values", () => {
    expect(lightningTargets).toEqual({
      chrome: 10223616,
      edge: 10158080,
      firefox: 10354688,
      safari: 1703936,
      ios_saf: 1703936,
    });
    expect(cssTarget).toEqual([
      "chrome156",
      "edge155",
      "firefox158",
      "safari26",
      "ios26",
    ]);
  });

  it("accepts the real resolved configuration", () => {
    expect(contractViolations(resolved)).toEqual([]);
    expect(resolved.css.lightningcss.targets).toEqual(lightningTargets);
    expect(resolved.build.cssTarget).toEqual(cssTarget);
  });

  it.each([
    ["base changed", (c) => (c.base = "/site/"), "base"],
    ["cssMinify missing", (c) => delete c.build.cssMinify, "cssMinify"],
    ["cssMinify on", (c) => (c.build.cssMinify = "lightningcss"), "cssMinify"],
    ["cssTarget missing", (c) => delete c.build.cssTarget, "cssTarget"],
    [
      "cssTarget changed",
      (c) => (c.build.cssTarget = ["chrome120"]),
      "cssTarget",
    ],
    [
      "errorRecovery missing",
      (c) => delete c.css.lightningcss.errorRecovery,
      "errorRecovery",
    ],
    [
      "errorRecovery on",
      (c) => (c.css.lightningcss.errorRecovery = true),
      "errorRecovery",
    ],
    ["targets missing", (c) => delete c.css.lightningcss.targets, "targets"],
    [
      "a target changed",
      (c) => (c.css.lightningcss.targets = { ...lightningTargets, chrome: 1 }),
      "targets",
    ],
    [
      "a target added",
      (c) => (c.css.lightningcss.targets = { ...lightningTargets, and_chr: 1 }),
      "targets",
    ],
    [
      "pure modules off",
      (c) => (c.css.lightningcss.cssModules = { pure: false }),
      "pure",
    ],
    [
      "asset naming missing",
      (c) => (c.build.rolldownOptions.output = {}),
      "assetFileNames",
    ],
    [
      "fonts hashed",
      (c) =>
        (c.build.rolldownOptions.output = {
          assetFileNames: () => "assets/[name]-[hash][extname]",
        }),
      "assetFileNames",
    ],
    [
      "a module option added",
      (c) =>
        (c.css.lightningcss.cssModules = {
          pure: true,
          pattern: classPattern,
          dashedIdents: true,
        }),
      "beside pure and pattern",
    ],
    [
      "class-name pattern missing",
      (c) => (c.css.lightningcss.cssModules = { pure: true }),
      "pinned pattern",
    ],
    [
      "class-name pattern changed",
      (c) =>
        (c.css.lightningcss.cssModules = { pure: true, pattern: "[local]" }),
      "pinned pattern",
    ],
    ...["include", "exclude", "drafts", "nonStandard", "customAtRules"].map(
      (option) => [
        `${option} set`,
        (c) => (c.css.lightningcss[option] = option === "drafts" ? {} : 1),
        option,
      ],
    ),
    ["visitor missing", (c) => delete c.css.lightningcss.visitor, "visitor"],
    [
      "visitor augmented",
      (c) =>
        (c.css.lightningcss.visitor = {
          ...c.css.lightningcss.visitor,
          Rule() {},
        }),
      "visitor",
    ],
    [
      "transformer changed",
      (c) => (c.css.transformer = "postcss"),
      "transformer",
    ],
  ])("fails with %s", (_label, edit, setting) => {
    const found = changed(edit);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(setting);
  });

  const plugin = () => ({ name: "probe:unapproved", generateBundle() {} });
  // Each channel goes through Vite's own resolution, so aliases and merging are Vite's.
  it.each([
    [
      "rolldownOptions.plugins array",
      { build: { rolldownOptions: { plugins: [plugin()] } } },
      "build.rolldownOptions.plugins",
    ],
    [
      "rolldownOptions.plugins single plugin",
      { build: { rolldownOptions: { plugins: plugin() } } },
      "build.rolldownOptions.plugins",
    ],
    [
      "rolldownOptions.plugins promise",
      { build: { rolldownOptions: { plugins: Promise.resolve([plugin()]) } } },
      "build.rolldownOptions.plugins",
    ],
    [
      "rolldownOptions.plugins empty",
      { build: { rolldownOptions: { plugins: [] } } },
      "build.rolldownOptions.plugins",
    ],
    [
      "rollupOptions alias plugins",
      { build: { rollupOptions: { plugins: [plugin()] } } },
      "build.rolldownOptions.plugins",
    ],
    [
      "output plugins",
      { build: { rolldownOptions: { output: { plugins: [plugin()] } } } },
      "build.rolldownOptions.output.plugins",
    ],
    [
      // Vite merges the configured output object in front of the inline array.
      "output array plugins",
      {
        build: {
          rolldownOptions: { output: [{}, { plugins: [plugin()] }] },
        },
      },
      "build.rolldownOptions.output[2].plugins",
    ],
    [
      "environment plugins",
      {
        environments: {
          client: { build: { rolldownOptions: { plugins: [plugin()] } } },
        },
      },
      "environments.client.build.rolldownOptions.plugins",
    ],
    [
      "environment output plugins",
      {
        environments: {
          client: {
            build: { rolldownOptions: { output: { plugins: [plugin()] } } },
          },
        },
      },
      "environments.client.build.rolldownOptions.output.plugins",
    ],
    [
      "worker plugins",
      { worker: { rolldownOptions: { plugins: [plugin()] } } },
      "worker.rolldownOptions.plugins",
    ],
  ])(
    "fails with %s",
    async (_label, inline, channel) => {
      const config = await resolveConfig(
        { root: web, configFile: join(web, "vite.config.ts"), ...inline },
        "build",
        "production",
      );
      expect(contractViolations(config)).toContain(`${channel} is set`);
    },
    60_000,
  );

  it("fails on an inherited plugins key", () => {
    const found = changed(
      (c) =>
        (c.build.rolldownOptions = Object.create(
          { plugins: [plugin()] },
          { output: { value: c.build.rolldownOptions.output } },
        )),
    );
    expect(found).toContain("build.rolldownOptions.plugins is set");
  });

  it("fails when both target settings change together", () => {
    expect(
      changed((c) => {
        c.build.cssTarget = ["chrome120"];
        c.css.lightningcss.targets = { chrome: 1 };
      }),
    ).toHaveLength(2);
  });
});
