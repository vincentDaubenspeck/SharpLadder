// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkAssets } from "./asset-licence-check.js";
import { snapshot } from "./build-guard/output.js";

const web = import.meta.dirname;
const cli = fileURLToPath(new URL("asset-licence-check.js", import.meta.url));
const checks = join(web, "..", "tools", "checks");
const hash = (text) => createHash("sha256").update(text).digest("hex");

const bases = [];
const links = [];
afterAll(() => {
  // Links go first, so a recursive delete never follows one out of the fixture.
  for (const path of links.splice(0)) unlinkSync(path);
  for (const base of bases.splice(0))
    rmSync(base, { recursive: true, force: true });
});

// A junction on Windows needs no privilege; the type is ignored elsewhere.
function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
  links.push(path);
}

const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const body = [
  "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
  "",
  "SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007",
  "",
  'The term "Reserved Font Name" is defined here, below the notice.',
  "",
];
const ofl = (...notice) => [...notice, "", ...body].join("\n");
const monoNotice = ofl(
  "Copyright 2026 Fixture Authors, with Reserved Font Name Sample Mono.",
);
const sansNotice = ofl("Copyright 2026 Fixture Authors.");
const notices = { "sample-mono": monoNotice, "sample-sans": sansNotice };
const font = "fixture font bytes\n";

const mono = () => ({
  schemaVersion: 1,
  id: "sample-mono",
  family: "Sample Mono",
  upstreamSource: "https://example.com/sample-mono",
  upstreamRevision: "a".repeat(40),
  upstreamTag: null,
  originalFiles: [
    {
      id: "regular",
      acquisitionPath: "fonts/SampleMono-Regular.woff2",
      sha256: hash(font),
    },
  ],
  copyright:
    "Copyright 2026 Fixture Authors, with Reserved Font Name Sample Mono.",
  licence: "OFL-1.1",
  licenceText: {
    sourcePath: "web/assets/licences/sample-mono/OFL.txt",
    sha256: hash(monoNotice),
    distributionPath: null,
  },
  reservedFontNames: ["Sample Mono"],
  renamedIdentity: false,
  distributedFamilyName: null,
  transformation: { kind: "none" },
  distributedFiles: [],
  shipped: false,
});

const sans = () => ({
  ...mono(),
  id: "sample-sans",
  family: "Sample Sans",
  copyright: "Copyright 2026 Fixture Authors.",
  licenceText: {
    sourcePath: "web/assets/licences/sample-sans/OFL.txt",
    sha256: hash(sansNotice),
    distributionPath: null,
  },
  reservedFontNames: [],
});

const fontPath = (id) => `assets/fonts/${id}/Regular.woff2`;
const shipped = (record) => ({
  ...record,
  shipped: true,
  distributedFamilyName: record.family,
  licenceText: {
    ...record.licenceText,
    distributionPath: `assets/fonts/${record.id}/OFL.txt`,
  },
  distributedFiles: [
    {
      distPath: fontPath(record.id),
      sha256: hash(font),
      fromOriginal: "regular",
    },
  ],
});

const inventory = (assets) => ({
  schemaVersion: 1,
  allowedLicences: ["OFL-1.1"],
  noticesContract: {
    assetsAreNoticesSource: true,
    servedWithEachShippedAsset: ["copyright", "licenceText"],
    siteLicenceGrantsExcludeAssets: true,
    consumer: "notices-page-generator",
    consumerReads: "web/assets/licences/asset-inventory.json",
  },
  assets,
});

// Computed here rather than imported, so the test pins the formula the check uses.
const declared = (record) =>
  hash(record.licenceText.sha256 + JSON.stringify(record.reservedFontNames));
// A record without the field is sealed as reviewed; a test sets it to make it stale.
const sealed = (record) =>
  "declarationHash" in record
    ? record
    : { ...record, declarationHash: declared(record) };

/** An isolated repository root holding only the inventory and its licence texts. */
function repoFixture(records, { text, texts = notices } = {}) {
  const assets = records.map(sealed);
  const base = mkdtempSync(join(tmpdir(), "sl-assets-"));
  bases.push(base);
  const root = join(base, "repo");
  const licences = join(root, "web", "assets", "licences");
  write(
    join(licences, "asset-inventory.json"),
    text ?? JSON.stringify(inventory(assets), null, 2),
  );
  for (const record of assets) {
    if (texts[record.id] !== undefined)
      write(join(licences, record.id, "OFL.txt"), texts[record.id]);
  }
  return { base, root, licences };
}

/** A one-record root whose licence text is given, with the copyright it must carry. */
const withText = (copyright, text) => (reservedFontNames) =>
  repoFixture(
    [
      {
        ...mono(),
        copyright,
        licenceText: { ...mono().licenceText, sha256: hash(text) },
        reservedFontNames,
      },
    ],
    { texts: { "sample-mono": text } },
  );
const withNotice = (copyright) => withText(copyright, ofl(copyright));

const built = { "index.html": "<!doctype html>\n", "assets/app.js": "x;\n" };

/** A complete output for the given records, with the build guard's owned files beside it. */
function outputFixture(assets, options = {}) {
  const fixture = repoFixture(assets, options);
  const output = join(fixture.base, "dist");
  const owned = {};
  for (const [path, content] of Object.entries(built)) {
    write(join(output, path), content);
    owned[path] = hash(content);
  }
  for (const record of assets.filter((a) => a.shipped)) {
    write(join(output, fontPath(record.id)), font);
    write(
      join(output, record.licenceText.distributionPath),
      notices[record.id],
    );
  }
  return { ...fixture, output, owned: new Map(Object.entries(owned)) };
}

const check = ({ root, output = null, owned = null }, seams) =>
  checkAssets({ root, output, owned }, seams);

const run = (args) => {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  // The test timer cannot interrupt spawnSync, so a hung check is killed here.
  if (r.error) throw r.error;
  if (r.signal) throw new Error(`the check was killed by ${r.signal}.`);
  return r;
};

const fails = (problems, pattern) =>
  expect(problems.join("\n")).toMatch(pattern);

// Suites timed at 30_000 spawn the check or the stage runner; Node loads them cold.

describe("asset licence metadata", () => {
  it("A71 the production inventory passes, and says it is no shipping acceptance", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/not a shipping acceptance/u);
    expect(r.stdout).not.toMatch(/output closure valid/u);
  });

  it("A72 unshipped metadata-only records pass in an isolated root", () => {
    expect(check(repoFixture([mono(), sans()]))).toEqual([]);
  });

  it("A73 malformed JSON fails", () => {
    fails(check(repoFixture([mono()], { text: "{ " })), /JSON/u);
  });

  it("A74 unknown fields, wrong types and short identifiers fail", () => {
    const cases = [
      [{ ...mono(), note: "x" }, /additional properties/u],
      [{ ...mono(), shipped: "no" }, /boolean/u],
      [{ ...mono(), id: "" }, /\/assets\/0\/id/u],
      [{ ...mono(), upstreamRevision: "a".repeat(8) }, /upstreamRevision/u],
      [
        {
          ...mono(),
          originalFiles: [{ ...mono().originalFiles[0], sha256: "ab" }],
        },
        /sha256/u,
      ],
      [{ ...mono(), originalFiles: [] }, /originalFiles/u],
    ];
    for (const [record, pattern] of cases)
      fails(check(repoFixture([record])), pattern);
    const extra = repoFixture([], {
      text: JSON.stringify({ ...inventory([]), extra: true }),
    });
    fails(check(extra), /additional properties/u);
  });

  it("A75 unknown, disallowed and compound licence identifiers fail", () => {
    for (const licence of ["OFL-9.9", "MIT", "OFL-1.1 OR MIT", "ofl-1.1"])
      fails(check(repoFixture([{ ...mono(), licence }])), /licence/u);
    const wider = repoFixture([], {
      text: JSON.stringify({
        ...inventory([]),
        allowedLicences: ["OFL-1.1", "MIT"],
      }),
    });
    fails(check(wider), /allowedLicences/u);
  });

  it("A76 only transformation kinds none and subset are accepted", () => {
    fails(
      check(repoFixture([{ ...mono(), transformation: { kind: "rename" } }])),
      /transformation/u,
    );
    const partial = { kind: "subset", tool: "t", version: "1", options: [] };
    fails(
      check(repoFixture([{ ...mono(), transformation: partial }])),
      /transformation/u,
    );
    const ghost = { ...partial, inputs: ["missing"] };
    fails(
      check(repoFixture([{ ...mono(), transformation: ghost }])),
      /input missing is not an original/u,
    );
  });

  it("A77 unshipped records carry no distribution; shipped ones need files", () => {
    const leaked = { ...shipped(mono()), shipped: false };
    fails(check(repoFixture([leaked])), /distributedFiles/u);
    const named = { ...mono(), distributedFamilyName: "Sample Mono" };
    fails(check(repoFixture([named])), /distributedFamilyName/u);
    const empty = { ...shipped(mono()), distributedFiles: [] };
    fails(check(repoFixture([empty])), /distributedFiles/u);
  });

  it("A78 duplicate ids and overlapping output paths fail", () => {
    fails(
      check(repoFixture([mono(), mono()])),
      /id sample-mono is not unique/u,
    );
    const a = outputFixture([shipped(mono())]);
    const clash = shipped(sans());
    clash.distributedFiles[0].distPath = fontPath("sample-mono");
    const both = outputFixture([shipped(mono()), clash]);
    fails(check(both), /owned by both/u);
    const cased = shipped(sans());
    cased.distributedFiles[0].distPath = fontPath("Sample-Mono");
    fails(check(outputFixture([shipped(mono()), cased])), /owned by both/u);
    const guard = new Map([...a.owned, [fontPath("sample-mono"), hash(font)]]);
    fails(check({ ...a, owned: guard }), /owned by both the build guard/u);
  });

  it("A79 licence texts must match, carry the notice and be declared", () => {
    const altered = repoFixture([mono()], {
      texts: { "sample-mono": `${monoNotice} ` },
    });
    fails(check(altered), /licence text hash does not match/u);
    fails(check(repoFixture([mono()], { texts: {} })), /cannot read licence/u);
    const stray = repoFixture([mono()]);
    write(join(stray.licences, "sample-mono", "NOTES.txt"), "x\n");
    fails(check(stray), /NOTES.txt is not declared/u);
    fails(
      check(repoFixture([{ ...mono(), copyright: "Copyright 1999 Nobody." }])),
      /does not carry the copyright/u,
    );
    fails(
      check(repoFixture([{ ...mono(), reservedFontNames: [] }])),
      /reserves a font name/u,
    );
    const moved = {
      ...mono(),
      licenceText: { ...mono().licenceText, sourcePath: "web/OFL.txt" },
    };
    fails(check(repoFixture([moved])), /must be stored at/u);
  });

  it("A90 each reserved name appears verbatim in the notice", () => {
    const named = (reservedFontNames) =>
      check(repoFixture([{ ...mono(), reservedFontNames }]));
    fails(
      named(["Other Mono"]),
      /reserved name Other Mono is not in the notice/u,
    );
    fails(
      named(["sample mono"]),
      /reserved name sample mono is not in the notice/u,
    );
    fails(named(["Sample Mono", "Sample Mono"]), /duplicate items/u);
    fails(named([" "]), /reservedFontNames\/0/u);
    const two = withNotice(
      'Copyright 2026 Fixture Authors, with Reserved Font Names "Sample Mono" and "Sample Code".',
    );
    expect(check(two(["Sample Mono", "Sample Code"]))).toEqual([]);
    // Whitespace is compared exactly, so differently spaced text is another name.
    for (const name of ["Sample\tMono", "Sample  Mono"]) {
      const spaced = withNotice(
        `Copyright 2026 Fixture Authors, with Reserved Font Name ${name}.`,
      );
      fails(
        check(spaced(["Sample Mono"])),
        /reserved name Sample Mono is not in the notice/u,
      );
    }
  });

  it("A93 the notice ends at exactly one licence body marker", () => {
    const copyright = "Copyright 2026 Fixture Authors.";
    const missing = withText(
      copyright,
      sansNotice.replace("SIL OPEN FONT LICENSE", "SIL Open Font License"),
    );
    fails(
      check(missing([])),
      /must hold "SIL OPEN FONT LICENSE Version 1\.1" exactly once/u,
    );
    const twice = withText(copyright, `${sansNotice}${body.join("\n")}`);
    fails(check(twice([])), /exactly once/u);
    const spaced = withText(
      copyright,
      sansNotice.replace("SIL OPEN FONT LICENSE", "SIL  OPEN FONT LICENSE"),
    );
    fails(check(spaced([])), /exactly once/u);
    // The term in the licence body below the marker never asks for a list.
    expect(check(repoFixture([sans()]))).toEqual([]);
  });

  it("A94 a reservation needs a list; only a listed negative covers its own occurrence", () => {
    fails(
      check(repoFixture([{ ...mono(), reservedFontNames: [] }])),
      /the notice reserves a font name but the list is empty/u,
    );
    for (const negative of [
      "with no Reserved Font Name.",
      "with no Reserved Font Names.",
    ]) {
      const only = withNotice(`Copyright 2026 Fixture Authors, ${negative}`);
      expect(check(only([]))).toEqual([]);
    }
    const mixed = withNotice(
      "Copyright 2026 Fixture Authors, with no Reserved Font Name. Copyright 2027 Other Authors, with Reserved Font Name Other Mono.",
    );
    fails(check(mixed([])), /reserves a font name but the list is empty/u);
    expect(check(mixed(["Other Mono"]))).toEqual([]);
    const unlisted = withNotice(
      "Copyright 2026 Fixture Authors, with no reserved font name.",
    );
    fails(check(unlisted([])), /reserves a font name but the list is empty/u);
    const tabbed = withNotice(
      "Copyright 2026 Fixture Authors, with\tno Reserved Font Name.",
    );
    fails(check(tabbed([])), /reserves a font name but the list is empty/u);
  });

  it("A95 declarationHash binds the licence hash to the reserved names", () => {
    fails(
      check(repoFixture([{ ...mono(), declarationHash: "0".repeat(64) }])),
      /declarationHash does not match/u,
    );
    const edited = {
      ...mono(),
      reservedFontNames: ["Sample Mono", "Fixture Authors"],
      declarationHash: declared(mono()),
    };
    fails(check(repoFixture([edited])), /declarationHash does not match/u);
    // The list is order-significant, so a reorder is an edit too.
    const pair = { ...mono(), reservedFontNames: ["Sample Mono", "Fixture"] };
    const reordered = {
      ...pair,
      reservedFontNames: ["Fixture", "Sample Mono"],
      declarationHash: declared(pair),
    };
    expect(check(repoFixture([pair]))).toEqual([]);
    fails(check(repoFixture([reordered])), /declarationHash does not match/u);
    const relicensed = {
      ...mono(),
      licenceText: { ...mono().licenceText, sha256: hash(sansNotice) },
      declarationHash: declared(mono()),
    };
    fails(
      check(
        repoFixture([relicensed], { texts: { "sample-mono": sansNotice } }),
      ),
      /declarationHash does not match/u,
    );
    fails(
      check(repoFixture([{ ...mono(), declarationHash: "ab" }])),
      /declarationHash/u,
    );
  });

  it("A95b declarationHash matches fixed digests of the hex string and UTF-8 names", () => {
    const copyright =
      "Copyright 2026 Fixture Authors, with Reserved Font Name Ünïcode Sans.";
    const text = ofl(copyright);
    const licenceHash =
      "0ec39ae627346c17e4a39bc40688d271752544dc8a416c462eb152a6bcab0a60";
    expect(hash(text)).toBe(licenceHash);
    const record = (declarationHash) => ({
      ...mono(),
      copyright,
      licenceText: { ...mono().licenceText, sha256: licenceHash },
      reservedFontNames: ["Ünïcode Sans"],
      declarationHash,
    });
    const fixture = (declarationHash) =>
      check(
        repoFixture([record(declarationHash)], {
          texts: { "sample-mono": text },
        }),
      );
    const hexString =
      "923b57a9255a661e9282190f47ab18e0e0bc8d270a1aaca3a2b9299c2e8ff800";
    expect(fixture(hexString)).toEqual([]);
    // Digest bytes in place of the hex string give a different, rejected value.
    const digestBytes =
      "e03fac2fb4e90b7ab316ade01ba11179b51f41c36f3f502543abea7bde5ccb96";
    fails(fixture(digestBytes), /declarationHash does not match/u);
    // Names encoded as Latin-1 rather than UTF-8 are rejected too.
    const latin1 =
      "12aeedc7fe5f9e8fe3cc8d95e302a73305c05effe6647be8e1bb9fe7b64b7fe4";
    fails(fixture(latin1), /declarationHash does not match/u);
  });

  it("A96 the three production records carry the reviewed names and their hashes", () => {
    const real = JSON.parse(
      readFileSync(
        join(web, "assets", "licences", "asset-inventory.json"),
        "utf8",
      ),
    );
    const names = Object.fromEntries(
      real.assets.map((a) => [a.id, a.reservedFontNames]),
    );
    expect(names).toEqual({
      "noto-sans": [],
      "noto-sans-display": [],
      "cascadia-code": ["Cascadia Code"],
    });
    for (const asset of real.assets)
      expect(asset.declarationHash).toBe(declared(asset));
    expect(check({ root: join(web, "..") })).toEqual([]);
  });

  it("A97 a misreading of a declaration is a review boundary, not a detection claim", () => {
    // Each listed name occurs verbatim, so only the reviewer can see the list is wrong.
    const split = withNotice(
      'Copyright 2026 Fixture Authors, with Reserved Font Name "Sample. Mono".',
    );
    expect(check(split(["Sample"]))).toEqual([]);
    const joined = withNotice(
      'Copyright 2026 Fixture Authors, with Reserved Font Names "Sample and Code" and "Other Mono".',
    );
    expect(check(joined(["Sample", "Code", "Other Mono"]))).toEqual([]);
  });

  it("A91 declared output paths are safe and unique without a build", () => {
    const escaping = shipped(mono());
    escaping.distributedFiles[0].distPath = "../font.ttf";
    fails(
      check(repoFixture([escaping])),
      /output path \.\.\/font.ttf has a dot segment/u,
    );
    const licence = shipped(mono());
    licence.licenceText.distributionPath = "../OFL.txt";
    fails(
      check(repoFixture([licence])),
      /output path \.\.\/OFL.txt has a dot segment/u,
    );
    for (const other of ["assets/shared.ttf", "Assets/Shared.TTF"]) {
      const first = shipped(mono());
      first.distributedFiles[0].distPath = "assets/shared.ttf";
      const second = shipped(sans());
      second.distributedFiles[0].distPath = other;
      fails(
        check(repoFixture([first, second])),
        /is owned by both asset sample-mono and asset sample-sans/u,
      );
    }
  });

  it("A80 traversal, absolute, backslash and case-colliding paths fail", () => {
    for (const distPath of [
      "assets/../../escape.woff2",
      "./assets/x.woff2",
      "/assets/x.woff2",
      "C:/assets/x.woff2",
      "assets\\x.woff2",
    ]) {
      const record = shipped(mono());
      record.distributedFiles[0].distPath = distPath;
      fails(
        check(outputFixture([record])),
        /output path .* (has a dot segment|is absolute|uses a backslash)|distPath: should match pattern/u,
      );
    }
    const traversal = {
      ...mono(),
      licenceText: {
        ...mono().licenceText,
        sourcePath: "web/assets/licences/../../../OFL.txt",
      },
    };
    fails(check(repoFixture([traversal])), /must be stored at/u);
    const caseOnly = repoFixture([mono()]);
    write(join(caseOnly.licences, "Sample-Mono", "x.txt"), "x\n");
    fails(check(caseOnly), /collides in case|x.txt is not declared/u);
  });

  it("A81 links and junctions fail closed in the repository and the output", () => {
    const repoLinked = repoFixture([mono()], { texts: {} });
    const elsewhere = join(repoLinked.base, "elsewhere");
    write(join(elsewhere, "OFL.txt"), monoNotice);
    link(elsewhere, join(repoLinked.licences, "sample-mono"));
    fails(check(repoLinked), /link or junction/u);

    const out = outputFixture([shipped(mono())]);
    link(elsewhere, join(out.output, "assets", "more"));
    fails(check(out), /link or junction/u);

    const moved = outputFixture([shipped(mono())]);
    const real = `${moved.output}-real`;
    rmSync(moved.output, { recursive: true });
    mkdirSync(real);
    link(real, moved.output);
    fails(check(moved), /not a real directory/u);
  });

  it("A82 read failures fail closed", () => {
    const fixture = outputFixture([shipped(mono())]);
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    const failing = {
      readdir: () => {
        throw denied;
      },
    };
    fails(check(fixture, failing), /cannot list .*denied/u);
    fails(check(fixture, failing), /cannot read the output: denied/u);
    const unreadable = {
      readFile: (path) => {
        if (String(path).endsWith("OFL.txt")) throw denied;
        return readFileSync(path);
      },
    };
    fails(check(fixture, unreadable), /cannot read licence text: denied/u);
  });

  it("A83 production records stay unshipped until the build guard admits fonts", () => {
    const real = JSON.parse(
      readFileSync(join(web, "assets/licences/asset-inventory.json"), "utf8"),
    );
    const record = real.assets.find((a) => a.id === "noto-sans");
    const promoted = {
      ...real,
      assets: [
        {
          ...record,
          shipped: true,
          distributedFamilyName: record.family,
          licenceText: {
            ...record.licenceText,
            distributionPath: "assets/fonts/noto-sans/OFL.txt",
          },
          distributedFiles: [
            {
              distPath: "assets/fonts/noto-sans/NotoSans.ttf",
              sha256: record.originalFiles[0].sha256,
              fromOriginal: record.originalFiles[0].id,
            },
          ],
        },
        ...real.assets.filter((a) => a !== record),
      ],
    };
    const seams = {
      readFile: (path) =>
        String(path).endsWith("asset-inventory.json")
          ? Buffer.from(JSON.stringify(promoted))
          : readFileSync(path),
    };
    fails(
      checkAssets({}, seams),
      /asset noto-sans: no font ships until the build guard admits fonts/u,
    );
  });
}, 30_000);

describe("asset licence output closure", () => {
  const writeOwned = (fixture, owned = fixture.owned) => {
    const file = join(fixture.base, "owned.json");
    writeFileSync(file, JSON.stringify({ files: Object.fromEntries(owned) }));
    return file;
  };

  it("A84 an isolated complete output passes from the command line", () => {
    const fixture = outputFixture([shipped(mono()), sans()]);
    const r = run([
      "--root",
      fixture.root,
      "--output",
      fixture.output,
      "--owned",
      writeOwned(fixture),
    ]);
    expect(r.stdout).toMatch(/asset output closure valid/u);
    expect(r.status).toBe(0);
  });

  it("A85 an absent output directory or owned list is a failure", () => {
    const fixture = outputFixture([mono()]);
    const absent = join(fixture.base, "missing");
    const r = run([
      "--root",
      fixture.root,
      "--output",
      absent,
      "--owned",
      writeOwned(fixture),
    ]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/output directory does not exist/u);
    const alone = run(["--root", fixture.root, "--output", fixture.output]);
    expect(alone.status).toBe(1);
    expect(alone.stdout).toMatch(/go together/u);
    fails(check({ ...fixture, owned: null }), /needs the build-guard-owned/u);
  });

  it("A92 a repeated key in the owned list fails instead of being merged", () => {
    const fixture = outputFixture([]);
    const entry = `"index.html": "${fixture.owned.get("index.html")}"`;
    const rest = `"assets/app.js": "${fixture.owned.get("assets/app.js")}"`;
    for (const files of [
      `{${entry}, ${entry}, ${rest}}`,
      `{${entry}, "index\\u002ehtml": "${"0".repeat(64)}", ${rest}}`,
    ]) {
      const file = join(fixture.base, "owned.json");
      writeFileSync(file, `{"files": ${files}}`);
      const r = run([
        "--root",
        fixture.root,
        "--output",
        fixture.output,
        "--owned",
        file,
      ]);
      expect(r.stdout).toMatch(/duplicate key "index.html"/u);
      expect(r.status).toBe(1);
    }
  });

  it("A86 extra, missing, mismatched and altered outputs fail", () => {
    const disguised = outputFixture([shipped(mono())]);
    write(join(disguised.output, "assets", "extra.js"), "x;\n");
    fails(check(disguised), /unowned file assets\/extra.js/u);

    const noFont = outputFixture([shipped(mono())]);
    rmSync(join(noFont.output, fontPath("sample-mono")));
    fails(check(noFont), /missing assets\/fonts\/sample-mono\/Regular.woff2/u);

    const swapped = outputFixture([shipped(mono())]);
    write(join(swapped.output, fontPath("sample-mono")), "other bytes\n");
    fails(check(swapped), /Regular.woff2 differs from its hash/u);

    const noLicence = outputFixture([shipped(mono())]);
    rmSync(join(noLicence.output, "assets/fonts/sample-mono/OFL.txt"));
    fails(check(noLicence), /missing assets\/fonts\/sample-mono\/OFL.txt/u);

    const edited = outputFixture([shipped(mono())]);
    write(
      join(edited.output, "assets/fonts/sample-mono/OFL.txt"),
      monoNotice.replace("2026", "2025"),
    );
    fails(check(edited), /OFL.txt differs from its hash/u);

    const relabelled = shipped(mono());
    relabelled.distributedFiles[0].sha256 = hash("other bytes\n");
    fails(
      check(outputFixture([relabelled])),
      /is untransformed but differs from its original/u,
    );
  });

  it("A87 a modified font with a reserved name must take a new identity", () => {
    const subset = (record, rename) => ({
      ...shipped(record),
      transformation: {
        kind: "subset",
        tool: "fixture-subset",
        version: "1.0.0",
        options: ["--latin"],
        inputs: ["regular"],
      },
      ...rename,
    });
    fails(
      check(repoFixture([subset(mono(), { renamedIdentity: false })])),
      /modified font with a reserved name is not renamed/u,
    );
    fails(
      check(
        repoFixture([
          subset(mono(), {
            renamedIdentity: true,
            distributedFamilyName: "Sample-Mono Latin",
          }),
        ]),
      ),
      /distributed family keeps reserved name Sample Mono/u,
    );
    const renamed = check(
      repoFixture([
        subset(mono(), {
          renamedIdentity: true,
          distributedFamilyName: "Ladder Code Latin",
        }),
      ]),
    );
    expect(renamed.join("\n")).not.toMatch(/reserved|renamed|copyright/u);
    fails(renamed, /modified fonts cannot ship until binary naming/u);
  });
}, 30_000);

describe("asset licence stage", () => {
  const lib = pathToFileURL(join(checks, "lib.mjs")).href;
  const stages = pathToFileURL(join(checks, "web.mjs")).href;
  // The child shares the stage runner and exit-code setter of tools/checks/run.mjs,
  // so its exit code is the one check.sh reads.
  const stage = `
import { setExitCode } from ${JSON.stringify(lib)};
import { runWebStage, webStages } from ${JSON.stringify(stages)};
const [web, root] = process.argv.slice(1);
const step = webStages.find(([name]) => name === "asset licence inventory");
runWebStage(web, step, ["--root", root]);
setExitCode();
`;
  const runStage = (root) => {
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", stage, web, root],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (r.error) throw r.error;
    if (r.signal) throw new Error(`the stage was killed by ${r.signal}.`);
    return r;
  };

  it("A88 a failing inventory fails the check run, and a valid one passes", () => {
    const bad = runStage(repoFixture([{ ...mono(), licence: "MIT" }]).root);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/FAIL asset licence inventory/u);
    const good = runStage(repoFixture([mono()]).root);
    expect(good.stdout).toMatch(/PASS asset licence inventory/u);
    expect(good.status).toBe(0);
  });

  it("A89 the build guard still rejects a font output", () => {
    const bundle = {
      "assets/app.js": { fileName: "assets/app.js", type: "chunk", code: "x" },
      "index.html": { fileName: "index.html", type: "asset", source: "<p>" },
      [fontPath("sample-mono")]: {
        fileName: fontPath("sample-mono"),
        type: "asset",
        source: new Uint8Array([1]),
      },
    };
    expect(() => snapshot(bundle)).toThrow(/unexpected asset output/u);
  });
}, 30_000);
