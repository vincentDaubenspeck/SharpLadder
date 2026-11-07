// Content cases for both test suites: the content stage passes on the fixture, fails a changed
// fixture against the golden digest, reports compile errors by file and line, rejects an empty
// input and a malformed golden file, and fails when no SDK is found; the compiler refuses a
// relative argument, rejects output inside the content root, writes no partial output, and
// reports a malformed schema with exit 2.
// Usage: node tools/tests/content-cases.mjs <empty work directory>
// Needs the pinned .NET SDK and nuget.org.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { compilerDll, contentProblems, fixture } from "../checks/content.mjs";
import { dotnet, env, exec } from "../checks/lib.mjs";

const src = join(import.meta.dirname, "..", "..");
const work = resolve(process.argv[2] ?? ".");
const node = process.execPath;
const lines = (out) => out.split(/\r?\n/);

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (ok) return;
  failed++;
  for (const line of detail.split(/\r?\n/).filter((l) => l.trim() !== "")) console.log(`  ${line}`);
}

mkdirSync(work, { recursive: true });
const build = exec(dotnet, ["build", "tools/SharpLadder.Content/SharpLadder.Content.csproj", "-nologo"], { cwd: src });
check("content compiler builds", build.code === 0, build.out);

const stage = exec(node, [join(src, "tools", "checks", "content.mjs"), src], { cwd: src });
check(
  "content stage passes the repository fixture",
  stage.code === 0 && lines(stage.out).includes("PASS content") && /content output digest sha256:[0-9a-f]{64}/.test(stage.out),
  stage.out,
);

// A copy of the fixture with one edit, compiled against the committed golden digest.
function edited(name, file, from, to) {
  const dir = join(work, name);
  cpSync(join(src, fixture), dir, { recursive: true });
  const path = join(dir, "chapters", "fixture-basics", file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} lacks ${from}`);
  writeFileSync(path, text.replace(from, to));
  return contentProblems(src, { input: dir });
}

const changed = edited("changed", "syntax.md", "running total", "running sum");
check(
  "content fails a changed fixture against the golden digest",
  changed.length === 1 && changed[0].includes("differs from tools/SharpLadder.Content.Tests/fixtures/content.sha256"),
  changed.join("\n"),
);

const broken = edited("broken", "syntax.md", "## Sum with `foreach` {#syn-fix-sum}", "## Sum with `foreach`");
check(
  "content reports a compile error by file and line",
  broken.some((p) => /chapters\/fixture-basics\/syntax\.md:7: heading has no \{#id\}/.test(p)),
  broken.join("\n"),
);

const empty = join(work, "empty");
mkdirSync(empty);
const none = contentProblems(src, { input: empty });
check(
  "content fails an empty input directory",
  none.some((p) => p.endsWith("no content files found under chapters/")),
  none.join("\n"),
);

const badGolden = join(work, "bad.sha256");
writeFileSync(badGolden, "not a digest\n");
const malformed = contentProblems(src, { golden: badGolden });
check(
  "content fails a malformed golden file",
  malformed.length === 1 && malformed[0].endsWith("must hold one lowercase SHA-256 digest"),
  malformed.join("\n"),
);

// The compiler itself: exit 2 with a diagnostic for every setup or environment failure.
const compile = (schemaDir, input, output) =>
  exec(dotnet, [join(src, compilerDll), schemaDir, input, output], { cwd: src });
const schemaFolder = join(src, "content", "schema");

const relativeOut = join(work, "relative-out");
const relative = compile("content/schema", join(src, fixture), relativeOut);
check(
  "compiler refuses a relative argument before opening anything",
  relative.code === 2 && relative.out.includes("content/schema: not accepted; give a full path") && !existsSync(relativeOut),
  relative.out,
);

const nested = join(work, "nested");
cpSync(join(src, fixture), nested, { recursive: true });
const inside = compile(schemaFolder, nested + sep, join(nested, "generated"));
check(
  "compiler rejects output inside a content root given with a trailing separator",
  inside.code === 2 && inside.out.includes("the output folder must lie outside the content root") && !existsSync(join(nested, "generated")),
  inside.out,
);

// A 254-character source name is legal; its .json name passes the 255 limit of NTFS and ext4.
const unwritable = join(work, "unwritable");
cpSync(join(src, fixture), unwritable, { recursive: true });
writeFileSync(
  join(unwritable, "chapters", "fixture-basics", `${"z".repeat(251)}.md`),
  "---\nkind: syntax\nchapter: ch-fixture\norder: 3\n---\n\n## Extra {#syn-fix-extra}\n\nText.\n",
);
const partialParent = join(work, "partial");
const partial = compile(schemaFolder, unwritable, join(partialParent, "out"));
check(
  "compiler leaves no output when a file cannot be written",
  partial.code === 2 && partial.out.includes("output not written: ") && !existsSync(partialParent),
  partial.out,
);

const badSchema = join(work, "bad-schema");
cpSync(join(src, "content", "schema"), badSchema, { recursive: true });
const contentSchema = join(badSchema, "content.schema.json");
writeFileSync(contentSchema, readFileSync(contentSchema, "utf8").replace('"minimum": 1', '"minimum": "not-a-number"'));
const malformedSchema = compile(badSchema, join(src, fixture), join(work, "bad-schema-out"));
check(
  "compiler reports a malformed schema as a setup error",
  malformedSchema.code === 2 && malformedSchema.out.includes("schema: the schema files do not form a valid draft-07 schema: ")
    && lines(malformedSchema.out).includes("FAIL content compiler"),
  malformedSchema.out,
);

// With no SDK at all, the content stage reports the missing .NET config instead of running.
const bare = join(work, "bare");
mkdirSync(join(bare, "tools", "checks"), { recursive: true });
for (const f of ["lib.mjs", "dotnet.mjs", "content.mjs"]) {
  copyFileSync(join(src, "tools", "checks", f), join(bare, "tools", "checks", f));
}
copyFileSync(join(src, "tools", "tool-pins.json"), join(bare, "tools", "tool-pins.json"));
copyFileSync(join(src, "global.json"), join(bare, "global.json"));
const emptyPath = join(work, "no-path");
mkdirSync(emptyPath);
const noPath = Object.fromEntries(Object.entries(env).filter(([k]) => k.toUpperCase() !== "PATH"));
const noSdk = exec(node, [join(bare, "tools", "checks", "content.mjs"), bare], {
  cwd: bare,
  env: { ...noPath, PATH: emptyPath },
});
const out = lines(noSdk.out);
const at = out.indexOf("FAIL content");
check(
  "no SDK: content fails",
  noSdk.code !== 0 && out.includes("FAIL .NET config") && at > 0 && out[at - 1] === "  needs .NET config (see above)",
  noSdk.out,
);

process.exitCode = failed > 0 ? 1 : 0;
