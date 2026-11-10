// The expected transformation contract, kept apart from vite.config.ts so the config cannot vouch for itself.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Q6: the guard and Vite load one Lightning CSS binary of this exact version. */
export const lightningVersion = "1.33.0";

function packageRoot(file) {
  let dir = dirname(file);
  while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
  return dir;
}

/** The package folders the guard's and Vite's own resolution of lightningcss land in. */
function locateLightning() {
  const vite = fileURLToPath(import.meta.resolve("vite"));
  const ours = fileURLToPath(import.meta.resolve("lightningcss"));
  return {
    ours: packageRoot(realpathSync(ours)),
    theirs: packageRoot(
      realpathSync(createRequire(vite).resolve("lightningcss")),
    ),
  };
}

export function lightningViolations({ ours, theirs } = locateLightning()) {
  const found = [];
  if (ours !== theirs)
    found.push("the guard's lightningcss is not the one Vite loads");
  const { version } = JSON.parse(
    readFileSync(join(ours, "package.json"), "utf8"),
  );
  if (version !== lightningVersion)
    found.push(`lightningcss is ${version}, not ${lightningVersion}`);
  return found;
}

/** Lightning CSS targets from caniuse-lite 1.0.30001822; Chrome Android shares the chrome floor. */
export const lightningTargets = {
  chrome: 10223616,
  edge: 10158080,
  firefox: 10354688,
  safari: 1703936,
  ios_saf: 1703936,
};

export const cssTarget = [
  "chrome156",
  "edge155",
  "firefox158",
  "safari26",
  "ios26",
];

// A data bump can move what the targets mean, so it fails until the targets are reviewed.
export const caniuseVersion = "1.0.30001822";

// Emitted font URLs are this base plus the inventory's dist path, so the base is reviewed here.
export const publicBase = "/";

/** T 4.5: the class-name pattern is pinned, so a renaming change is a contract change. */
export const classPattern = "[hash]_[local]";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Every Lightning CSS option the build may set; include, exclude, drafts and the rest stay unset.
const lightningOptions = ["cssModules", "errorRecovery", "targets", "visitor"];

/** Fonts keep their name so a dist path is fixed by the inventory, not by a content hash. */
function assetFileName(name) {
  return name.endsWith(".woff2")
    ? "assets/[name][extname]"
    : "assets/[name]-[hash][extname]";
}

const isObject = (value) => value !== null && typeof value === "object";

/**
 * Rolldown takes plugins from these options as well, past the pinned list, so any value
 * (array, promise, single plugin or empty) fails; `in` also sees an inherited key.
 */
function pluginChannelViolations(label, options) {
  if (!isObject(options)) return [];
  const found = [];
  if ("plugins" in options) found.push(`${label}.plugins is set`);
  const { output } = options;
  const outputs = Array.isArray(output) ? output : [output];
  for (const [i, entry] of outputs.entries()) {
    const at = Array.isArray(output) ? `output[${i}]` : "output";
    if (isObject(entry) && "plugins" in entry)
      found.push(`${label}.${at}.plugins is set`);
  }
  return found;
}

/** Every build option set the bundle can read: top level, each environment and workers. */
function pluginChannels(config) {
  const sets = [["build.rolldownOptions", config.build?.rolldownOptions]];
  for (const [name, environment] of Object.entries(config.environments ?? {}))
    sets.push([
      `environments.${name}.build.rolldownOptions`,
      environment?.build?.rolldownOptions,
    ]);
  sets.push(["worker.rolldownOptions", config.worker?.rolldownOptions]);
  return sets.flatMap(([label, options]) =>
    pluginChannelViolations(label, options),
  );
}

export function contractViolations(config) {
  const found = [...pluginChannels(config)];
  const { build, css } = config;
  if (config.base !== publicBase) found.push("base is not the contract's base");
  if (build.cssMinify !== false) found.push("build.cssMinify is not false");
  if (!same(build.cssTarget, cssTarget))
    found.push("build.cssTarget differs from the contract");
  if (css.transformer !== "lightningcss")
    found.push("css.transformer is not lightningcss");
  const lightning = css.lightningcss ?? {};
  if (lightning.errorRecovery !== false)
    found.push("css.lightningcss.errorRecovery is not false");
  if (!same(lightning.targets, lightningTargets))
    found.push("css.lightningcss.targets differ from the contract");
  if (lightning.cssModules?.pure !== true)
    found.push("css.lightningcss.cssModules.pure is not true");
  else if (lightning.cssModules.pattern !== classPattern)
    found.push("css.lightningcss.cssModules.pattern is not the pinned pattern");
  else if (!same(Object.keys(lightning.cssModules).sort(), ["pattern", "pure"]))
    found.push(
      "css.lightningcss.cssModules sets an option beside pure and pattern",
    );
  for (const option of Object.keys(lightning))
    if (!lightningOptions.includes(option))
      found.push(`css.lightningcss.${option} is set outside the contract`);
  // The guard checks the visitor is its own instance; this checks its shape.
  const { visitor } = lightning;
  if (
    visitor === null ||
    typeof visitor !== "object" ||
    !same(Object.keys(visitor), ["StyleSheet"]) ||
    typeof visitor.StyleSheet !== "function"
  )
    found.push("css.lightningcss.visitor is not the C1 visitor alone");
  const output = build.rolldownOptions?.output;
  const naming = Array.isArray(output) ? undefined : output?.assetFileNames;
  if (
    typeof naming !== "function" ||
    naming({ names: ["a.woff2"] }) !== assetFileName("a.woff2") ||
    naming({ names: ["a.css"] }) !== assetFileName("a.css")
  )
    found.push("assetFileNames does not follow the contract");
  return found;
}
