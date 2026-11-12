// Content cases for both test suites: the content stage passes on the fixture, fails a changed
// fixture against the golden digest, reports compile errors by file and line, rejects an empty
// input and a malformed golden file, and fails when no SDK is found; the compiler refuses a
// relative argument, rejects output inside the content root, writes no partial output, and
// reports a malformed schema with exit 2; alias retention passes kept and honestly moved
// names and fails a name removed or redirected anywhere in the history, any commit without the
// record, the named first one included, a first commit that is absent or not an ancestor, a
// shallow clone, a grafts file, a record that is not a plain file, a replaced commit, a forged
// commit-graph cache and a tree without history.
// Usage: node tools/tests/content-cases.mjs <empty work directory>
// Needs the pinned .NET SDK and nuget.org.
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { aliasRecord, compilerDll, contentProblems, fixture, retentionProblems } from "../checks/content.mjs";
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

// Alias retention, on small repositories that hold nothing but the compiled alias record.
const gitIn = (dir, ...args) => {
  const identity = ["-c", "user.name=case", "-c", "user.email=case@example.invalid", "-c", "commit.gpgsign=false"];
  const r = exec("git", [...identity, "-c", "core.autocrlf=false", ...args], { cwd: dir });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.out}`);
  return r.out.trim();
};
const record = (slugs, ids) => `${JSON.stringify({ slugs, ids })}\n`;
const place = (dir, text) => {
  mkdirSync(join(dir, "web", "compiled"), { recursive: true });
  writeFileSync(join(dir, aliasRecord), text);
};
// One commit per entry: a record's text, or null for a commit without the record.
function history(name, ...records) {
  const dir = join(work, name);
  mkdirSync(dir);
  gitIn(dir, "init", "-q", "-b", "main");
  const commits = records.map((text, i) => {
    if (text === null) gitIn(dir, "rm", "-q", "--ignore-unmatch", aliasRecord);
    else {
      place(dir, text);
      gitIn(dir, "add", aliasRecord);
    }
    gitIn(dir, "commit", "-q", "--allow-empty", "-m", `commit ${String(i + 1)}`);
    return gitIn(dir, "rev-parse", "HEAD");
  });
  return { dir, commits };
}
const retained = ({ dir, commits }, first = commits[0]) => retentionProblems(src, { tree: dir, first });
const begin = record({ old: "test" }, { begin: "start" });
const noNames = record({}, {});

const kept = history("kept", begin, record({ old: "test", older: "test" }, { begin: "start" }));
check("retention passes an added name", retained(kept).length === 0, retained(kept).join("\n"));

// The named first commit must hold the record itself: neither a record in the working tree nor
// one committed by its child stands in for it.
const opening = history("opening", null);
const lacking = `commit ${opening.commits[0]} holds no ${aliasRecord}; every commit from ${opening.commits[0]} on holds it`;
place(opening.dir, begin);
const uncommitted = retained(opening);
check(
  "retention fails a first commit that lacks the record while HEAD is that commit",
  uncommitted.length === 1 && uncommitted[0] === lacking,
  uncommitted.join("\n"),
);
gitIn(opening.dir, "add", aliasRecord);
gitIn(opening.dir, "commit", "-q", "-m", "first record");
const child = retained(opening);
check(
  "retention fails a first commit that lacks the record under a child that holds it",
  child.length === 1 && child[0] === lacking,
  child.join("\n"),
);
const committed = retained(opening, gitIn(opening.dir, "rev-parse", "HEAD"));
check("retention passes when HEAD is the first commit and holds the record", committed.length === 0, committed.join("\n"));

const moved = history("moved", begin, record({ old: "exam", test: "exam" }, { begin: "opening", start: "opening" }));
check("retention passes a name whose old end was retired to its new end", retained(moved).length === 0, retained(moved).join("\n"));

// Retired twice, one commit at a time: the last record is judged against both earlier ones.
const twice = history("twice", record({}, { a: "t" }), record({}, { a: "v", t: "v" }));
const stepOne = retained(twice);
place(twice.dir, record({}, { a: "u", t: "u", v: "u" }));
gitIn(twice.dir, "add", aliasRecord);
gitIn(twice.dir, "commit", "-q", "-m", "second retirement");
const stepTwo = retained(twice);
check("retention passes a name retired twice across two commits", stepOne.length === 0 && stepTwo.length === 0, [...stepOne, ...stepTwo].join("\n"));

const dropped = history("dropped", begin, noNames);
const droppedProblems = retained(dropped);
check(
  "retention fails a committed removal, naming the commit that held the name",
  droppedProblems[0] === `against commit ${dropped.commits[0]}:` &&
    droppedProblems.includes('slugs: the retired name "old" was removed; a retired name is kept for good') &&
    droppedProblems.includes('ids: the retired name "begin" was removed; a retired name is kept for good'),
  droppedProblems.join("\n"),
);

const working = history("working", begin, begin);
place(working.dir, noNames);
const workingProblems = retained(working);
check(
  "retention fails an uncommitted removal once, under the newest commit with that record",
  workingProblems[0] === `against commit ${working.commits[1]}:` &&
    workingProblems.filter((p) => p.startsWith("against commit ")).length === 1,
  workingProblems.join("\n"),
);

// A removal hidden behind a later commit that changes nothing: the last step alone looks clean.
const hidden = history("hidden", begin, noNames, noNames);
const hiddenProblems = retained(hidden);
check(
  "retention fails a removal made earlier in a range of commits",
  hiddenProblems[0] === `against commit ${hidden.commits[0]}:` &&
    hiddenProblems.includes('slugs: the retired name "old" was removed; a retired name is kept for good'),
  hiddenProblems.join("\n"),
);

const back = history("back", begin, noNames, record({ old: "exam" }, { begin: "start" }));
const backProblems = retained(back);
check(
  "retention fails a name removed and brought back with another end",
  backProblems[0] === `against commit ${back.commits[0]}:` &&
    backProblems.includes('slugs: "old" ended at "test" and now ends at "exam", where "test" does not lead'),
  backProblems.join("\n"),
);

// A name added in one commit and taken out in the next was published in between.
const brief = history("brief", begin, record({ old: "test", slip: "test" }, { begin: "start" }), begin);
const briefProblems = retained(brief);
check(
  "retention keeps a name that only an intermediate commit held",
  briefProblems[0] === `against commit ${brief.commits[1]}:` &&
    briefProblems.includes('slugs: the retired name "slip" was removed; a retired name is kept for good'),
  briefProblems.join("\n"),
);

// A merge that keeps one side's record drops what the other side retired.
const merged = history("merged", begin);
gitIn(merged.dir, "checkout", "-q", "-b", "side");
place(merged.dir, record({ old: "test", extra: "test" }, { begin: "start" }));
gitIn(merged.dir, "add", aliasRecord);
gitIn(merged.dir, "commit", "-q", "-m", "side");
const side = gitIn(merged.dir, "rev-parse", "HEAD");
gitIn(merged.dir, "checkout", "-q", "main");
place(merged.dir, record({ old: "test", other: "test" }, { begin: "start" }));
gitIn(merged.dir, "add", aliasRecord);
gitIn(merged.dir, "commit", "-q", "-m", "main");
gitIn(merged.dir, "merge", "-q", "--no-ff", "-s", "ours", "-m", "merge", "side");
const mergedProblems = retained(merged);
check(
  "retention fails a merge that drops a name retired on the merged branch",
  mergedProblems[0] === `against commit ${side}:` &&
    mergedProblems.filter((p) => p.startsWith("against commit ")).length === 1 &&
    mergedProblems.includes('slugs: the retired name "extra" was removed; a retired name is kept for good'),
  mergedProblems.join("\n"),
);
place(merged.dir, record({ extra: "test", old: "test", other: "test" }, { begin: "start" }));
check("retention passes a merge that keeps the names of both sides", retained(merged).length === 0, retained(merged).join("\n"));

// A first commit on a branch HEAD never included.
gitIn(kept.dir, "checkout", "-q", "-b", "apart", kept.commits[0]);
gitIn(kept.dir, "commit", "-q", "--allow-empty", "-m", "apart");
const apart = gitIn(kept.dir, "rev-parse", "HEAD");
gitIn(kept.dir, "checkout", "-q", "main");
const apartProblems = retained(kept, apart);
check(
  "retention fails a first commit that is not an ancestor of HEAD",
  apartProblems.length === 1 && apartProblems[0] === `commit ${apart} is not an ancestor of HEAD; alias retention starts from it`,
  apartProblems.join("\n"),
);

const turned = history("turned", begin, record({ old: "test" }, { begin: "other" }));
const turnedProblems = retained(turned);
check(
  "retention fails a name pointed somewhere its old end does not lead",
  turnedProblems.includes('ids: "begin" ended at "start" and now ends at "other", where "start" does not lead'),
  turnedProblems.join("\n"),
);

const late = history("late", begin, null, begin);
const lateProblems = retained(late);
check(
  "retention fails a commit after the first one that lacks the record",
  lateProblems.length === 1 && lateProblems[0].startsWith(`commit ${late.commits[1]} holds no ${aliasRecord}; every `),
  lateProblems.join("\n"),
);
const start = history("start", null, begin);
const wrongFirst = retained(start, "0".repeat(40));
check(
  "retention fails a first commit the repository does not hold",
  wrongFirst.length === 1 && wrongFirst[0] === `commit ${"0".repeat(40)} is not in this repository`,
  wrongFirst.join("\n"),
);
// History before the first commit is not read, so only it and what follows must hold the record.
const after = history("after", null, null, begin, begin);
check("retention reads nothing before the first commit", retained(after, after.commits[2]).length === 0, retained(after, after.commits[2]).join("\n"));
const afterProblems = retained(after, after.commits[0]);
check(
  "retention names every commit that lacks the record, the first one included",
  afterProblems.length === 2 &&
    afterProblems[0].startsWith(`commit ${after.commits[1]} holds no ${aliasRecord}; every `) &&
    afterProblems[1].startsWith(`commit ${after.commits[0]} holds no ${aliasRecord}; every `),
  afterProblems.join("\n"),
);
const short = retained(start, start.commits[0].slice(0, 12));
check(
  "retention does not accept a shortened first commit",
  short.length === 1 && short[0].endsWith(" is not a full commit name"),
  short.join("\n"),
);

const garbled = history("garbled", "{}\n", noNames);
const garbledProblems = retained(garbled);
check(
  "retention fails an earlier record that is not an alias record",
  garbledProblems[0] === `against commit ${garbled.commits[0]}:` && garbledProblems.some((p) => p.startsWith("standard input: schema: ")),
  garbledProblems.join("\n"),
);

const shallow = join(work, "shallow");
gitIn(work, "clone", "-q", "--depth", "1", pathToFileURL(dropped.dir).href, shallow);
const shallowProblems = retentionProblems(src, { tree: shallow, first: dropped.commits[0] });
check(
  "retention fails a shallow clone, whose history ends early",
  shallowProblems.length === 1 && shallowProblems[0].startsWith("the repository is shallow; "),
  shallowProblems.join("\n"),
);
// Even when the clone's only commit is the named first one, nothing shows it is complete.
const shallowHead = gitIn(shallow, "rev-parse", "HEAD");
const shallowFirst = retentionProblems(src, { tree: shallow, first: shallowHead });
check(
  "retention fails a shallow clone whatever commit is named first",
  shallowFirst.length === 1 && shallowFirst[0].startsWith("the repository is shallow; "),
  shallowFirst.join("\n"),
);

// A replacement object that shows the parent as a commit which never held the dropped names.
const swapped = history("swapped", begin, noNames);
gitIn(swapped.dir, "replace", swapped.commits[0], swapped.commits[1]);
const swappedProblems = retained(swapped);
check(
  "retention reads the real parent behind a replacement object",
  swappedProblems.includes('slugs: the retired name "old" was removed; a retired name is kept for good'),
  swappedProblems.join("\n"),
);

// A commit-graph cache forged to give the commit that dropped the names the first commit as
// its parent, which hides the commit that held them from any walk that trusts the cache.
const cached = history("cached", noNames, begin, noNames, noNames);
gitIn(cached.dir, "commit-graph", "write", "--reachable");
const graph = join(cached.dir, ".git", "objects", "info", "commit-graph");
const cache = readFileSync(graph);
const chunk = (id) => {
  for (let at = 8; at < 8 + 12 * cache[6]; at += 12)
    if (cache.toString("latin1", at, at + 4) === id) return Number(cache.readBigUInt64BE(at + 4));
  throw new Error(`the commit-graph has no ${id} chunk`);
};
const rows = cache.readUInt32BE(chunk("OIDF") + 255 * 4);
const row = (commit) => cache.subarray(chunk("OIDL"), chunk("OIDL") + 20 * rows).toString("hex").indexOf(commit) / 40;
// Each commit's row holds its tree name, then the rows of its parents.
cache.writeUInt32BE(row(cached.commits[0]), chunk("CDAT") + 36 * row(cached.commits[2]) + 20);
createHash("sha1").update(cache.subarray(0, -20)).digest().copy(cache, cache.length - 20);
chmodSync(graph, 0o666);
writeFileSync(graph, cache);
check(
  "the forged commit-graph hides a commit from a walk that trusts it",
  gitIn(cached.dir, "rev-list", "--count", `${cached.commits[0]}..HEAD`) === "2",
);
const cachedProblems = retained(cached);
check(
  "retention reads the real parents behind a forged commit-graph",
  cachedProblems.includes('slugs: the retired name "old" was removed; a retired name is kept for good'),
  cachedProblems.join("\n"),
);

// A grafts file that cuts the newest commit off from the parent that held the dropped names.
const grafted = history("grafted", begin, noNames);
mkdirSync(join(grafted.dir, ".git", "info"), { recursive: true });
writeFileSync(join(grafted.dir, ".git", "info", "grafts"), `${gitIn(grafted.dir, "rev-parse", "HEAD")}\n`);
const graftedProblems = retained(grafted);
check(
  "retention fails a repository whose grafts file could hide a parent",
  graftedProblems.length === 1 && graftedProblems[0].startsWith("the repository has a grafts file; "),
  graftedProblems.join("\n"),
);

// The record stored as a link in the earlier commit, whatever the link names.
const linked = history("linked", noNames);
writeFileSync(join(work, "target.txt"), "elsewhere");
const blob = gitIn(linked.dir, "hash-object", "-w", join(work, "target.txt"));
gitIn(linked.dir, "update-index", "--add", "--cacheinfo", `120000,${blob},${aliasRecord}`);
gitIn(linked.dir, "commit", "-q", "-m", "link");
const linkCommit = gitIn(linked.dir, "rev-parse", "HEAD");
place(linked.dir, noNames);
const linkedProblems = retentionProblems(src, { tree: linked.dir, first: linked.commits[0] });
check(
  "retention fails a record stored as anything but one plain file",
  linkedProblems.includes(`commit ${linkCommit} holds ${aliasRecord} as something other than one plain file`),
  linkedProblems.join("\n"),
);

// Variables left by a hook or a caller that name another repository, one where nothing was
// dropped, must not decide which history is read.
const routed = { GIT_DIR: join(kept.dir, ".git"), GIT_WORK_TREE: kept.dir, GIT_COMMON_DIR: join(kept.dir, ".git") };
const saved = Object.fromEntries(Object.keys(routed).map((k) => [k, env[k]]));
Object.assign(env, routed);
let routedProblems;
try {
  routedProblems = retained(dropped);
} finally {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
}
check(
  "retention reads the tree's own history whatever repository the environment names",
  routedProblems[0] === `against commit ${dropped.commits[0]}:` &&
    routedProblems.includes('slugs: the retired name "old" was removed; a retired name is kept for good'),
  routedProblems.join("\n"),
);

const inner = join(dropped.dir, "web");
const innerProblems = retentionProblems(src, { tree: inner, first: dropped.commits[0] });
check(
  "retention fails a folder that is not the top of its working tree",
  innerProblems.length === 1 && innerProblems[0].includes("is not the top of a git working tree"),
  innerProblems.join("\n"),
);

const unborn = join(work, "unborn");
mkdirSync(unborn);
gitIn(unborn, "init", "-q", "-b", "main");
place(unborn, noNames);
const unbornProblems = retentionProblems(src, { tree: unborn });
const outside = retentionProblems(src, { tree: join(work, "empty") });
check(
  "retention fails a folder outside any repository",
  outside.length === 1 && outside[0].includes("is not the top of a git working tree"),
  outside.join("\n"),
);
check(
  "retention fails a repository without a commit",
  unbornProblems.length === 1 && unbornProblems[0].startsWith("no commit to compare with"),
  unbornProblems.join("\n"),
);

const absent = history("absent", begin, begin);
rmSync(join(absent.dir, aliasRecord));
const absentProblems = retained(absent);
check(
  "retention fails a working tree that lost the record",
  absentProblems.some((p) => p.endsWith("the compiled folder holds no such file")),
  absentProblems.join("\n"),
);

process.exitCode = failed > 0 ? 1 : 0;
