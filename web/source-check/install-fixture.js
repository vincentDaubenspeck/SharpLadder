// The shared install fixture: a small lock whose tarballs are all in the real web lock.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const web = join(import.meta.dirname, "..");
const realLock = JSON.parse(
  readFileSync(join(web, "package-lock.json"), "utf8"),
);

// Every location below is copied from the real lock, so npm ci finds each tarball in the cache.
const fixturePkg = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "@npmcli/promise-spawn": "9.0.2", which: "2.0.2" },
  devDependencies: { abbrev: "4.0.0" },
  optionalDependencies: {
    picocolors: "1.1.1",
    ...(process.platform === "darwin" ? {} : { fsevents: "2.3.3" }),
  },
};
const fixtureEntries = {
  "node_modules/@npmcli/promise-spawn": {},
  "node_modules/@npmcli/promise-spawn/node_modules/which": {},
  "node_modules/@npmcli/promise-spawn/node_modules/isexe": {},
  "node_modules/which": {},
  "node_modules/isexe": {},
  "node_modules/abbrev": { dev: true },
  "node_modules/picocolors": { optional: true },
  ...(process.platform === "darwin"
    ? {}
    : { "node_modules/fsevents": { optional: true } }),
};

export const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function npmCli() {
  const dir = dirname(process.execPath);
  return [
    join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((p) => existsSync(p));
}

/** The fixture install sees no npm settings from the run that launched the tests. */
function quietEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^npm_/i.test(key) && key.toLowerCase() !== "npm_config_cache")
      delete env[key];
  delete env.NODE_ENV;
  return env;
}

export function buildFixture(clean) {
  const packages = {
    "": {
      name: fixturePkg.name,
      version: fixturePkg.version,
      dependencies: fixturePkg.dependencies,
      devDependencies: fixturePkg.devDependencies,
      optionalDependencies: fixturePkg.optionalDependencies,
    },
  };
  for (const [location, flags] of Object.entries(fixtureEntries)) {
    // The real lock's flags describe the web tree, so each fixture sets its own.
    const entry = { ...realLock.packages[location] };
    for (const key of ["dev", "optional", "peer", "devOptional"])
      delete entry[key];
    packages[location] = { ...entry, ...flags };
  }
  writeJson(join(clean, "package.json"), fixturePkg);
  writeJson(join(clean, "package-lock.json"), {
    name: fixturePkg.name,
    version: fixturePkg.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  });
  cpSync(join(web, ".npmrc"), join(clean, ".npmrc"));
  const r = spawnSync(
    process.execPath,
    [
      npmCli(),
      "ci",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: clean, env: quietEnv(), encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`fixture npm ci failed: ${r.stderr}`);
}
