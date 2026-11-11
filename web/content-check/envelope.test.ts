// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { acceptEnvelope } from "./envelope.ts";
import setup from "./global-setup.ts";
import { recordInventory } from "./inventory.ts";
import { runTestRecords } from "./records.ts";

// Safe: the Vitest global setup builds the compiler before any test file of the same run starts.
const prebuilt = { builtByGlobalSetup: true } as const;

// A child process writes the given bytes to its stdout, which the parent receives through a
// pipe, so every case crosses the same redirected transport as the compiler's output.
function redirected(bytes: Uint8Array, exit = 0) {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      "process.stdout.write(Buffer.from(process.env.PAYLOAD, 'base64'), () => { process.exitCode = Number(process.env.EXIT); });",
    ],
    {
      env: {
        ...process.env,
        PAYLOAD: Buffer.from(bytes).toString("base64"),
        EXIT: String(exit),
      },
    },
  );
  if (r.error) throw r.error;
  return { stdout: new Uint8Array(r.stdout), exit: r.status };
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const join = (...parts: Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((p) => [...p]));

const record = (path: string, text = "{}", kind: unknown = "chapter") => ({
  path,
  kind,
  text,
});
const envelope = (records: unknown[], extra: object = {}) =>
  JSON.stringify({ version: 2, records, ...extra });
const valid = envelope([
  record("compiled/chapters/a/chapter.json"),
  record("compiled/chapters/a/syntax.json"),
]);

const validPaths = [
  "compiled/chapters/a/chapter.json",
  "compiled/chapters/a/syntax.json",
];

const refuses = (
  bytes: Uint8Array,
  exit: number,
  reason: RegExp,
  expected = validPaths,
) => {
  const run = redirected(bytes, exit);
  expect(run.exit).toBe(exit);
  expect(() => acceptEnvelope(run.stdout, run.exit, expected)).toThrow(reason);
};

describe("the test-records transport", () => {
  it("accepts non-ASCII payload text through redirected stdout", () => {
    const text = '{"t":"café 中 \u{1f600}     ${ */"}';
    const run = redirected(
      utf8(envelope([record("compiled/chapters/a/chapter.json", text)])),
    );
    expect(
      acceptEnvelope(run.stdout, run.exit, [
        "compiled/chapters/a/chapter.json",
      ]),
    ).toEqual([
      { path: "compiled/chapters/a/chapter.json", kind: "chapter", text },
    ]);
  });

  it("accepts escaped non-ASCII text as the same decoded value", () => {
    const run = redirected(
      utf8(
        '{"version":2,"records":[{"path":"compiled/a.json","kind":"part","text":"caf\\u00E9"}]}',
      ),
    );
    expect(
      acceptEnvelope(run.stdout, run.exit, ["compiled/a.json"])[0]?.text,
    ).toBe("café");
  });

  it.each([
    [
      "malformed UTF-8",
      join(utf8(valid.slice(0, -2)), Uint8Array.of(0xc3, 0x28), utf8("}]")),
      /not valid UTF-8/u,
    ],
    [
      "a byte-order mark",
      join(Uint8Array.of(0xef, 0xbb, 0xbf), utf8(valid)),
      /byte-order mark/u,
    ],
    [
      "truncated JSON",
      utf8(valid.slice(0, -1)),
      /not exactly one JSON object/u,
    ],
    [
      "truncated inside a record",
      utf8(`${valid.slice(0, 40)}}`),
      /not one complete JSON document/u,
    ],
    [
      "text after the envelope",
      utf8(`${valid}\nPASS content test-records`),
      /not exactly one JSON object/u,
    ],
    [
      "a second envelope",
      utf8(`${valid}${valid}`),
      /not one complete JSON document/u,
    ],
    [
      "a trailing line feed",
      utf8(`${valid}\n`),
      /not exactly one JSON object/u,
    ],
    [
      "a diagnostic line before the envelope",
      utf8(`warning: x\n${valid}`),
      /not exactly one JSON object/u,
    ],
    ["empty output", new Uint8Array(), /not exactly one JSON object/u],
    [
      "a repeated record path",
      utf8(envelope([record("compiled/a.json"), record("compiled/a.json")])),
      /compiled\/a\.json is repeated/u,
    ],
    [
      "records out of ordinal order",
      utf8(envelope([record("compiled/b.json"), record("compiled/a.json")])),
      /out of ordinal order/u,
    ],
    [
      "the manifest as a record",
      utf8(envelope([record("compiled/manifest.json")])),
      /manifest is not a record/u,
    ],
    [
      "a path outside compiled",
      utf8(envelope([record("src/generated/body.ts")])),
      /not a compiled payload path/u,
    ],
    [
      "a back-slashed path",
      utf8(envelope([record("compiled\\a.json")])),
      /not a compiled payload path/u,
    ],
    [
      "a dot segment",
      utf8(envelope([record("compiled/../a.json")])),
      /not a compiled payload path/u,
    ],
    ["no records", utf8(envelope([])), /non-empty array/u],
    [
      "version 1",
      utf8(
        JSON.stringify({ version: 1, records: [record("compiled/a.json")] }),
      ),
      /version must be 2/u,
    ],
    [
      "an extra envelope key",
      utf8(envelope([record("compiled/a.json")], { note: 1 })),
      /exactly version and records/u,
    ],
    [
      "an extra record key",
      utf8(envelope([{ ...record("compiled/a.json"), sha256: "x" }])),
      /exactly path, kind and text/u,
    ],
    [
      "a record without a kind",
      utf8(envelope([{ path: "compiled/a.json", text: "{}" }])),
      /exactly path, kind and text/u,
    ],
    [
      "a record with its kind last",
      utf8(envelope([{ path: "compiled/a.json", text: "{}", kind: "part" }])),
      /exactly path, kind and text/u,
    ],
    [
      "an unknown kind",
      utf8(envelope([record("compiled/a.json", "{}", "registry")])),
      /record kind "registry" is not a known kind/u,
    ],
    [
      "a kind in capitals",
      utf8(envelope([record("compiled/a.json", "{}", "Chapter")])),
      /is not a known kind/u,
    ],
    [
      "a kind that is not text",
      utf8(envelope([record("compiled/a.json", "{}", ["chapter"])])),
      /is not a known kind/u,
    ],
    [
      "a kind named like an object member",
      utf8(envelope([record("compiled/a.json", "{}", "constructor")])),
      /is not a known kind/u,
    ],
    [
      "a record text that is not a string",
      utf8(envelope([{ path: "compiled/a.json", kind: "part", text: 1 }])),
      /must be strings/u,
    ],
    [
      "a repeated envelope key",
      utf8(
        `{"version":2,"records":[],"records":${JSON.stringify([record("compiled/a.json")])}}`,
      ),
      /key records is repeated/u,
    ],
    [
      "an escaped repeated record key",
      utf8(
        '{"version":2,"records":[{"path":"compiled/a.json","kind":"part","text":"x","\\u0074ext":"y"}]}',
      ),
      /key text is repeated/u,
    ],
  ])("refuses %s", (_name, bytes, reason) => {
    refuses(bytes, 0, reason);
  });

  it("accepts the valid envelope against its exact path set", () => {
    const run = redirected(utf8(valid));
    expect(
      acceptEnvelope(run.stdout, run.exit, [...validPaths].reverse()),
    ).toHaveLength(2);
  });

  const membership = /records are not exactly the \d+ compiled payload files/u;
  it.each([
    ["a missing record", [...validPaths, "compiled/chapters/a/gotchas.json"]],
    ["an extra record", validPaths.slice(0, 1)],
    [
      "a same-count wrong path",
      [...validPaths.slice(0, 1), "compiled/chapters/a/build.json"],
    ],
    ["an empty expected set", []],
  ])("refuses %s against the expected set", (_name, expected) => {
    refuses(utf8(valid), 0, membership, expected);
  });

  it("discards complete output on a failure exit", () => {
    refuses(utf8(valid), 1, /exit 1; stdout discarded/u);
  });

  it("discards partial output on a failure exit", () => {
    refuses(utf8(valid.slice(0, 25)), 2, /exit 2; stdout discarded/u);
  });
});

describe("the compiler's test-records command", () => {
  it("passes the committed payload with only diagnostics-free stdout", () => {
    const run = runTestRecords(prebuilt);
    expect(run.exit).toBe(0);
    const records = acceptEnvelope(
      run.stdout,
      run.exit,
      recordInventory(compiled),
    );
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) expect(r.path).toMatch(/^compiled\/.+\.json$/u);
  });

  it("is refused by the caller when the command fails", () => {
    const run = runTestRecords({ ...prebuilt, staging: "relative-staging" });
    expect(run.exit).toBe(2);
    expect(run.stderr).toMatch(/FAIL content test-records/u);
    expect(() => acceptEnvelope(run.stdout, run.exit, [])).toThrow(
      /exit 2; stdout discarded/u,
    );
  });
}, 300_000);

const web = joinPath(import.meta.dirname, "..");
const compiled = joinPath(web, "compiled");
const folders: string[] = [];
afterAll(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});

function folder(files: Record<string, string>): string {
  const root = mkdtempSync(joinPath(tmpdir(), "sl-inventory-"));
  folders.push(root);
  for (const [path, text] of Object.entries(files)) {
    const file = joinPath(root, ...path.split("/"));
    mkdirSync(joinPath(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const refusedEntry = (path: string) =>
  `compiled inventory refused: Error: ${path} is not a folder or a .json file`;

describe("the compiled inventory", () => {
  it("lists every json file but the root manifest, in ordinal order, by name only", () => {
    const root = folder({
      "manifest.json": "not read",
      "b/manifest.json": "",
      "a/Z.json": "",
      "a/a.json": "",
    });
    expect(recordInventory(root)).toEqual([
      "compiled/a/Z.json",
      "compiled/a/a.json",
      "compiled/b/manifest.json",
    ]);
  });

  it("matches the records of the committed payload", () => {
    const run = runTestRecords(prebuilt);
    const expected = recordInventory(compiled);
    const records = acceptEnvelope(run.stdout, run.exit, expected);
    expect(records.map((r) => r.path)).toEqual(expected);
  });

  it("refuses a missing root", () => {
    const root = joinPath(folder({}), "absent");
    expect(() => recordInventory(root)).toThrow(/inventory refused.*ENOENT/u);
  });

  it("refuses a root that is a file", () => {
    const root = joinPath(folder({ "x.json": "" }), "x.json");
    expect(() => recordInventory(root)).toThrow(/inventory refused.*ENOTDIR/u);
  });

  it("refuses a root that is itself a link", () => {
    const link = joinPath(folder({}), "compiled");
    symlinkSync(folder({ "a.json": "" }), link, "junction");
    expect(() => recordInventory(link)).toThrow(
      "compiled inventory refused: Error: compiled is a link",
    );
  });

  it("refuses a file that is not json", () => {
    expect(() => recordInventory(folder({ "a/notes.txt": "" }))).toThrow(
      refusedEntry("compiled/a/notes.txt"),
    );
  });

  it.each([
    ["a folder link", "junction" as const, "linked"],
    ["a file link", "file" as const, "linked.json"],
  ])("refuses %s", (_name, type, name) => {
    const root = folder({ "a/x.json": "" });
    const target = joinPath(root, "a", ...(type === "file" ? ["x.json"] : []));
    try {
      symlinkSync(target, joinPath(root, name), type);
    } catch (error) {
      // A file link needs a privilege some Windows accounts lack; the folder link never does.
      if (type === "file" && process.platform === "win32") return;
      throw error;
    }
    expect(() => recordInventory(root)).toThrow(
      refusedEntry(`compiled/${name}`),
    );
  });
});

type Records = { path: string; kind: string; text: string }[];

// The global setup's own path, given an envelope the compiler did not write.
function altered(change: (records: Records) => void) {
  const run = runTestRecords(prebuilt);
  const parsed = JSON.parse(new TextDecoder().decode(run.stdout)) as {
    version: number;
    records: Records;
  };
  change(parsed.records);
  return () => ({ stdout: utf8(JSON.stringify(parsed)), stderr: "", exit: 0 });
}

const recordChanges: [string, (records: Records) => void][] = [
  [
    "a missing record",
    (r) => {
      r.shift();
    },
  ],
  [
    "an extra record",
    (r) => {
      r.push({ path: "compiled/zz.json", kind: "part", text: "{}" });
    },
  ],
  [
    "a same-count wrong path",
    (r) => {
      r.splice(-1, 1, { path: "compiled/zz.json", kind: "part", text: "{}" });
    },
  ],
];

describe("the global setup's record set", () => {
  const provided: unknown[] = [];
  const project = {
    provide: (_key: string, value: unknown) => {
      provided.push(value);
    },
  };

  it("provides the committed records", () => {
    setup(project as never);
    expect(provided).toHaveLength(1);
  });

  it.each(recordChanges)("refuses %s", (_name, change) => {
    expect(() => {
      setup(project as never, altered(change));
    }).toThrow(/records are not exactly the \d+ compiled payload files/u);
  });
});
