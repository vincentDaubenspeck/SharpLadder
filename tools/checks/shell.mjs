// Shell checks: shfmt format, suppression reasons from the shfmt syntax tree, ShellCheck.
// Usage: node tools/checks/shell.mjs [file...]   (default: every tracked shell file)
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { anyFailed, exec, execBatched, gitFiles, pins, report, toolProblem } from "./lib.mjs";

// Every Comment node in the typed JSON tree carries Hash and Text.
function collectComments(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) collectComments(n, out);
  } else if (node && typeof node === "object") {
    if (typeof node.Text === "string" && node.Hash) out.push(node);
    for (const v of Object.values(node)) collectComments(v, out);
  }
  return out;
}

// A directive, by the prefix rule of the pinned ShellCheck 0.11.0 (readAnnotation in its
// Parser.hs); its fields are never read, so no value can hide where a reason starts.
const directive = /^[ \t\u00a0\u2002-\u2009\u200b\u202f]*shellcheck[ \t\u00a0\u2002-\u2009\u200b\u202f]/u;

function suppressionProblems(file) {
  const src = readFileSync(file);
  const r = exec("shfmt", ["--to-json", "--filename", file], { input: src });
  if (r.code !== 0) return [`${file}: parse error: ${r.out.trim()}`];
  // The shebang parses as a comment but explains nothing.
  const comments = collectComments(JSON.parse(r.out), [])
    .filter((c) => !(c.Hash.Offset === 0 && c.Text.startsWith("!")))
    .sort((a, b) => a.Hash.Offset - b.Hash.Offset);
  const standalone = (c) => {
    const start = src.lastIndexOf(10, c.Hash.Offset - 1) + 1;
    return src.subarray(start, c.Hash.Offset).toString("utf8").trim() === "";
  };
  const problems = [];
  comments.forEach((c, i) => {
    if (!directive.test(c.Text)) return;
    const prev = comments[i - 1];
    const explained =
      prev !== undefined &&
      prev.Hash.Line === c.Hash.Line - 1 &&
      standalone(prev) &&
      prev.Text.trim() !== "" &&
      !directive.test(prev.Text);
    if (!explained) {
      problems.push(`${file}:${c.Hash.Line}: shellcheck directive needs a reason comment on the line above`);
    }
  });
  return problems;
}

// A discovery problem fails every stage; a missing tool is named instead, as the more useful cause.
export function shellChecks({ files, problem }) {
  const shfmt = toolProblem("shfmt", ["--version"], /v?(\d+\.\d+\.\d+)/, pins.shfmt.version) ?? problem;
  if (shfmt) {
    report("shell format (shfmt)", [shfmt]);
    report("shell suppression reasons", [shfmt]);
  } else {
    const d = execBatched("shfmt", ["-d"], files);
    report("shell format (shfmt)", d.code === 0 ? [] : [d.out]);
    report("shell suppression reasons", files.flatMap(suppressionProblems));
  }
  const sc =
    toolProblem("shellcheck", ["--version"], /version: (\d+\.\d+\.\d+)/, pins.shellcheck.version) ?? problem;
  if (sc) report("ShellCheck", [sc]);
  else {
    const s = execBatched("shellcheck", ["--norc"], files);
    report("ShellCheck", s.code === 0 ? [] : [s.out]);
  }
}

// Shell files among the tracked files, as shfmt detects them (extension or shebang). A failed
// discovery is a problem for the shell stages, never an empty list they would pass.
export function trackedShellFiles(root) {
  const tracked = gitFiles(root, []);
  const r = execBatched("shfmt", ["-f"], tracked, { cwd: root });
  if (r.code !== 0) {
    const why = (r.error ?? r.stderr.trim()) || `exit ${String(r.code)}`;
    return { problem: `shell file discovery (shfmt -f) failed: ${why}` };
  }
  const files = r.out.split(/\r?\n/).filter((f) => f !== "");
  if (files.length === 0 && tracked.some((f) => /\.(sh|bash)$/.test(f))) {
    return { problem: "shell file discovery (shfmt -f) found no shell file, but .sh or .bash files are tracked" };
  }
  return { files };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  shellChecks(files.length > 0 ? { files } : trackedShellFiles(process.cwd()));
  process.exitCode = anyFailed() ? 1 : 0;
}
