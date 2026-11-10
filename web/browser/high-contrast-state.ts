// The SPI state contract shared by the run, its restore checks and the post-restore judgement; pure
// data rules with no process, browser or file access.

/** The two schemes the acceptance turns on; both are read back by name. */
export const schemes = ["High Contrast Black", "High Contrast White"] as const;
export type Scheme = (typeof schemes)[number];

/** One SPI read-back: flags, scheme name, system colours, registry and theme. */
export interface HighContrastState {
  flags: number;
  on: boolean;
  available: boolean;
  scheme: string;
  colours: Record<string, string>;
  registry: Record<string, string>;
  theme: string;
  osBuild: string;
  imageVersion: string;
  fontSmoothing: Record<FontSmoothingKey, number>;
  sysColors: number[];
}

/** The four font-smoothing readings, in the order both contracts report them. */
export const fontSmoothingKeys = [
  "smoothing",
  "type",
  "contrast",
  "orientation",
] as const;
type FontSmoothingKey = (typeof fontSmoothingKeys)[number];

/** Raw GetSysColor readings for COLOR_SCROLLBAR (0) to COLOR_MENUBAR (30), by index. */
export const sysColorCount = 31;

/** A raw SPI or GetSysColor reading: a whole number that fits a 32-bit unsigned value. */
const rawValue = (value: unknown) =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 0xffffffff;

/** The eight system colours the script reads, in the order both contracts report them. */
export const colourKeys = [
  "window",
  "windowText",
  "highlight",
  "highlightText",
  "buttonFace",
  "buttonText",
  "grayText",
  "hotlight",
] as const;

const stateKeys = [
  "flags",
  "on",
  "available",
  "scheme",
  "colours",
  "registry",
  "theme",
  "osBuild",
  "imageVersion",
  "fontSmoothing",
  "sysColors",
] as const;

/** Registry values the OS rewrites on a scheme change; recorded before and after, never compared. */
export const evidenceOnly = [
  "LastUpdatedThemeId",
  "Previous High Contrast Scheme MUI Ptr",
] as const;

/** Registry values that hold a scheme name and follow the off-only last-enabled rule. */
export const nameKeys = [
  "High Contrast Scheme",
  "Previous High Contrast Scheme MUI Value",
] as const;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Why a value is not a complete state; the same checks as Get-ShapeProblem in the contract script. */
export function shapeProblems(value: unknown, name: string): string[] {
  if (!isObject(value)) return [`malformed ${name}: not an object`];
  const known: readonly string[] = stateKeys;
  const keys = [
    ...stateKeys
      .filter((key) => !Object.hasOwn(value, key))
      .map((key) => `malformed ${name}: ${key} missing`),
    ...Object.keys(value)
      .filter((key) => !known.includes(key))
      .map((key) => `malformed ${name}: ${key} unexpected`),
  ];
  if (keys.length > 0) return keys;
  const problems: string[] = [];
  if (!Number.isInteger(value["flags"]))
    problems.push(`malformed ${name}: flags`);
  for (const key of ["on", "available"])
    if (typeof value[key] !== "boolean")
      problems.push(`malformed ${name}: ${key}`);
  for (const key of ["scheme", "theme", "osBuild", "imageVersion"])
    if (typeof value[key] !== "string")
      problems.push(`malformed ${name}: ${key}`);
  const colours = value["colours"];
  if (!isObject(colours) || Object.keys(colours).length !== colourKeys.length)
    problems.push(`malformed ${name}: colours`);
  else
    for (const key of colourKeys) {
      const colour = colours[key];
      if (typeof colour !== "string" || !/^#[0-9A-F]{6}$/u.test(colour))
        problems.push(`malformed ${name}: colour ${key}`);
    }
  const registry = value["registry"];
  if (!isObject(registry)) problems.push(`malformed ${name}: registry`);
  else
    for (const [key, entry] of Object.entries(registry))
      if (typeof entry !== "string")
        problems.push(`malformed ${name}: registry ${key}`);
  const smoothing = value["fontSmoothing"];
  if (
    !isObject(smoothing) ||
    Object.keys(smoothing).length !== fontSmoothingKeys.length
  )
    problems.push(`malformed ${name}: fontSmoothing`);
  else
    for (const key of fontSmoothingKeys)
      if (!Object.hasOwn(smoothing, key) || !rawValue(smoothing[key]))
        problems.push(`malformed ${name}: fontSmoothing ${key}`);
  const sysColors = value["sysColors"];
  if (!Array.isArray(sysColors) || sysColors.length !== sysColorCount)
    problems.push(`malformed ${name}: sysColors`);
  else
    sysColors.forEach((entry: unknown, i) => {
      if (!rawValue(entry))
        problems.push(`malformed ${name}: sysColor ${String(i)}`);
    });
  return problems;
}

/** A parsed state, or an error naming every shape problem. */
export function parseState(value: unknown, name: string): HighContrastState {
  const problems = shapeProblems(value, name);
  if (problems.length > 0)
    throw new Error(`high contrast: ${problems.join("; ")}`);
  return value as HighContrastState;
}

const format = (present: boolean, value: unknown) => {
  if (!present) return "<missing>";
  return typeof value === "string" ? `'${value}'` : String(value);
};

// A name field may also be the last enabled scheme, but only while high contrast is off.
function namePermitted(
  was: string | undefined,
  now: string | undefined,
  on: boolean,
  lastEnabled: Scheme | null,
) {
  if (was === now) return true;
  return !on && lastEnabled !== null && now === lastEnabled;
}

function checkLastEnabled(lastEnabled: Scheme | null) {
  if (
    lastEnabled !== null &&
    !(schemes as readonly string[]).includes(lastEnabled)
  )
    throw new Error(
      `last enabled scheme '${lastEnabled}' is not a known scheme`,
    );
}

export const own = (record: Record<string, string>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/**
 * Differences between the immutable baseline and an observed state. Every field is compared
 * exactly; the SPI scheme name and the registry name values may also be the last enabled
 * scheme while off, and only the evidence-only registry values are left out.
 * The contract script carries the same rules; a test runs one table through both.
 */
export function restoredProblems(
  baseline: unknown,
  observed: unknown,
  lastEnabled: Scheme | null,
): string[] {
  checkLastEnabled(lastEnabled);
  const shape = [
    ...shapeProblems(baseline, "baseline"),
    ...shapeProblems(observed, "observed"),
  ];
  if (shape.length > 0) return shape;
  const [was, now] = [baseline, observed] as HighContrastState[];
  if (was === undefined || now === undefined) return ["malformed state"];
  const problems: string[] = [];
  if (now.flags !== was.flags)
    problems.push(`flags ${String(now.flags)}, not ${String(was.flags)}`);
  for (const key of ["on", "available", "osBuild", "imageVersion"] as const)
    if (now[key] !== was[key])
      problems.push(
        `${key} ${format(true, now[key])}, not ${format(true, was[key])}`,
      );
  if (!namePermitted(was.scheme, now.scheme, now.on, lastEnabled))
    problems.push(`scheme '${now.scheme}', not '${was.scheme}'`);
  if (now.theme !== was.theme)
    problems.push(`theme '${now.theme}', not '${was.theme}'`);
  for (const key of colourKeys)
    if (now.colours[key] !== was.colours[key])
      problems.push(
        `colour ${key} '${String(now.colours[key])}', not '${String(was.colours[key])}'`,
      );
  const keys = [
    ...new Set([...Object.keys(was.registry), ...Object.keys(now.registry)]),
  ].sort();
  for (const key of keys) {
    if ((evidenceOnly as readonly string[]).includes(key)) continue;
    const [before, after] = [own(was.registry, key), own(now.registry, key)];
    const same = (nameKeys as readonly string[]).includes(key)
      ? namePermitted(before, after, now.on, lastEnabled)
      : before === after;
    if (!same)
      problems.push(
        `registry ${key} ${format(after !== undefined, after)}, not ${format(before !== undefined, before)}`,
      );
  }
  for (const key of fontSmoothingKeys)
    if (now.fontSmoothing[key] !== was.fontSmoothing[key])
      problems.push(
        `fontSmoothing ${key} ${String(now.fontSmoothing[key])}, not ${String(was.fontSmoothing[key])}`,
      );
  for (let i = 0; i < sysColorCount; i += 1)
    if (now.sysColors[i] !== was.sysColors[i])
      problems.push(
        `sysColor ${String(i)} ${String(now.sysColors[i])}, not ${String(was.sysColors[i])}`,
      );
  return problems;
}
