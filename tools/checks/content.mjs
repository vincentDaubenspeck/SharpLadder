// The content stage: compiles the fixture chapter with tools/SharpLadder.Content and compares
// the digest of its output with the committed golden value, so a change in the compiler's
// output, on any OS, fails until the golden value is reviewed and updated.
// The alias retention stage then judges the working alias record against every alias record
// its history holds, so no commit, pushed alone or in a range, drops a retired name or points
// it somewhere new.
// Usage: node tools/checks/content.mjs [repository root]   (builds the compiler first)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { dotnetChecks } from "./dotnet.mjs";
import { anyFailed, dotnet, env, exec, report, toolProblems } from "./lib.mjs";

const project = "tools/SharpLadder.Content/SharpLadder.Content.csproj";
export const compilerDll = "tools/SharpLadder.Content/bin/Debug/net10.0/SharpLadder.Content.dll";
const schema = "content/schema";
export const fixture = "tools/SharpLadder.Content.Tests/fixtures/content";
export const goldenFile = "tools/SharpLadder.Content.Tests/fixtures/content.sha256";

// The same value as OutputDigest.cs: SHA-256 over "<hex>  <path>\n" lines, one per file, in
// ordinal path order. JavaScript compares strings by UTF-16 code unit, as ordinal C# does.
export function outputDigest(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else files.push(join(d, e.name));
    }
  };
  walk(dir);
  const rows = files
    .map((f) => [relative(dir, f).split(sep).join("/"), f])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const manifest = rows
    .map(([path, f]) => `${createHash("sha256").update(readFileSync(f)).digest("hex")}  ${path}\n`)
    .join("");
  return createHash("sha256").update(manifest).digest("hex");
}

// Compiles input (relative to root, or absolute) and checks the digest against golden.
export function contentProblems(root, { input = fixture, golden = goldenFile, onDigest } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "sharpladder-content-"));
  try {
    const out = join(tmp, "out");
    // The compiler accepts full paths only.
    const r = exec(dotnet, [join(root, compilerDll), resolve(root, schema), resolve(root, input), out], { cwd: root });
    const problems = toolProblems(r, "content compiler");
    if (problems.length > 0) return problems;
    let want;
    try {
      want = readFileSync(resolve(root, golden), "utf8").trim();
    } catch (err) {
      return [`${golden}: ${err.message}`];
    }
    if (!/^[0-9a-f]{64}$/.test(want)) return [`${golden} must hold one lowercase SHA-256 digest`];
    const got = outputDigest(out);
    onDigest?.(got);
    // Two independent computations of one digest must agree, or neither can be trusted.
    const printed = /output digest sha256:([0-9a-f]{64})/.exec(r.out)?.[1];
    if (printed !== got) return [`compiler digest ${String(printed)} differs from the stage digest ${got}`];
    return got === want ? [] : [`output digest ${got} differs from ${golden} (${want})`];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// The commit that first published the alias record. Every history judged here descends from
// it, and it is written out in full so no commit that lacks the record can take its place.
export const firstBase = "e69f0c7595c482ce73b93aaa9d4a95f0479c9a1f";
export const aliasRecord = "web/compiled/aliases.json";

// Replacement objects and the commit-graph cache are local state that could show another
// history, and a hook or caller may have left variables that route git to another repository;
// none of them reaches these reads. Output stays bytes: the record is compared exactly as stored.
function git(tree, args) {
  const own = Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"));
  const r = spawnSync("git", ["--no-replace-objects", "-c", "core.commitGraph=false", ...args], {
    cwd: tree,
    env: { ...Object.fromEntries(own), GIT_NO_REPLACE_OBJECTS: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = (b) => (b ?? Buffer.alloc(0)).toString("utf8").trim();
  return { ok: r.status === 0, out: r.stdout ?? Buffer.alloc(0), why: r.error ? r.error.message : text(r.stderr) };
}

const objectName = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// Where one commit keeps the alias record: null when it holds none.
function blobAt(tree, commit) {
  const listed = git(tree, ["ls-tree", "-z", commit, "--", aliasRecord]);
  if (!listed.ok) return { problem: `commit ${commit} cannot be listed: ${listed.why}` };
  const entry = listed.out.toString("utf8");
  if (entry === "") return null;
  const match = /^100644 blob ([0-9a-f]+)\t([^\0]+)\0$/.exec(entry);
  if (!match || match[2] !== aliasRecord || !objectName.test(match[1]))
    return { problem: `commit ${commit} holds ${aliasRecord} as something other than one plain file` };
  return { blob: match[1] };
}

// HEAD and every commit it reaches that first does not, then first itself: side branches that
// were merged are part of it, and history before first is not.
function history(tree, commit, first) {
  if (!objectName.test(first)) return { problem: `${first} is not a full commit name` };
  // A shallow clone would end the walk early and look complete.
  const shallow = git(tree, ["rev-parse", "--is-shallow-repository"]);
  if (!shallow.ok || shallow.out.toString("utf8").trim() !== "false")
    return { problem: "the repository is shallow; alias retention reads the complete history, so fetch all of it" };
  // A grafts file rewrites parents the way a replacement object does, and no option turns it off.
  const grafts = git(tree, ["rev-parse", "--git-path", "info/grafts"]);
  if (!grafts.ok || existsSync(resolve(tree, grafts.out.toString("utf8").trim())))
    return { problem: "the repository has a grafts file; alias retention reads the history as it was written" };
  if (commit === first) return { commits: [commit] };
  if (!git(tree, ["cat-file", "-e", `${first}^{commit}`]).ok)
    return { problem: `commit ${first} is not in this repository` };
  if (!git(tree, ["merge-base", "--is-ancestor", first, commit]).ok)
    return { problem: `commit ${first} is not an ancestor of HEAD; alias retention starts from it` };
  const listed = git(tree, ["rev-list", "--topo-order", `${first}..${commit}`]);
  const names = listed.out.toString("utf8").split("\n").filter((line) => line !== "");
  if (!listed.ok || names[0] !== commit || names.some((name) => !objectName.test(name)))
    return { problem: `the history from ${first} cannot be listed: ${listed.why}` };
  return { commits: [...names, first] };
}

/**
 * What the alias record in tree fails to keep from its history. The working record is judged
 * against every distinct record held by HEAD or any commit HEAD reaches back to first, so a
 * name retired in any of them is kept for good, whether the commits were pushed one at a time
 * or together; that includes a name added in one commit and removed in the next, and every
 * name on a merged side branch. No commit read may lack the record, and first, which must be
 * HEAD or an ancestor of HEAD, is among them; history before it is not read. The rule
 * holds across any number of steps, so comparing with each record directly asks no more of an
 * honest history than comparing step by step.
 */
export function retentionProblems(root, { tree = root, first = firstBase } = {}) {
  // The history read must be the one that holds the record being judged.
  const top = git(tree, ["rev-parse", "--show-toplevel"]);
  let same = false;
  try {
    same = top.ok && realpathSync.native(top.out.toString("utf8").trim()) === realpathSync.native(tree);
  } catch {
    same = false;
  }
  if (!same) return [`${tree} is not the top of a git working tree${top.why ? `: ${top.why}` : ""}`];
  const head = git(tree, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const commit = head.out.toString("utf8").trim();
  if (!head.ok || !objectName.test(commit)) return [`no commit to compare with: ${head.why}`];
  const range = history(tree, commit, first);
  if (range.problem) return [range.problem];
  const problems = [];
  // Most commits leave the record alone, so each distinct record is judged once, under the
  // newest commit that holds it.
  const records = new Map();
  for (const base of range.commits) {
    const at = blobAt(tree, base);
    if (at === null) problems.push(`commit ${base} holds no ${aliasRecord}; every commit from ${first} on holds it`);
    else if (at.problem) problems.push(at.problem);
    else if (!records.has(at.blob)) records.set(at.blob, base);
  }
  for (const [blob, base] of records) {
    const stored = git(tree, ["cat-file", "blob", blob]);
    if (!stored.ok) {
      problems.push(`commit ${base}: ${aliasRecord} cannot be read: ${stored.why}`);
      continue;
    }
    const args = [join(root, compilerDll), "retain", resolve(root, schema), resolve(tree, "web/compiled")];
    const r = exec(dotnet, args, { cwd: root, input: stored.out });
    const found = toolProblems(r, "content retain");
    if (found.length > 0) problems.push(`against commit ${base}:`, ...found);
  }
  return problems;
}

// built is the .NET build state from csharpChecks: empty when the build passed.
export function contentChecks(root, built) {
  report("content", built.length > 0 ? built : contentProblems(root));
  report("alias retention", built.length > 0 ? built : retentionProblems(root));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? process.cwd();
  let built = ["needs .NET config (see above)"];
  if (dotnetChecks(root)) {
    const build = exec(dotnet, ["build", project, "-nologo"], { cwd: root });
    built = build.code === 0 ? [] : ["content compiler build failed", build.out];
  }
  report(
    "content",
    built.length > 0
      ? built
      : contentProblems(root, { onDigest: (d) => console.log(`content output digest sha256:${d}`) }),
  );
  report("alias retention", built.length > 0 ? built : retentionProblems(root));
  process.exitCode = anyFailed() ? 1 : 0;
}
