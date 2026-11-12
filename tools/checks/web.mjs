// The npm-script stages of the check run, importable so a test drives the real stage code.
import { env, exec, notApplicable, report } from "./lib.mjs";

// Printed by web/stylelint/lint-production.js while web/src has no stylesheet.
const stylesheetBootstrap = "NOT APPLICABLE — no source stylesheets";

export const webStages = [
  ["lockfile-lint", "lint:lockfile"],
  // The lockfile checks never see the installed tree, where a package can be added after npm ci.
  ["Install health", ["source-check/install-health.js"]],
  // Serial, where no Vite load or other install writer is active, unlike a vitest worker.
  ["Install health (real tree acceptance)", ["source-check/install-acceptance.js"]],
  ["licence allowlist", "license:check"],
  ["asset licence inventory", "asset-licence:check"],
  ["dependency overrides", "overrides:check"],
  ["ESLint", "lint"],
  ["Stylelint (source stylesheets)", "lint:css"],
  ["Source tree", ["source-check/index.js"]],
  ["ESLint comment policy", "lint:comments"],
  ["Prettier", "format:check"],
  ["TypeScript", "typecheck"],
  // Hosted runners set CI=true, which changes tool defaults, so the local suite runs under it too.
  ["Vitest", "test", { CI: "true" }],
  // Vitest loads the Vite config into the real tree, so a leftover .vite-temp entry shows here.
  ["Install health (after Vitest)", ["source-check/install-health.js"]],
  // The same script CI runs; it lints and typechecks before vite build replaces web/dist.
  ["Production build", "build"],
  // Array form, so the stage's own environment turns off the jiti cache in node_modules.
  ["knip", ["knip/run.js"], { JITI_FS_CACHE: "false" }],
  // After the awaited acceptance tools finish, the installation still satisfies the install-health layout contract.
  ["Install health (after tools)", ["source-check/install-health.js"]],
  ["markdownlint", "lint:md"],
  ["cspell", "lint:spell"],
];

export function runWebStage(web, [name, script, stageEnv = {}], extra = []) {
  const opts = { cwd: web, env: { ...env, ...stageEnv } };
  const r = Array.isArray(script)
    ? exec(process.execPath, [...script, ...extra], opts)
    : exec("npm", ["run", "--silent", script, ...(extra.length > 0 ? ["--", ...extra] : [])], opts);
  if (r.code === 0 && script === "lint:css" && r.out.trim() === stylesheetBootstrap) {
    // The bootstrap stage is reported as inapplicable, never relabelled PASS.
    notApplicable(name, "no source stylesheets");
    return r;
  }
  report(name, r.code === 0 ? [] : [r.out]);
  return r;
}
