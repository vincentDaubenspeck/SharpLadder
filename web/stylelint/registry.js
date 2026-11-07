import { readFileSync } from "node:fs";

const here = new URL("./", import.meta.url);

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, here), "utf8"));
}

function readOptional(relative, missing, part) {
  try {
    return readJson(relative);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    missing.push(part);
    return undefined;
  }
}

function add(tokens, name, entry) {
  const known = tokens.get(name);
  if (known && JSON.stringify(known) !== JSON.stringify(entry)) {
    throw new Error(`registry defines ${name} twice with different data`);
  }
  tokens.set(name, entry);
}

/** A part left undefined is reported as missing, never treated as empty. */
function buildRegistry({ core, spacing, typePairs, radius }, missing) {
  const tokens = new Map();
  const pairs = new Map();
  for (const name of core.colour.names) {
    add(tokens, name, { category: "colour", ...core.colour.exact[name] });
  }
  for (const name of core.fontStacks)
    add(tokens, name, { category: "font-stack" });
  for (const entry of core.layout) {
    add(tokens, entry.name, { category: "layout", ...entry });
  }
  for (const pair of [...core.namedTypePairs, ...(typePairs ?? [])]) {
    add(tokens, pair.fontSize.name, {
      category: "font-size",
      value: pair.fontSize.value,
    });
    add(tokens, pair.lineHeight.name, {
      category: "line-height",
      value: pair.lineHeight.value,
    });
    const paired = pairs.get(pair.fontSize.name);
    if (paired !== undefined && paired !== pair.lineHeight.name) {
      throw new Error(`registry pairs ${pair.fontSize.name} twice`);
    }
    pairs.set(pair.fontSize.name, pair.lineHeight.name);
    pairs.set(pair.lineHeight.name, pair.fontSize.name);
  }
  for (const entry of spacing ?? []) {
    add(tokens, entry.name, { category: "spacing", value: entry.value });
  }
  for (const entry of radius ?? []) {
    add(tokens, entry.name, { category: "radius", value: entry.value });
  }
  if (typePairs === undefined && !missing.includes("type catalogue")) {
    missing.push("type catalogue");
  }
  if (spacing === undefined && !missing.includes("spacing inventory")) {
    missing.push("spacing inventory");
  }
  if (radius === undefined && !missing.includes("radius"))
    missing.push("radius");
  return { tokens, pairs, missing };
}

/** A missing radius.json is reported, so production lint cannot pass without radius tokens. */
export function productionRegistry() {
  const missing = [];
  const core = readJson("registry/core.json");
  const spacing = readOptional(
    "registry/spacing-inventory.json",
    missing,
    "spacing inventory",
  );
  const catalogue = readOptional(
    "registry/type-catalogue.json",
    missing,
    "type catalogue",
  );
  const radius = readOptional("registry/radius.json", missing, "radius");
  return buildRegistry(
    {
      core,
      spacing: spacing?.tokens.map(({ name, value }) => ({ name, value })),
      typePairs: catalogue?.pairs,
      radius: radius?.tokens,
    },
    missing,
  );
}

/** Fixture names only; they never stand for production names. */
export function fixtureRegistry() {
  const fixture = readJson("fixtures/registry.json");
  return buildRegistry(
    { core: readJson("registry/core.json"), ...fixture },
    [],
  );
}
