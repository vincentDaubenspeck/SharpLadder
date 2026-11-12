// @vitest-environment node
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// The full hints record and its view are apart by type in both directions, beside the run-time
// schema and checks: each case is compiled with the app program's own options and must fail there.
const web = join(import.meta.dirname, "..");
const parsed = ts.getParsedCommandLineOfConfigFile(
  join(web, "tsconfig.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
);

const head = `import type { HintsCatalogue, HintsPart } from "../generated/content.ts";
import { checkedHintsView, selectHints } from "../content/hints.ts";
import type { HintChange, HintsView } from "../content/hints.ts";
import { HintsPartView } from "../content/Hints.tsx";
import { ContentView } from "../content/ContentView.tsx";
import { buildSlugMap } from "../content/href.ts";
declare const full: HintsPart;
declare const catalogue: HintsCatalogue;
declare const view: HintsView;
declare const change: HintChange;
const slugs = buildSlugMap([]);
export const used = [full, catalogue, view, change, slugs, checkedHintsView, selectHints, HintsPartView, ContentView] as const;
`;

// Each refused use, and the two type names its error must name.
const refused = [
  [
    "the selector refuses the full record",
    'selectHints(full, ["ladder-a"], null)',
    ["HintsPart", "HintsCatalogue"],
  ],
  [
    "the view check refuses the full record",
    "checkedHintsView(full)",
    ["HintsPart", "HintsView"],
  ],
  [
    "the view check refuses a catalogue",
    "checkedHintsView(catalogue)",
    ["HintsCatalogue", "HintsView"],
  ],
  [
    "the hints view refuses the full record",
    "<HintsPartView view={full} onHintChange={change} />",
    ["HintsPart", "HintsView"],
  ],
  [
    "the hints view refuses a catalogue",
    "<HintsPartView view={catalogue} onHintChange={change} />",
    ["HintsCatalogue", "HintsView"],
  ],
  [
    "the static view refuses the full record",
    "<ContentView doc={full} slugs={slugs} />",
    ["HintsPart", "StaticDoc"],
  ],
  [
    "the static view refuses a catalogue",
    "<ContentView doc={catalogue} slugs={slugs} />",
    ["HintsCatalogue", "StaticDoc"],
  ],
  [
    "the static view refuses a view",
    "<ContentView doc={view} slugs={slugs} />",
    ["HintsView", "StaticDoc"],
  ],
];
// Assignments between the types, written as typed declarations.
const crossed = [
  ["a view is no full record", "HintsPart", "view", ["HintsView", "HintsPart"]],
  ["a full record is no view", "HintsView", "full", ["HintsPart", "HintsView"]],
  [
    "a view is no catalogue",
    "HintsCatalogue",
    "view",
    ["HintsView", "HintsCatalogue"],
  ],
  [
    "a catalogue is no view",
    "HintsView",
    "catalogue",
    ["HintsCatalogue", "HintsView"],
  ],
];
const admitted =
  '<HintsPartView view={checkedHintsView(selectHints(catalogue, ["ladder-a"], null))} onHintChange={change} />';

const cases = [
  ...refused.map(([name, use, names]) => ({
    name,
    text: `export const probe = ${use};\n`,
    names,
  })),
  ...crossed.map(([name, type, value, names]) => ({
    name,
    text: `export const probe: ${type} = ${value};\n`,
    names,
  })),
  {
    name: "the selected view of a catalogue is admitted",
    text: `export const probe = ${admitted};\n`,
    names: null,
  },
];

// One program holds every case as its own in-memory module beside the app sources.
const files = new Map(
  cases.map((c, i) => [
    join(web, "src", "content-tests", `hints-type-${String(i)}.tsx`),
    head + c.text,
  ]),
);
const key = (name) =>
  ts.sys.resolvePath(name).replaceAll("\\", "/").toLowerCase();
const byKey = new Map([...files].map(([name, text]) => [key(name), text]));
const host = ts.createCompilerHost(parsed.options);
const read = host.getSourceFile;
host.getSourceFile = (name, language, ...rest) =>
  byKey.has(key(name))
    ? ts.createSourceFile(name, byKey.get(key(name)), language, true)
    : read(name, language, ...rest);
const exists = host.fileExists;
host.fileExists = (name) => byKey.has(key(name)) || exists(name);
const program = ts.createProgram(
  [...parsed.fileNames, ...files.keys()],
  parsed.options,
  host,
);

const errorsOf = (name) =>
  ts
    .getPreEmitDiagnostics(program, program.getSourceFile(name))
    .filter((d) => d.file !== undefined && key(d.file.fileName) === key(name))
    .map((d) => ({
      line: d.file.getLineAndCharacterOfPosition(d.start ?? 0).line,
      text: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    }));

// Checked once, before any case runs, so no case pays for building the checker.
const found = [...files.keys()].map(errorsOf);

describe("the hints types", () => {
  const lastLine = head.split("\n").length - 1;

  it.each(cases.map((c, i) => [c.name, c, found[i]]))("%s", (_, c, errors) => {
    if (c.names === null) {
      expect(errors).toEqual([]);
      return;
    }
    // The case's own line fails, for the types it names, and the shared head stays clean.
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) expect(error.line).toBe(lastLine);
    expect(
      errors.some((e) => c.names.every((n) => e.text.includes(`'${n}'`))),
    ).toBe(true);
  });
});
