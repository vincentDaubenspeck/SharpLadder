// Usage: node tools/tests/fixtures.mjs <dir>
// Prints one manifest line per case: language, pass or fail, file, label (tab separated).
// Directive text is assembled here so no tracked file carries a live directive.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
const cases = [];
function add(lang, want, file, label, text) {
  mkdirSync(join(dir, lang), { recursive: true });
  writeFileSync(join(dir, lang, file), text);
  cases.push([lang, want, file, label].join("\t"));
}

// JavaScript and TypeScript, through web/lint-comments.js.
const next = ["eslint", "disable", "next", "line"].join("-");
const off = ["eslint", "disable"].join("-");
const use = "console.log(1);\n";
add("js", "pass", "good.js", "good reason", `// ${next} no-console -- reason here\n${use}`);
add("js", "fail", "missing.js", "missing reason", `// ${next} no-console\n${use}`);
add("js", "fail", "blank.js", "blank reason", `// ${next} no-console --   \n${use}`);
add("js", "fail", "multi.ts", "multi-line reason", `/* ${next} no-console --\n   on the next line */\n${use}`);
add(
  "js",
  "pass",
  "lookalike.ts",
  "directive inside strings",
  `const s = "// ${next} no-console";\nconst t = \`/* ${off} */\`;\nexport { s, t };\n`,
);
add(
  "js",
  "fail",
  "self-off.js",
  "policy self-disable attempt",
  `/* ${off} @eslint-community/eslint-comments/require-description, local/directive-single-line -- off */\n` +
    `// ${next} no-console\n${use}`,
);

// Shell, through tools/checks/shell.mjs.
const sc = ["shell", "check"].join("");
const sh = (body) => `#!/bin/sh\n${body}`;
const why = "# Set for the caller.\n";
add("sh", "pass", "above.sh", "reason on the line above", sh(`${why}# ${sc} disable=SC2034\nx=1\n`));
add("sh", "fail", "missing.sh", "no comment above", sh(`# ${sc} disable=SC2034\nx=1\n`));
add("sh", "fail", "trailing.sh", "trailing reason only", sh(`# ${sc} disable=SC2034 # set for the caller\nx=1\n`));
add("sh", "fail", "gap.sh", "blank line between reason and directive", sh(`${why}\n# ${sc} disable=SC2034\nx=1\n`));
add("sh", "fail", "blank.sh", "blank comment above", sh(`#\n# ${sc} disable=SC2034\nx=1\n`));
add("sh", "fail", "code.sh", "reason after code on the line above", sh(`y=1 # set for the caller\n# ${sc} disable=SC2034\nx=1\n`));
add(
  "sh",
  "fail",
  "stacked.sh",
  "line above is another directive",
  sh(`${why}# ${sc} disable=SC2154\n# ${sc} disable=SC2034\nx=1\n`),
);
add("sh", "fail", "first.sh", "directive on line 1", `# ${sc} disable=SC2034\nx=1\n`);
add("sh", "fail", "source.sh", "any directive kind needs a reason", sh(`# ${sc} source=/dev/null\n. "$1"\n`));
add(
  "sh",
  "pass",
  "fields.sh",
  "fields are not read",
  sh(`# Path comes from the caller.\n# ${sc} source="a#b" disable=SC1090\n. "$1"\n`),
);
add(
  "sh",
  "pass",
  "lookalike.sh",
  "directive inside a string and a heredoc",
  sh(`echo "# ${sc} disable=SC2034"\ncat << EOF\n# ${sc} disable=SC2034\nEOF\n`),
);
add(
  "sh",
  "fail",
  "self-off.sh",
  "policy self-disable attempt",
  sh(`# ${sc} disable=all\n# ${sc} disable=SC2034\nx=1\n`),
);

// PowerShell, through tools/checks/ps-suppressions.ps1.
const sm = ["Suppress", "Message"].join("");
const ps = (attr) => `function Test-Fixture {\n  ${attr}\n  param()\n  'ok'\n}\n`;
const full = `System.Diagnostics.CodeAnalysis.${sm}Attribute`;
add("ps", "pass", "good.ps1", "good reason", ps(`[${full}('PSAvoidUsingWriteHost', '', Justification = 'Console tool.')]`));
add("ps", "fail", "missing.ps1", "missing reason", ps(`[${full}('PSAvoidUsingWriteHost', '')]`));
add("ps", "fail", "blank.ps1", "blank reason", ps(`[${full}('PSAvoidUsingWriteHost', '', Justification = '  ')]`));
add(
  "ps",
  "fail",
  "multi.ps1",
  "multi-line reason",
  ps(`[${full}('PSAvoidUsingWriteHost', '', Justification = @'\nfirst line\nsecond line\n'@)]`),
);
add(
  "ps",
  "fail",
  "variable.ps1",
  "reason not a literal",
  ps(`[${full}('PSAvoidUsingWriteHost', '', Justification = "$why")]`),
);
add(
  "ps",
  "pass",
  "lookalike.ps1",
  "attribute inside strings",
  `$a = "[${sm}('PSAvoidUsingWriteHost', '')]"\n$b = @'\n[${full}('X', '')]\n'@\n# [${sm}('X', '')]\n`,
);
add(
  "ps",
  "fail",
  "self-off.ps1",
  "policy self-disable attempt",
  ps(
    `[${full}('PowerShellSuppressionReasons', '', Justification = 'Off.')]\n  [${full}('PSAvoidUsingWriteHost', '')]`,
  ),
);
add("ps", "fail", "parse.ps1", "parse error", "function Broken {\n");
for (const [file, name, prefix] of [
  ["alias-full.ps1", `System.Diagnostics.CodeAnalysis.${sm}`, ""],
  ["alias-short.ps1", `Diagnostics.CodeAnalysis.${sm}`, ""],
  ["alias-using.ps1", `${sm}Attribute`, "using namespace System.Diagnostics.CodeAnalysis\n"],
  ["alias-using-short.ps1", sm, "using namespace System.Diagnostics.CodeAnalysis\n"],
]) {
  add("ps", "fail", file, `alias ${name} without a reason`, prefix + ps(`[${name}('PSAvoidUsingWriteHost', '')]`));
}
for (const [file, label, prefix, name] of [
  ["other-bare.ps1", "bare name with no using namespace", "", sm],
  ["other-namespace.ps1", "another namespace", "", `Other.${sm}`],
  ["other-class.ps1", "a local class of the same name", `using namespace LocalPolicy\nclass ${sm}Attribute : System.Attribute {}\n`, sm],
]) {
  add("ps", "pass", file, `not the framework attribute: ${label}`, prefix + ps(`[${name}()]`));
}

// Licence allowlist, through web/license-check.js run in each case directory.
function pkg(dir, name, license) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name, version: "1.0.0", license })}\n`);
}
function lic(want, file, label, installed, packages, reasons) {
  const d = join(dir, "lic", file);
  pkg(d, `case-${file}`, "MIT");
  pkg(join(d, "node_modules", installed[0]), installed[0], installed[1]);
  const config = { licenses: { spdx: ["MIT"] }, packages, reasons };
  writeFileSync(join(d, ".licensee.json"), `${JSON.stringify(config, null, 2)}\n`);
  cases.push(["lic", want, file, label].join("\t"));
}
const gpl = ["fx-gpl", "MIT AND GPL-3.0-only"];
const why1 = { "fx-gpl@1.0.0": "Test fixture; not shipped." };
lic("pass", "approved", "allowed licence", ["fx-mit", "MIT"], {}, {});
lic("fail", "disallowed", "disallowed licence", gpl, {}, {});
lic("pass", "excepted", "exception with a reason", gpl, { "fx-gpl": "1.0.0" }, why1);
lic("fail", "no-reason", "exception without a reason", gpl, { "fx-gpl": "1.0.0" }, {});
lic("fail", "blank-reason", "blank reason", gpl, { "fx-gpl": "1.0.0" }, { "fx-gpl@1.0.0": " " });
for (const [file, label, end] of [
  ["lf-reason", "multi-line reason (LF)", "\n"],
  ["cr-reason", "multi-line reason (CR)", "\r"],
]) {
  lic("fail", file, label, gpl, { "fx-gpl": "1.0.0" }, { "fx-gpl@1.0.0": `First line.${end}Second line.` });
}
lic("fail", "orphan", "reason without an exception", ["fx-mit", "MIT"], {}, why1);
lic("fail", "other-version", "exception for another version", gpl, { "fx-gpl": "2.0.0" }, {
  "fx-gpl@2.0.0": "Test fixture; not shipped.",
});
lic("fail", "range", "exception for a version range", gpl, { "fx-gpl": "^1.0.0" }, {
  "fx-gpl@^1.0.0": "Test fixture; not shipped.",
});

// Files for web/ in the propagation repository: a disallowed package, and a script that defers
// to the tracked one, because licensee is installed only beside the tracked script.
const prop = join(dir, "prop", "web");
pkg(join(prop, "node_modules", gpl[0]), gpl[0], gpl[1]);
const script = pathToFileURL(join(import.meta.dirname, "..", "..", "web", "license-check.js"));
writeFileSync(join(prop, "license-check.js"), `import ${JSON.stringify(script.href)};\n`);

console.log(cases.join("\n"));
