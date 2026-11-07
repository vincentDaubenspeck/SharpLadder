// The content stage: compiles the fixture chapter with tools/SharpLadder.Content and compares
// the digest of its output with the committed golden value, so a change in the compiler's
// output, on any OS, fails until the golden value is reviewed and updated.
// Usage: node tools/checks/content.mjs [repository root]   (builds the compiler first)
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { dotnetChecks } from "./dotnet.mjs";
import { anyFailed, dotnet, exec, report, toolProblems } from "./lib.mjs";

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

// built is the .NET build state from csharpChecks: empty when the build passed.
export function contentChecks(root, built) {
  report("content", built.length > 0 ? built : contentProblems(root));
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
  process.exitCode = anyFailed() ? 1 : 0;
}
