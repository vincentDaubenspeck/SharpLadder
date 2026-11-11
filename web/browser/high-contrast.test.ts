// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { groupDCells, themes, viewportAt } from "./group-d.ts";
import { postRestoreDeadlineMs } from "./high-contrast-cycles.ts";
import {
  baselineProblems,
  beforeDeadline,
  capability,
  colourKeys,
  enableProblems,
  encodeRun,
  engineNamed,
  evidenceOnly,
  fontSmoothingKeys,
  hostedProblems,
  hostedRunner,
  loadBaseline,
  nameKeys,
  notRunCells,
  readLastEnabled,
  recordLastEnabled,
  recorder,
  registryEvidence,
  restoredProblems,
  schemes,
  shapeProblems,
  spi,
  sysColorCount,
  tally,
  transitionWatchdogMs,
  unsupportedCells,
  verdictOf,
  withRestore,
  writeBaseline,
  type Clock,
  type HighContrastState,
  type Scheme,
} from "./high-contrast.ts";

const tools = join(import.meta.dirname, "..", "..", "tools");
// The SPI script is only ever read here, never run: it changes a session-wide OS setting.
const script = readFileSync(join(tools, "high-contrast.ps1"), "utf8");
const contractPath = join(tools, "high-contrast-contract.ps1");
const contractText = readFileSync(contractPath, "utf8");
const specText = readFileSync(
  join(import.meta.dirname, "high-contrast.pw.ts"),
  "utf8",
);
const setupText = readFileSync(
  join(import.meta.dirname, "high-contrast.setup.ts"),
  "utf8",
);
const captureText = readFileSync(
  join(import.meta.dirname, "high-contrast-capture.ts"),
  "utf8",
);
const config = readFileSync(
  join(import.meta.dirname, "..", "playwright.config.ts"),
  "utf8",
);

const hosted = (): Record<string, string | undefined> => ({ ...hostedRunner });
const never = () => {
  throw new Error("the SPI script was started");
};

const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      chmodSync(join(dir, "baseline.json"), 0o666);
    } catch {
      // Absent in tests that never wrote a baseline.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// PowerShell start-up on a loaded runner can exceed the default 5,000 ms test timeout.
const powerShellTestMs = 120_000;

// The decision half only: no OS read or write, so it is safe on every host.
function contract(body: string, input: unknown): unknown {
  const dir = temp();
  const data = join(dir, "in.json");
  const file = join(dir, "run.ps1");
  writeFileSync(data, JSON.stringify(input));
  writeFileSync(
    file,
    `$ErrorActionPreference = 'Stop'\n. '${contractPath}'\n$in = [IO.File]::ReadAllText('${data}') | ConvertFrom-Json\n${body}\n`,
  );
  const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const result = spawnSync(
    shell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      file,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.status !== 0)
    throw new Error(
      `contract script exited ${String(result.status)}: ${result.stderr}`,
    );
  return JSON.parse(result.stdout);
}

const base = (): HighContrastState => ({
  flags: 126,
  on: false,
  available: true,
  scheme: "",
  colours: {
    window: "#FFFFFF",
    windowText: "#000000",
    highlight: "#0078D4",
    highlightText: "#FFFFFF",
    buttonFace: "#F0F0F0",
    buttonText: "#000000",
    grayText: "#6D6D6D",
    hotlight: "#0066CC",
  },
  registry: {
    Flags: "126",
    "High Contrast Scheme": "",
    "Previous High Contrast Scheme MUI Value": "",
  },
  theme: "C:\\Windows\\resources\\Themes\\aero.theme",
  osBuild: "26100.33674",
  imageVersion: "20261103.298.1",
  fontSmoothing: { smoothing: 1, type: 2, contrast: 1200, orientation: 1 },
  sysColors: Array.from(
    { length: sysColorCount },
    (_, i) => (i * 0x050403) & 0xffffff,
  ),
});
const withSysColor = (index: number, value: unknown) => {
  const sysColors: unknown[] = [...base().sysColors];
  sysColors[index] = value;
  return { ...base(), sysColors };
};
const withSmoothing = (edit: (s: Record<string, unknown>) => void) => {
  const fontSmoothing: Record<string, unknown> = { ...base().fontSmoothing };
  edit(fontSmoothing);
  return { ...base(), fontSmoothing };
};

// A palette unlike the baseline; the readiness rule never names particular colours.
const contrastPalette = Object.fromEntries(
  colourKeys.map((key, i) => [key, `#2020${String(10 + i)}`]),
);
const otherPalette = Object.fromEntries(
  colourKeys.map((key, i) => [key, `#3030${String(10 + i)}`]),
);
const enabled = (scheme: Scheme): HighContrastState => ({
  ...base(),
  flags: 127,
  on: true,
  scheme,
  colours: { ...contrastPalette },
  registry: { ...base().registry, "High Contrast Scheme": scheme },
});
const residue = (scheme: Scheme): HighContrastState => ({
  ...base(),
  scheme,
  registry: { ...base().registry, "High Contrast Scheme": scheme },
});
const withRegistry = (
  state: HighContrastState,
  edit: (r: Record<string, string>) => void,
) => {
  const registry = { ...state.registry };
  edit(registry);
  return { ...state, registry };
};
const muiValue = (state: HighContrastState, value: string) =>
  withRegistry(
    state,
    (r) => (r["Previous High Contrast Scheme MUI Value"] = value),
  );

describe("hosted-runner guard", () => {
  it("admits only the full table on win32", () => {
    expect(hostedProblems(hosted(), "win32")).toEqual([]);
    expect(hostedProblems(hosted(), "linux")).toEqual([
      "platform is linux, not win32",
    ]);
  });

  it.each(Object.keys(hostedRunner))(
    "refuses when %s is absent or differs",
    (name) => {
      const missing = { ...hosted(), [name]: undefined };
      expect(hostedProblems(missing, "win32")).toEqual([
        `${name} is not ${hostedRunner[name] ?? ""}`,
      ]);
      const changed = { ...hosted(), [name]: `${hostedRunner[name] ?? ""}x` };
      expect(hostedProblems(changed, "win32")).toHaveLength(1);
    },
  );

  it("compares values exactly", () => {
    expect(
      hostedProblems({ ...hosted(), GITHUB_ACTIONS: "True" }, "win32"),
    ).toHaveLength(1);
    expect(hostedProblems({}, "win32")).toHaveLength(
      Object.keys(hostedRunner).length,
    );
  });

  it("admits only the windows-2025 image with Visual Studio 2026", () => {
    expect(hostedRunner["ImageOS"]).toBe("win25-vs2026");
    for (const image of ["win25", "win25-vs2022", "WIN25-VS2026", "win22"])
      expect(hostedProblems({ ...hosted(), ImageOS: image }, "win32")).toEqual([
        "ImageOS is not win25-vs2026",
      ]);
  });

  it("never starts the script on a refused host", () => {
    for (const [env, platform] of [
      [{}, "win32"],
      [{ ...hosted(), SHARPLADDER_REAL_HIGH_CONTRAST: undefined }, "win32"],
      [{ ...hosted(), USERNAME: "someone" }, "win32"],
      [hosted(), "linux"],
    ] as const)
      expect(() => spi("read", {}, { env, platform, spawn: never })).toThrow(
        /refused, not an opted-in hosted runner/,
      );
  });

  it("passes every option, bounds the child by a watchdog and rejects a malformed read-back", () => {
    const calls: { args: string[]; timeout: number }[] = [];
    const state = spi(
      "enable",
      {
        scheme: "High Contrast Black",
        baseline: "b.json",
        lastEnabled: "High Contrast White",
        evidence: "e.json",
      },
      {
        env: hosted(),
        platform: "win32",
        spawn: (_command, args, timeout) => {
          calls.push({ args, timeout });
          return {
            status: 0,
            stdout: JSON.stringify(enabled("High Contrast Black")),
            stderr: "",
          };
        },
      },
    );
    expect(state.on).toBe(true);
    expect(calls[0]?.args.slice(-10)).toEqual([
      "-Action",
      "enable",
      "-Scheme",
      "High Contrast Black",
      "-Baseline",
      "b.json",
      "-LastEnabled",
      "High Contrast White",
      "-Evidence",
      "e.json",
    ]);
    expect(calls[0]?.timeout).toBe(transitionWatchdogMs);
    expect(transitionWatchdogMs).toBeGreaterThan(30_000);
    const hostedSpawn = (stdout: string, status = 0) => ({
      env: hosted(),
      platform: "win32" as const,
      spawn: () => ({ status, stdout, stderr: "SPI failed" }),
    });
    expect(() => spi("read", {}, hostedSpawn('{"on":true}'))).toThrow(
      /malformed read: flags missing/u,
    );
    expect(() => spi("read", {}, hostedSpawn("", 1))).toThrow(
      /read exited 1: SPI failed/u,
    );
  });
});

interface Row {
  name: string;
  kind: "restore" | "enable";
  baseline: unknown;
  observed: unknown;
  last: Scheme | null;
  scheme: Scheme;
  want?: string[];
}

const restore = (
  name: string,
  observed: unknown,
  last: Scheme | null,
  want?: string[],
  baseline: unknown = base(),
): Row => ({
  name,
  kind: "restore",
  baseline,
  observed,
  last,
  scheme: "High Contrast Black",
  ...(want === undefined ? {} : { want }),
});
const enable = (name: string, observed: unknown, want: string[]): Row => ({
  name,
  kind: "enable",
  baseline: base(),
  observed,
  last: null,
  scheme: "High Contrast Black",
  want,
});

// One table for both implementations: every compared field, every registry classification.
const table = JSON.parse(
  JSON.stringify([
    restore("identical", base(), null, []),
    restore("flags", { ...base(), flags: 127 }, null, ["flags 127, not 126"]),
    restore("on", { ...base(), on: true }, null, ["on true, not false"]),
    restore("available", { ...base(), available: false }, null, [
      "available false, not true",
    ]),
    restore("osBuild", { ...base(), osBuild: "26100.1" }, null, [
      "osBuild '26100.1', not '26100.33674'",
    ]),
    restore("imageVersion", { ...base(), imageVersion: "2" }, null, [
      "imageVersion '2', not '20261103.298.1'",
    ]),
    ...colourKeys.map((key) =>
      restore(
        `colour ${key}`,
        { ...base(), colours: { ...base().colours, [key]: "#123456" } },
        null,
        [`colour ${key} '#123456', not '${base().colours[key] ?? ""}'`],
      ),
    ),
    restore(
      "theme case",
      { ...base(), theme: base().theme.replace("aero", "Aero") },
      null,
      [
        "theme 'C:\\Windows\\resources\\Themes\\Aero.theme', not 'C:\\Windows\\resources\\Themes\\aero.theme'",
      ],
    ),
    restore(
      "last enabled name while off",
      residue("High Contrast Black"),
      "High Contrast Black",
      [],
    ),
    restore(
      "name before the first enable",
      residue("High Contrast Black"),
      null,
      [
        "scheme 'High Contrast Black', not ''",
        "registry High Contrast Scheme 'High Contrast Black', not ''",
      ],
    ),
    restore(
      "wrong last scheme",
      residue("High Contrast Black"),
      "High Contrast White",
      [
        "scheme 'High Contrast Black', not ''",
        "registry High Contrast Scheme 'High Contrast Black', not ''",
      ],
    ),
    restore(
      "unrelated scheme",
      { ...base(), scheme: "High Contrast #1" },
      "High Contrast Black",
      ["scheme 'High Contrast #1', not ''"],
    ),
    restore(
      "last enabled name while on",
      { ...residue("High Contrast Black"), on: true, flags: 127 },
      "High Contrast Black",
      [
        "flags 127, not 126",
        "on true, not false",
        "scheme 'High Contrast Black', not ''",
        "registry High Contrast Scheme 'High Contrast Black', not ''",
      ],
    ),
    restore(
      "non-empty baseline scheme kept",
      residue("High Contrast White"),
      "High Contrast Black",
      [],
      residue("High Contrast White"),
    ),
    restore(
      "non-empty baseline scheme, last enabled",
      residue("High Contrast Black"),
      "High Contrast Black",
      [],
      residue("High Contrast White"),
    ),
    restore(
      "non-empty baseline scheme emptied",
      {
        ...base(),
        registry: {
          ...base().registry,
          "High Contrast Scheme": "High Contrast White",
        },
      },
      "High Contrast Black",
      ["scheme '', not 'High Contrast White'"],
      residue("High Contrast White"),
    ),
    restore(
      "registry Flags",
      withRegistry(base(), (r) => (r["Flags"] = "127")),
      null,
      ["registry Flags '127', not '126'"],
    ),
    restore(
      "registry key added",
      withRegistry(base(), (r) => (r["Extra"] = "")),
      null,
      ["registry Extra '', not <missing>"],
    ),
    restore(
      "registry key deleted",
      withRegistry(base(), (r) => delete r["Flags"]),
      null,
      ["registry Flags <missing>, not '126'"],
    ),
    restore(
      "MUI Value at its baseline value",
      muiValue(base(), "High Contrast White"),
      "High Contrast Black",
      [],
      muiValue(base(), "High Contrast White"),
    ),
    restore(
      "MUI Value is the last enabled name while off",
      muiValue(base(), "High Contrast Black"),
      "High Contrast Black",
      [],
    ),
    restore(
      "MUI Value is the last enabled name before any enable",
      muiValue(base(), "High Contrast Black"),
      null,
      [
        "registry Previous High Contrast Scheme MUI Value 'High Contrast Black', not ''",
      ],
    ),
    restore(
      "MUI Value is the last enabled name while on",
      { ...muiValue(base(), "High Contrast Black"), on: true, flags: 127 },
      "High Contrast Black",
      [
        "flags 127, not 126",
        "on true, not false",
        "registry Previous High Contrast Scheme MUI Value 'High Contrast Black', not ''",
      ],
    ),
    restore(
      "MUI Value is a different scheme",
      muiValue(base(), "High Contrast White"),
      "High Contrast Black",
      [
        "registry Previous High Contrast Scheme MUI Value 'High Contrast White', not ''",
      ],
    ),
    restore(
      "MUI Value missing is not empty",
      withRegistry(
        base(),
        (r) => delete r["Previous High Contrast Scheme MUI Value"],
      ),
      "High Contrast Black",
      ["registry Previous High Contrast Scheme MUI Value <missing>, not ''"],
    ),
    restore(
      "MUI Value empty is not missing",
      base(),
      "High Contrast Black",
      ["registry Previous High Contrast Scheme MUI Value '', not <missing>"],
      withRegistry(
        base(),
        (r) => delete r["Previous High Contrast Scheme MUI Value"],
      ),
    ),
    restore(
      "MUI Value in another case",
      muiValue(base(), "high contrast black"),
      "High Contrast Black",
      [
        "registry Previous High Contrast Scheme MUI Value 'high contrast black', not ''",
      ],
    ),
    restore(
      "MUI Value containing the last enabled name",
      muiValue(base(), "High Contrast Black #1"),
      "High Contrast Black",
      [
        "registry Previous High Contrast Scheme MUI Value 'High Contrast Black #1', not ''",
      ],
    ),
    restore(
      "MUI Value within the last enabled name",
      muiValue(base(), "Contrast Black"),
      "High Contrast Black",
      [
        "registry Previous High Contrast Scheme MUI Value 'Contrast Black', not ''",
      ],
    ),
    restore(
      "Previous High Contrast Scheme is compared",
      withRegistry(
        base(),
        (r) => (r["Previous High Contrast Scheme"] = "High Contrast Black"),
      ),
      "High Contrast Black",
      [
        "registry Previous High Contrast Scheme 'High Contrast Black', not <missing>",
      ],
    ),
    restore(
      "evidence-only values added",
      withRegistry(base(), (r) => {
        r["LastUpdatedThemeId"] = "0";
        r["Previous High Contrast Scheme MUI Ptr"] = "@themeui.dll,-852";
      }),
      null,
      [],
    ),
    restore(
      "evidence-only value removed",
      base(),
      null,
      [],
      withRegistry(base(), (r) => (r["LastUpdatedThemeId"] = "0")),
    ),
    restore(
      "evidence-only name in another case is compared",
      withRegistry(base(), (r) => (r["lastUpdatedThemeId"] = "0")),
      null,
      ["registry lastUpdatedThemeId '0', not <missing>"],
    ),
    restore(
      "missing scheme key stays missing",
      withRegistry(base(), (r) => delete r["High Contrast Scheme"]),
      "High Contrast Black",
      [],
      withRegistry(base(), (r) => delete r["High Contrast Scheme"]),
    ),
    restore(
      "missing scheme key is not an empty string",
      base(),
      "High Contrast Black",
      ["registry High Contrast Scheme '', not <missing>"],
      withRegistry(base(), (r) => delete r["High Contrast Scheme"]),
    ),
    restore(
      "missing scheme key may become the last enabled name",
      residue("High Contrast Black"),
      "High Contrast Black",
      [],
      withRegistry(base(), (r) => delete r["High Contrast Scheme"]),
    ),
    restore(
      "scheme key removed",
      withRegistry(base(), (r) => delete r["High Contrast Scheme"]),
      "High Contrast Black",
      ["registry High Contrast Scheme <missing>, not ''"],
    ),
    ...fontSmoothingKeys.map((key) =>
      restore(
        `fontSmoothing ${key} drift`,
        withSmoothing((s) => (s[key] = 7)),
        "High Contrast Black",
        [`fontSmoothing ${key} 7, not ${String(base().fontSmoothing[key])}`],
      ),
    ),
    ...[0, 15, 30].map((index) =>
      restore(
        `sysColor ${String(index)} drift`,
        withSysColor(index, 0xabcdef),
        "High Contrast Black",
        [
          `sysColor ${String(index)} 11259375, not ${String(base().sysColors[index])}`,
        ],
      ),
    ),
    restore(
      "fontSmoothing and colour slots drift together",
      {
        ...withSysColor(4, 0),
        fontSmoothing: { ...base().fontSmoothing, contrast: 1000 },
      },
      null,
      ["fontSmoothing contrast 1000, not 1200", "sysColor 4 0, not 1314828"],
    ),
    restore(
      "fontSmoothing missing",
      { ...base(), fontSmoothing: undefined },
      null,
      ["malformed observed: fontSmoothing missing"],
    ),
    restore("sysColors missing", { ...base(), sysColors: undefined }, null, [
      "malformed observed: sysColors missing",
    ]),
    restore("a key outside the contract", { ...base(), extra: 1 }, null, [
      "malformed observed: extra unexpected",
    ]),
    restore(
      "baseline without sysColors",
      base(),
      null,
      ["malformed baseline: sysColors missing"],
      { ...base(), sysColors: undefined },
    ),
    restore(
      "fontSmoothing value missing",
      withSmoothing((s) => delete s["orientation"]),
      null,
      ["malformed observed: fontSmoothing"],
    ),
    restore(
      "fontSmoothing value renamed",
      withSmoothing((s) => {
        delete s["orientation"];
        s["Orientation"] = 1;
      }),
      null,
      ["malformed observed: fontSmoothing orientation"],
    ),
    restore(
      "fontSmoothing value as a string",
      withSmoothing((s) => (s["type"] = "2")),
      null,
      ["malformed observed: fontSmoothing type"],
    ),
    restore(
      "fontSmoothing value as a boolean",
      withSmoothing((s) => (s["smoothing"] = true)),
      null,
      ["malformed observed: fontSmoothing smoothing"],
    ),
    restore(
      "fontSmoothing as a list",
      { ...base(), fontSmoothing: [1, 2, 1200, 1] },
      null,
      ["malformed observed: fontSmoothing"],
    ),
    restore(
      "sysColors as an object",
      { ...base(), sysColors: { 0: 1 } },
      null,
      ["malformed observed: sysColors"],
    ),
    restore("sysColor as a string", withSysColor(3, "3"), null, [
      "malformed observed: sysColor 3",
    ]),
    restore("sysColor fractional", withSysColor(5, 1.5), null, [
      "malformed observed: sysColor 5",
    ]),
    restore("sysColor negative", withSysColor(6, -1), null, [
      "malformed observed: sysColor 6",
    ]),
    restore("sysColor above 32 bits", withSysColor(7, 4294967296), null, [
      "malformed observed: sysColor 7",
    ]),
    restore("sysColor null", withSysColor(8, null), null, [
      "malformed observed: sysColor 8",
    ]),
    restore(
      "thirty sysColors",
      { ...base(), sysColors: base().sysColors.slice(1) },
      null,
      ["malformed observed: sysColors"],
    ),
    restore(
      "thirty-two sysColors",
      { ...base(), sysColors: [...base().sysColors, 0] },
      null,
      ["malformed observed: sysColors"],
    ),
    restore("not an object", "x", null, ["malformed observed: not an object"]),
    restore("missing colours", { ...base(), colours: undefined }, null, [
      "malformed observed: colours missing",
    ]),
    restore(
      "seven colours",
      { ...base(), colours: { ...base().colours, hotlight: undefined } },
      null,
      ["malformed observed: colours"],
    ),
    restore(
      "lower-case colour",
      { ...base(), colours: { ...base().colours, window: "#ffffff" } },
      null,
      ["malformed observed: colour window"],
    ),
    restore("string flags", { ...base(), flags: "126" }, null, [
      "malformed observed: flags",
    ]),
    restore(
      "numeric registry value",
      { ...base(), registry: { ...base().registry, Flags: 126 } },
      null,
      ["malformed observed: registry Flags"],
    ),
    restore(
      "malformed baseline",
      base(),
      null,
      ["malformed baseline: not an object"],
      null,
    ),
    enable("ready", enabled("High Contrast Black"), []),
    enable(
      "readiness on the unchanged palette",
      { ...enabled("High Contrast Black"), colours: base().colours },
      ["palette unchanged from the baseline"],
    ),
    enable("wrong scheme", enabled("High Contrast White"), [
      "scheme 'High Contrast White', not 'High Contrast Black'",
    ]),
    enable(
      "still off",
      { ...enabled("High Contrast Black"), on: false, flags: 126 },
      ["on false, not true", "flags 126, not 127"],
    ),
    enable(
      "unrelated flag dropped",
      { ...enabled("High Contrast Black"), flags: 123 },
      ["flags 123, not 127"],
    ),
    enable(
      "unavailable",
      { ...enabled("High Contrast Black"), available: false },
      ["available false, not true"],
    ),
    enable("malformed", { ...enabled("High Contrast Black"), on: "true" }, [
      "malformed observed: on",
    ]),
    enable(
      "on-state smoothing and colour slots are not compared with the baseline",
      {
        ...enabled("High Contrast Black"),
        fontSmoothing: { ...base().fontSmoothing, type: 1 },
        sysColors: base().sysColors.map(() => 0),
      },
      [],
    ),
    enable(
      "on-state shape is still checked",
      { ...enabled("High Contrast Black"), sysColors: [] },
      ["malformed observed: sysColors"],
    ),
  ]),
) as Row[];

const decide = (row: Row) =>
  row.kind === "restore"
    ? restoredProblems(row.baseline, row.observed, row.last)
    : enableProblems(row.baseline, row.observed, row.scheme);

describe("restore and enable contract", () => {
  it.each(table.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(decide(row)).toEqual(row.want);
  });

  it("covers every compared field and every registry classification", () => {
    const failing = table.flatMap(decide).join("\n");
    for (const field of [
      "flags",
      "on",
      "available",
      "osBuild",
      "imageVersion",
      "scheme",
      "theme",
    ])
      expect(failing).toMatch(new RegExp(`^${field} `, "mu"));
    for (const key of colourKeys) expect(failing).toContain(`colour ${key} `);
    for (const key of fontSmoothingKeys)
      expect(failing).toMatch(new RegExp(`^fontSmoothing ${key} `, "mu"));
    expect(failing).toMatch(/^sysColor 0 /mu);
    expect(failing).toMatch(/^sysColor 30 /mu);
    for (const key of [
      "Flags",
      "High Contrast Scheme",
      "Extra",
      "Previous High Contrast Scheme MUI Value",
      "Previous High Contrast Scheme",
    ])
      expect(failing).toContain(`registry ${key} `);
    for (const key of evidenceOnly)
      expect(failing).not.toContain(`registry ${key} `);
  });

  it(
    "the contract script returns the same problems for every row",
    () => {
      const rows = table;
      const out = contract(
        `$out = foreach ($row in $in) {
  $p = if ($row.kind -eq 'restore') { Get-RestoreProblem $row.baseline $row.observed $row.last } else { Get-EnableProblem $row.baseline $row.observed $row.scheme }
  [pscustomobject]@{ problems = [object[]]$p }
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress`,
        rows,
      ) as { problems: string[] }[];
      expect(out.map((r) => r.problems)).toEqual(rows.map(decide));
    },
    powerShellTestMs,
  );

  it("names the same colours, evidence-only values, name values and schemes in both implementations", () => {
    const list = (name: string) =>
      [
        ...(
          new RegExp(`\\$script:${name} = @\\(([^)]*)\\)`, "u").exec(
            contractText,
          )?.[1] ?? ""
        ).matchAll(/'([^']*)'/gu),
      ].map((m) => m[1]);
    expect(list("colourKeys")).toEqual([...colourKeys]);
    expect(list("evidenceOnly")).toEqual([...evidenceOnly]);
    expect(list("nameKeys")).toEqual([...nameKeys]);
    expect(list("schemeNames")).toEqual([...schemes]);
    expect(list("fontSmoothingKeys")).toEqual([...fontSmoothingKeys]);
    expect(/\$script:sysColorCount = (\d+)\r?\n/u.exec(contractText)?.[1]).toBe(
      String(sysColorCount),
    );
    expect(list("stateKeys").slice(-2)).toEqual(["fontSmoothing", "sysColors"]);
  });

  it("records the evidence-only values in full with presence", () => {
    const after = withRegistry(residue("High Contrast Black"), (r) => {
      r["LastUpdatedThemeId"] = "0";
      r["Previous High Contrast Scheme MUI Ptr"] = "@themeui.dll,-852";
    });
    expect(registryEvidence(base(), after)).toEqual([
      {
        key: "LastUpdatedThemeId",
        before: { present: false, value: null },
        after: { present: true, value: "0" },
      },
      {
        key: "Previous High Contrast Scheme MUI Ptr",
        before: { present: false, value: null },
        after: { present: true, value: "@themeui.dll,-852" },
      },
    ]);
  });

  it("refuses an unknown last enabled scheme", () => {
    expect(() => restoredProblems(base(), base(), "Other" as Scheme)).toThrow(
      /not a known scheme/u,
    );
  });
});

interface Step {
  state: unknown;
  error: string | null;
  delayMs?: number;
}
const steps = (count: number, state: unknown): Step[] =>
  Array.from({ length: count }, () => ({ state, error: null }));

// Fake clock: each sleep advances it by the poll interval, so no time passes in the test.
function wait(
  kind: "restore" | "enable",
  sequence: Step[],
  last: Scheme | null = "High Contrast Black",
) {
  return contract(
    `$script:t = 0; $script:i = 0; $script:n = 0
$seq = @($in.sequence)
$done = $null; $err = $null
try {
  $null = Wait-HighContrast -Read { $s = $seq[[Math]::Min($script:i, $seq.Count - 1)]; $script:i++; if ($s.PSObject.Properties['delayMs']) { $script:t += $s.delayMs }; if ($null -ne $s.error) { throw $s.error }; $s.state } \`
    -Problems { param($s) if ($in.kind -eq 'enable') { Get-EnableProblem $in.baseline $s 'High Contrast Black' } else { Get-RestoreProblem $in.baseline $s $in.last } } \`
    -Elapsed { $script:t } -Sleep { param($ms) $script:t += $ms } -Record { param($x) $script:n++ }
  $done = $script:t
} catch { $err = $_.Exception.Message }
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ done = $done; error = $err; reads = $script:i; samples = $script:n })`,
    { kind, sequence, baseline: base(), last },
  ) as {
    done: number | null;
    error: string | null;
    reads: number;
    samples: number;
  };
}

describe(
  "stability wait (contract script, fake clock)",
  { timeout: powerShellTestMs },
  () => {
    it("passes a delayed convergence only after 1,000 ms of unchanged qualifying reads", () => {
      const restored = wait("restore", [
        ...steps(6, enabled("High Contrast Black")),
        ...steps(1, residue("High Contrast Black")),
      ]);
      expect(restored).toEqual({
        done: 2500,
        error: null,
        reads: 11,
        samples: 11,
      });
      const on = wait("enable", [
        ...steps(3, base()),
        ...steps(1, enabled("High Contrast Black")),
      ]);
      expect(on.done).toBe(1750);
    });

    it("fails a change that reverts to the original palette", () => {
      const result = wait("enable", [
        ...steps(1, base()),
        ...steps(3, enabled("High Contrast Black")),
        ...steps(1, {
          ...enabled("High Contrast Black"),
          colours: base().colours,
        }),
      ]);
      expect(result.done).toBeNull();
      expect(result.error).toMatch(
        /not stable for 1000 ms within 30000 ms; last problems: palette unchanged/u,
      );
    });

    it("fails when nothing changes, and never accepts the original palette", () => {
      const result = wait("enable", steps(1, base()));
      expect(result.error).toMatch(/within 30000 ms/u);
      expect(result.reads).toBe(121);
    });

    it("restarts the window on every change, so a flapping palette times out", () => {
      const flap: Step[] = [];
      for (let i = 0; i < 70; i += 1)
        flap.push(
          ...steps(2, {
            ...enabled("High Contrast Black"),
            colours: i % 2 === 0 ? contrastPalette : otherPalette,
          }),
        );
      expect(wait("enable", flap).error).toMatch(/within 30000 ms/u);
      const restoring: Step[] = [];
      for (let i = 0; i < 70; i += 1)
        restoring.push(
          ...steps(1, enabled("High Contrast Black")),
          ...steps(3, base()),
        );
      expect(wait("restore", restoring).error).toMatch(
        /within 30000 ms; last problems: flags 127/u,
      );
    });

    it("fails a stable result whose read returns after the deadline", () => {
      const result = wait("restore", [
        ...steps(4, residue("High Contrast Black")),
        { state: residue("High Contrast Black"), error: null, delayMs: 29_001 },
      ]);
      expect(result.done).toBeNull();
      expect(result.error).toMatch(
        /^result at 30001 ms is past the 30000 ms deadline/u,
      );
      expect(result.reads).toBe(5);
    });

    it("fails at once on a read error, without a retry", () => {
      const result = wait("restore", [
        ...steps(1, enabled("High Contrast Black")),
        { state: null, error: "SPI_GETHIGHCONTRAST failed" },
        ...steps(1, base()),
      ]);
      expect(result.error).toBe(
        "read failed at 250 ms, not retried: SPI_GETHIGHCONTRAST failed",
      );
      expect(result.reads).toBe(2);
      expect(result.samples).toBe(2);
    });

    it("does not accept a restore whose flags are back but whose palette is still the contrast one", () => {
      const result = wait(
        "restore",
        steps(1, {
          ...residue("High Contrast Black"),
          colours: contrastPalette,
        }),
      );
      expect(result.error).toMatch(/last problems: colour window/u);
    });

    it("keeps font smoothing and the colour slots in the stability fingerprint", () => {
      const on = enabled("High Contrast Black");
      const flapping = (edit: (i: number) => object) => {
        const sequence: Step[] = [];
        for (let i = 0; i < 70; i += 1)
          sequence.push(...steps(2, { ...on, ...edit(i) }));
        return sequence;
      };
      expect(
        wait(
          "enable",
          flapping((i) => ({
            fontSmoothing: { ...on.fontSmoothing, type: 1 + (i % 2) },
          })),
        ).error,
      ).toMatch(/not stable for 1000 ms within 30000 ms/u);
      expect(
        wait(
          "enable",
          flapping((i) => ({ sysColors: on.sysColors.map(() => i % 2) })),
        ).error,
      ).toMatch(/not stable for 1000 ms within 30000 ms/u);
      // Control: the same on-state values held still are accepted.
      expect(
        wait(
          "enable",
          steps(1, { ...on, sysColors: on.sysColors.map(() => 1) }),
        ).done,
      ).toBe(1000);
    });

    it("fails a restore whose colour slot or smoothing value never returns, and a failed SPI read", () => {
      expect(wait("restore", steps(1, withSysColor(13, 0))).error).toMatch(
        /within 30000 ms; last problems: sysColor 13 0, not /u,
      );
      expect(
        wait(
          "restore",
          steps(
            1,
            withSmoothing((s) => (s["contrast"] = 1000)),
          ),
        ).error,
      ).toMatch(/last problems: fontSmoothing contrast 1000, not 1200/u);
      const failed = wait("restore", [
        { state: null, error: "SPI action 0x200C failed, Win32 error 5" },
      ]);
      expect(failed.error).toBe(
        "read failed at 0 ms, not retried: SPI action 0x200C failed, Win32 error 5",
      );
      expect(failed.reads).toBe(1);
    });
  },
);

describe("run-global baseline and last enabled scheme", () => {
  it("captures once; a later capture into the same run fails and leaves the file as it was", () => {
    const dir = temp();
    const run = writeBaseline(dir, base());
    const before = readFileSync(join(dir, "baseline.json"), "utf8");
    expect(() =>
      writeBaseline(dir, { ...base(), scheme: "High Contrast Black" }),
    ).toThrow(/EEXIST/u);
    expect(readFileSync(join(dir, "baseline.json"), "utf8")).toBe(before);
    expect(loadBaseline(encodeRun(run)).state).toEqual(base());
  });

  it("refuses a baseline that is on, unavailable or malformed", () => {
    expect(baselineProblems({ ...base(), on: true })).toEqual([
      "high contrast is on before the run",
    ]);
    expect(baselineProblems({ ...base(), available: false })).toEqual([
      "high contrast is not available",
    ]);
    expect(baselineProblems({})).toContain("malformed baseline: flags missing");
    expect(() => writeBaseline(temp(), { ...base(), on: true })).toThrow(
      /on before the run/u,
    );
  });

  it("refuses a baseline changed after capture, or one never captured", () => {
    const dir = temp();
    const run = writeBaseline(dir, base());
    chmodSync(join(dir, "baseline.json"), 0o666);
    writeFileSync(
      join(dir, "baseline.json"),
      `${JSON.stringify({ ...base(), flags: 127 }, null, 2)}\n`,
    );
    expect(() => loadBaseline(encodeRun(run))).toThrow(
      /changed after it was captured/u,
    );
    expect(() => loadBaseline(undefined)).toThrow(
      /did not capture a baseline/u,
    );
  });

  it("carries the last enabled scheme across projects without touching the baseline", () => {
    const dir = temp();
    const run = writeBaseline(dir, base());
    expect(readLastEnabled(dir)).toBeNull();
    // The first project turned on White last; the next project starts from what it left.
    recordLastEnabled(dir, "High Contrast Black");
    recordLastEnabled(dir, "High Contrast White");
    const next = readLastEnabled(dir);
    expect(next).toBe("High Contrast White");
    const { state } = loadBaseline(encodeRun(run));
    expect(
      restoredProblems(state, residue("High Contrast White"), next),
    ).toEqual([]);
    expect(
      restoredProblems(state, residue("High Contrast White"), null),
    ).toHaveLength(2);
    expect(
      restoredProblems(state, residue("High Contrast Black"), next),
    ).toHaveLength(2);
    expect(
      restoredProblems(
        state,
        { ...residue("High Contrast White"), colours: contrastPalette },
        next,
      ),
    ).toHaveLength(colourKeys.length);
    writeFileSync(join(dir, "last-enabled.json"), '{"scheme":"Other"}');
    expect(() => readLastEnabled(dir)).toThrow(/unknown/u);
  });
});

describe("restore after every scheme and evidence on failure", () => {
  const order: string[] = [];
  const steps2 = (change: () => void, restoreStep: () => void) => {
    order.length = 0;
    const noted: string[][] = [];
    const done = withRestore({
      change: () => {
        order.push("change");
        change();
        return Promise.resolve();
      },
      restore: () => {
        order.push("restore");
        restoreStep();
        return Promise.resolve();
      },
      note: (errors) => noted.push(errors),
    });
    return { done, noted };
  };

  it("restores after an enable or body failure and keeps both errors", async () => {
    const both = steps2(
      () => {
        throw new Error("enable: palette unchanged");
      },
      () => {
        throw new Error("restored state: colour window");
      },
    );
    await expect(both.done).rejects.toThrow(
      "enable: palette unchanged | then: restored state: colour window",
    );
    expect(order).toEqual(["change", "restore"]);
    expect(both.noted).toEqual([
      ["enable: palette unchanged", "restored state: colour window"],
    ]);
    const body = steps2(
      () => {
        throw new Error("browser closed");
      },
      () => undefined,
    );
    await expect(body.done).rejects.toThrow("browser closed");
    expect(order).toEqual(["change", "restore"]);
  });

  it("keeps both errors when recording them fails", async () => {
    const body = new Error("browser closed");
    const restore = new Error("restored state: colour window");
    const write = new Error("EISDIR: illegal operation on a directory");
    const done = withRestore({
      change: () => Promise.reject(body),
      restore: () => Promise.reject(restore),
      note: () => {
        throw write;
      },
    });
    const thrown: unknown = await done.catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as Error;
    expect(error.message).toBe(
      "browser closed | then: restored state: colour window | then: recording the errors: EISDIR: illegal operation on a directory",
    );
    expect((error.cause as AggregateError).errors).toEqual([
      body,
      restore,
      write,
    ]);
  });

  it("fails on a restore error alone and passes only when both steps pass", async () => {
    const bad = steps2(
      () => undefined,
      () => {
        throw new Error("forced colours are still active");
      },
    );
    await expect(bad.done).rejects.toThrow("forced colours are still active");
    const good = steps2(
      () => undefined,
      () => undefined,
    );
    await expect(good.done).resolves.toBeUndefined();
    expect(good.noted).toEqual([]);
    expect(order).toEqual(["change", "restore"]);
  });

  it("keeps every update on disk when a later step throws", () => {
    const file = join(temp(), "high-contrast.json");
    const record = {
      cells: notRunCells() as { key: string; verdict: string }[],
      errors: [] as string[],
    };
    const save = recorder(file, record);
    expect(() => {
      record.cells[0] = { key: "1920/absent", verdict: "pass" };
      save();
      record.errors.push("restored state: colour window");
      save();
      throw new Error("assertion");
    }).toThrow("assertion");
    const kept = JSON.parse(readFileSync(file, "utf8")) as typeof record;
    expect(kept.cells[0]?.verdict).toBe("pass");
    expect(kept.cells[1]?.verdict).toBe("not-run");
    expect(kept.errors).toEqual(["restored state: colour window"]);
  });

  it("never reports a partial matrix as passed", () => {
    const rows = notRunCells();
    expect(rows).toHaveLength(12);
    expect(tally(rows)).toMatchObject({ complete: false, passed: false });
    const ran = rows.map((r) => ({ ...r, verdict: "pass" as const }));
    expect(tally(ran)).toMatchObject({ complete: true, passed: true });
    expect(tally(ran, ["restore failed"]).passed).toBe(false);
    expect(
      tally([
        ...ran.slice(1),
        { ...rows[0], key: "x", verdict: "not-run" as const },
      ]).passed,
    ).toBe(false);
    expect(tally([]).passed).toBe(false);
  });
});

describe("SPI script structure (read, never run)", () => {
  it("carries the same hosted-runner table as the guard", () => {
    const table: string =
      /\$hostedRunner = \[ordered\]@\{\r?\n([\s\S]*?)\r?\n\}/u.exec(
        script,
      )?.[1] ?? "";
    const pairs: Record<string, string> = {};
    for (const m of table.matchAll(/^\s*(\w+) = '([^']*)'$/gmu))
      pairs[m[1] ?? ""] = m[2] ?? "";
    expect(pairs).toEqual(hostedRunner);
  });

  it("refuses before loading any native code or the contract", () => {
    const guard = script.indexOf("exit 2");
    expect(guard).toBeGreaterThan(
      script.indexOf("$problems = Get-HostedProblem"),
    );
    expect(guard).toBeLessThan(script.indexOf("Add-Type"));
    expect(guard).toBeLessThan(script.indexOf("DllImport"));
    expect(guard).toBeLessThan(script.indexOf("high-contrast-contract.ps1"));
  });

  it("asserts every SPI return value", () => {
    const calls = [
      ...script.matchAll(
        /^(.*)\[SharpLadderHighContrast\]::SystemParametersInfo\(/gmu,
      ),
    ];
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[1]?.trim()).toBe("$ok =");
      const rest = script.slice(call.index + call[0].length);
      expect(rest.split("\n")[1]?.trim()).toBe("if (-not $ok) {");
    }
  });

  it("reads font smoothing only through the four SPI_GET actions in WinUser.h, asserting each call", () => {
    const table: string =
      /\$fontSmoothingAction = \[ordered\]@\{\r?\n\s*(.*)\r?\n\}/u.exec(
        script,
      )?.[1] ?? "";
    expect(table).toBe(
      "smoothing = 0x004A; type = 0x200A; contrast = 0x200C; orientation = 0x2012",
    );
    expect([...table.matchAll(/(\w+) = /gu)].map((m) => m[1])).toEqual([
      ...fontSmoothingKeys,
    ]);
    expect(script).toContain(
      '[DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true)]',
    );
    const reads = [...script.matchAll(/^(.*)SystemParametersInfoValue\(/gmu)];
    expect(reads).toHaveLength(2);
    expect(reads[0]?.[1]?.trim()).toBe("public static extern bool");
    const call = reads[1];
    expect(call?.[1]?.trim()).toBe("$ok = [SharpLadderHighContrast]::");
    const rest = script.slice((call?.index ?? 0) + (call?.[0].length ?? 0));
    // Read with no parameter and no profile write: uiParam 0, fWinIni 0.
    expect(rest.split("\n")[0]).toBe("$Action, 0, [ref]$value, 0)");
    expect(rest.split("\n")[1]?.trim()).toBe("if (-not $ok) {");
    expect(script.match(/Read-SpiValue \$/gu)).toEqual(["Read-SpiValue $"]);
    expect(script).toContain(
      "foreach ($key in $fontSmoothingAction.Keys) { $smoothing[$key] = Read-SpiValue $fontSmoothingAction[$key] }",
    );
    expect(script).toContain(
      "for ($i = 0; $i -lt $script:sysColorCount; $i++) { $sysColors.Add([long][SharpLadderHighContrast]::GetSysColor($i)) }",
    );
    expect(script).toContain("fontSmoothing = $smoothing");
    expect(script).toContain("sysColors = $sysColors.ToArray()");
  });

  it("changes the OS only through SPI and keeps the contract script free of the OS", () => {
    for (const text of [script, contractText])
      expect(text).not.toMatch(
        /Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|Set-Item\b|SetSysColors|reg(\.exe)? (add|delete)|SystemParametersInfoW?\(\s*0x0014/iu,
      );
    expect(contractText).not.toMatch(
      /Add-Type|DllImport|HKCU|HKLM|Start-Sleep|Stopwatch/u,
    );
  });

  it("checks the baseline before the change, keeps unrelated flags and waits after each change", () => {
    const enableBranch = script.slice(
      script.indexOf("'enable' {"),
      script.indexOf("'restore' {"),
    );
    const restoreBranch = script.slice(
      script.indexOf("'restore' {"),
      script.indexOf("$log.outcome = 'accepted'"),
    );
    expect(
      enableBranch.indexOf("Get-RestoreProblem $base $live $LastEnabled"),
    ).toBeLessThan(enableBranch.indexOf("Write-HighContrast ("));
    const refuse = enableBranch.indexOf(
      'if ($drift.Count -gt 0) { throw "the live state differs from the baseline before the change',
    );
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(enableBranch.indexOf("Write-HighContrast ("));
    expect(enableBranch).toContain(
      "Write-HighContrast ([int]$base.flags -bor $hcfOn) $Scheme",
    );
    expect(enableBranch).toContain(
      "$result = Wait-Transition { param($state) Get-EnableProblem $base $state $Scheme }",
    );
    expect(restoreBranch).toContain(
      "Write-HighContrast ([int]$base.flags) ([string]$base.scheme)",
    );
    expect(restoreBranch).toContain(
      "$result = Wait-Transition { param($state) Get-RestoreProblem $base $state $LastEnabled }",
    );
    expect(script.match(/\$result = Read-HighContrast/gu)).toHaveLength(1);
    expect(script).toContain("$clock = [Diagnostics.Stopwatch]::StartNew()");
    expect(script).toContain("-Elapsed { $clock.ElapsedMilliseconds }");
  });

  it("polls every 250 ms, needs 1,000 ms of stability and gives up at 30,000 ms", () => {
    expect(contractText).toContain("[int]$PollMs = 250,");
    expect(contractText).toContain("[int]$StableMs = 1000,");
    expect(contractText).toContain("[int]$DeadlineMs = 30000");
    expect(script).not.toMatch(/-(PollMs|StableMs|DeadlineMs)\b/u);
  });

  it("writes the polling evidence after every sample and whatever the exit status", () => {
    expect(script).toContain(
      "$log.samples.Add($sample); $log.last = $sample; Save-Evidence",
    );
    expect(script).toMatch(/\} finally \{\s*Save-Evidence\s*\}\s*exit \$exit/u);
  });
});

describe("high-contrast spec, setup and config", () => {
  it("restores in each scheme's finally and checks the baseline before any change", () => {
    expect(specText).toContain("await withRestore({");
    expect(specText.match(/transition\("enable"/gu)).toHaveLength(1);
    expect(specText.match(/transition\("restore"/gu)).toHaveLength(1);
    expect(specText.match(/spi\("(enable|restore)"/gu)).toBeNull();
    const loop = specText.indexOf("for (const scheme of schemes)");
    const drift = specText.indexOf(
      "restoredProblems(baseline.state, live, previous)",
    );
    const last = specText.indexOf(
      "recordLastEnabled(baseline.run.dir, scheme)",
    );
    const change = specText.indexOf('transition("enable"');
    const cellLoop = specText.indexOf("for (const cell of groupDCells())");
    expect(loop).toBeGreaterThan(-1);
    expect(drift).toBeGreaterThan(loop);
    expect(last).toBeGreaterThan(drift);
    expect(change).toBeGreaterThan(last);
    expect(cellLoop).toBeGreaterThan(change);
    expect(specText.indexOf("restore: async () =>")).toBeGreaterThan(cellLoop);
    expect(
      specText.indexOf("hostedProblems(process.env, process.platform)"),
    ).toBeLessThan(specText.indexOf('spi("read")'));
    // Built from parts so this file carries no unfinished-work marker itself.
    for (const modifier of ["skip", ["fix", "me"].join("")])
      expect(specText).not.toContain(`test.${modifier}`);
  });

  it("reads the baseline the setup wrote and never writes one", () => {
    expect(specText).toContain("loadBaseline(process.env[runVariable])");
    expect(specText).not.toMatch(/writeBaseline|writeOnce/u);
    expect(setupText).toContain("writeBaseline(dir, state)");
    expect(
      setupText.indexOf("hostedProblems(process.env, process.platform)"),
    ).toBeLessThan(setupText.indexOf('spi("read")'));
  });

  it("reads forced colours before the run and after each restore in a fresh full Chromium, and compares no picture", () => {
    expect(setupText).toContain("fullChromium(");
    expect(setupText).toContain("if (await forced(page))");
    expect(specText).toContain("check.forced = await forced(page);");
    expect(specText).toContain("ms: postRestoreDeadlineMs,");
    expect(specText).toContain("}, stop.signal),");
    for (const text of [setupText, specText])
      expect(text).not.toMatch(/capture\(|differing|pixelDiff|baseline\.png/u);
  });

  it("is selected only in the opted-in run, alone, on one worker, without retries", () => {
    expect(config).toContain(
      'process.env["SHARPLADDER_REAL_HIGH_CONTRAST"] === "1"',
    );
    expect(config).toContain("testIgnore: highContrastSpec,");
    expect(config).toContain("...(realHighContrast ? { workers: 1 } : {}),");
    expect(config).toContain("retries: 0,");
    expect(config).toMatch(
      /\.\.\.\(realHighContrast\s*\?\s*\{ globalSetup: "\.\/browser\/high-contrast\.setup\.ts" \}\s*:\s*\{\}\)/u,
    );
    expect(config).toContain(
      '(["chromium", "firefox", "webkit"] as const).map',
    );
    expect(config.match(/timeout: 240_000,/gu)).toHaveLength(1);
    expect(config.indexOf("timeout: 240_000,")).toBeGreaterThan(
      config.indexOf("testMatch: highContrastSpec,"),
    );
    expect(config).toContain("  timeout: 60_000,");
  });

  it("never emulates media and opens every page the same explicit way", () => {
    for (const text of [specText, setupText, captureText])
      expect(text).not.toMatch(/emulateMedia|forcedColors: "active"/u);
    for (const key of [
      "forcedColors",
      "colorScheme",
      "reducedMotion",
      "contrast",
    ])
      expect(captureText).toContain(`  ${key}: null,`);
    expect(captureText).toContain("...unEmulated,");
    expect(captureText).toContain("deviceScaleFactor: 1,");
    expect(captureText).toMatch(
      /chromium\.launch\(\{\s*channel: "chromium",\s*headless: true,\s*\}\)/u,
    );
    expect(captureText).toMatch(
      /\} finally \{\s*signal\?\.removeEventListener\("abort", close\);\s*await browser\.close\(\);/u,
    );
    expect(specText).toContain("headless: true,");
  });
});

describe("Group D matrix under real high contrast", () => {
  it("enumerates every theme at both widths, widths outermost", () => {
    expect(groupDCells().map((c) => c.key)).toEqual([
      "1920/absent",
      "1920/light",
      "1920/dark",
      "390/absent",
      "390/light",
      "390/dark",
    ]);
    expect(groupDCells().map((c) => c.theme)).toEqual([...themes, ...themes]);
    expect(schemes.length * groupDCells().length).toBe(12);
    expect(viewportAt(390)).toEqual({ width: 390, height: 844 });
    expect(viewportAt(1920)).toEqual({ width: 1920, height: 1080 });
  });

  it("records the engine capabilities the brief names", () => {
    expect(capability).toEqual({
      chromium: { detects: true, followsOs: true },
      firefox: { detects: true, followsOs: false },
      webkit: { detects: false, followsOs: false },
    });
    expect(engineNamed("webkit")).toBe("webkit");
    expect(() => engineNamed("edge")).toThrow(/unrecorded engine edge/u);
    expect(() => engineNamed(undefined)).toThrow(/unrecorded engine/u);
  });

  it("passes only a detected cell with no failure", () => {
    expect(verdictOf("chromium", true, [])).toBe("pass");
    expect(verdictOf("firefox", true, [])).toBe("pass");
    expect(verdictOf("chromium", true, ["rungRing=0 < 0.5"])).toBe("fail");
    expect(verdictOf("chromium", false, [])).toBe("fail");
    expect(verdictOf("webkit", true, [])).toBe("fail");
    expect(verdictOf("webkit", false, [])).toBe("unsupported");
  });

  it("reports every WebKit cell as unsupported, never as a pass", () => {
    const rows = schemes.flatMap((s) => unsupportedCells("webkit", s));
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => `${r.scheme} ${r.key}`)).size).toBe(12);
    expect(rows.every((r) => r.verdict === "unsupported")).toBe(true);
    expect(rows[0]?.reason).toBe("webkit does not detect real high contrast");
    expect(tally(rows)).toEqual({
      count: { pass: 0, fail: 0, unsupported: 12, "not-run": 0 },
      failed: [],
      complete: true,
      passed: true,
    });
    // A detecting engine has no unsupported cells to report.
    expect(
      unsupportedCells("chromium", "High Contrast Black").map((r) => r.verdict),
    ).toEqual(Array(6).fill("fail"));
  });

  it("counts verdicts and names the failed cells", () => {
    expect(
      tally([
        { key: "a", verdict: "pass" },
        { key: "b", verdict: "fail" },
        { key: "c", verdict: "unsupported" },
      ]),
    ).toEqual({
      count: { pass: 1, fail: 1, unsupported: 1, "not-run": 0 },
      failed: ["b"],
      complete: true,
      passed: false,
    });
  });

  it("checks the shape of every state the same way", () => {
    expect(shapeProblems(base(), "x")).toEqual([]);
    expect(shapeProblems([], "x")).toEqual(["malformed x: not an object"]);
  });
});

describe("post-restore deadline", () => {
  const fakeClock = () => {
    let time = 1_000;
    const timers: { at: number; fire: () => void }[] = [];
    const clock: Clock = {
      now: () => time,
      after: (ms, fire) => {
        const timer = { at: time + ms, fire };
        timers.push(timer);
        return () => {
          timers.splice(timers.indexOf(timer), 1);
        };
      },
    };
    const advance = (ms: number) => {
      time += ms;
      for (const timer of timers.filter((t) => t.at <= time)) timer.fire();
    };
    return { clock, advance, timers };
  };

  it("fails closed and stops the work when the deadline passes", async () => {
    const { clock, advance } = fakeClock();
    let stopped = 0;
    const pending = beforeDeadline(() => new Promise<never>(() => undefined), {
      start: clock.now(),
      ms: postRestoreDeadlineMs,
      clock,
      stop: () => {
        stopped += 1;
      },
    });
    advance(postRestoreDeadlineMs - 1);
    expect(stopped).toBe(0);
    advance(1);
    await expect(pending).rejects.toThrow(
      "timed out: 30000 ms after the restore was accepted",
    );
    expect(stopped).toBe(1);
  });

  it("counts from restore acceptance and never starts work past the deadline", async () => {
    const { clock, advance } = fakeClock();
    const start = clock.now();
    advance(postRestoreDeadlineMs);
    let started = false;
    let stopped = false;
    await expect(
      beforeDeadline(
        () => {
          started = true;
          return Promise.resolve(1);
        },
        {
          start,
          ms: postRestoreDeadlineMs,
          clock,
          stop: () => {
            stopped = true;
          },
        },
      ),
    ).rejects.toThrow("timed out");
    expect(started).toBe(false);
    expect(stopped).toBe(true);
  });

  it("fails a result that settles past the deadline when the timer never fired", async () => {
    let time = 0;
    let stopped = 0;
    const clock: Clock = { now: () => time, after: () => () => undefined };
    const deadline = {
      start: 0,
      ms: 30,
      clock,
      stop: () => {
        stopped += 1;
      },
    };
    const late = (settle: () => Promise<number>) => () => {
      time = 100;
      return settle();
    };
    await expect(
      beforeDeadline(
        late(() => Promise.resolve(7)),
        deadline,
      ),
    ).rejects.toThrow("timed out: 30 ms after the restore was accepted");
    time = 0;
    await expect(
      beforeDeadline(
        late(() => Promise.reject(new Error("no page"))),
        deadline,
      ),
    ).rejects.toThrow("timed out");
    expect(stopped).toBe(2);
  });

  it("returns the result in time and cancels the timer", async () => {
    const { clock, timers } = fakeClock();
    const deadline = { start: clock.now(), ms: 50, clock, stop: never };
    await expect(
      beforeDeadline(() => Promise.resolve(7), deadline),
    ).resolves.toBe(7);
    await expect(
      beforeDeadline(() => Promise.reject(new Error("no page")), deadline),
    ).rejects.toThrow("no page");
    expect(timers).toHaveLength(0);
  });
});
