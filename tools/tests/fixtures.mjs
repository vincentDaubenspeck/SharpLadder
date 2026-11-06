// Usage: node tools/tests/fixtures.mjs <dir>
// Prints one manifest line per case: language, pass or fail, file, label (tab separated).
// Directive text is assembled here so no tracked file carries a live directive.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.argv[2];
const cases = [];
function add(lang, want, file, label, text) {
  mkdirSync(dirname(join(dir, lang, file)), { recursive: true });
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

// C#, through tools/SharpLadder.Policy, run by tools/tests/csharp-cases.mjs; the fifth column
// is the start of the expected problem. Each case is its own project in one solution, because
// the check reads real project compilations.
const csProjects = [];
function cs(want, file, label, text, problem = "", items = "") {
  const stem = file.replace(/\.cs$/, "");
  add("cs", want, `${stem}/${file}`, label, text);
  cases[cases.length - 1] += `\t${problem}`;
  const project = `${stem}/Fx.${stem}.csproj`;
  writeFileSync(
    join(dir, "cs", project),
    `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n` +
      `  </PropertyGroup>\n${items}</Project>\n`,
  );
  csProjects.push(project);
}
const pw = ["#pragma", "warning"].join(" ");
const sma = ["Suppress", "Message"].join("");
const rec = (id) => `AnalyzerPolicy ${id}: fixture reason | Scope: this file | Guard: fixture | Decision: off`;
const ns = "System.Diagnostics.CodeAnalysis";
const cls = (attr, body = "") => `namespace Fixture;\n\n${attr}\ninternal sealed class C\n{\n${body}}\n`;
const pragma = (id, code = id) => `${pw} disable ${code} // ${rec(id)}\n${pw} restore ${code}\n`;
cs("pass", "good.cs", "records on a pragma and an attribute", `using ${ns};\n\n` +
  cls(`[${sma}("Style", "SA1600:Doc", Justification = "${rec("SA1600")}")]`, pragma("CA1822")));
cs("pass", "numeric.cs", "numeric pragma ID read as CS plus four digits", cls("", pragma("CS1591", "1591")));
cs("pass", "alias.cs", "alias with a record", `using SM = ${ns}.${sma}Attribute;\n\n` +
  cls(`[SM("Style", "SA1600", Justification = "${rec("SA1600")}")]`));
cs("fail", "alias-missing.cs", "alias without a Justification", `using SM = ${ns}.${sma}Attribute;\n\n` +
  cls(`[SM("Style", "SA1600")]`), "suppression attribute needs a Justification");
cs("fail", "global.cs", "global:: qualified name", cls(`[global::${ns}.${sma}("Style", "SA1600")]`),
  "suppression attribute needs a Justification");
cs("fail", "short.cs", "short name", `using ${ns};\n\n` + cls(`[${sma}("Style", "SA1600")]`),
  "suppression attribute needs a Justification");
cs("fail", "suffix.cs", "short name with the Attribute suffix", `using ${ns};\n\n` +
  cls(`[${sma}Attribute("Style", "SA1600", Justification = "not a record")]`), "malformed record");
cs("fail", "unconditional.cs", "unconditional attribute", cls(`[${ns}.Unconditional${sma}("Trim", "IL2026")]`),
  "suppression attribute needs a Justification");
cs("fail", "assembly.cs", "assembly-level attribute", `[assembly: ${ns}.${sma}("Style", "SA1600")]\n`,
  "suppression attribute needs a Justification");
cs("fail", "mismatch.cs", "record for another ID", cls(`[${ns}.${sma}("Style", "SA1601", Justification = "${rec("SA1600")}")]`),
  "record ID SA1600 does not match SA1601");
cs("pass", "lookalike.cs", "look-alike type in another namespace",
  `namespace Other\n{\n    internal sealed class ${sma}Attribute(string a, string b) : System.Attribute\n    {\n` +
  `        public string Pair { get; } = a + b;\n    }\n}\n\n[Other.${sma}("Style", "SA1600")]\ninternal sealed class C\n{\n}\n`);
cs("fail", "no-record.cs", "pragma without a record", cls("", `${pw} disable CA1822\n${pw} restore CA1822\n`),
  "suppression of CA1822 needs an AnalyzerPolicy record");
cs("fail", "duplicate.cs", "duplicate disable", cls("", `${pw} disable CA1822 // ${rec("CA1822")}\n` + pragma("CA1822")),
  "second disable of CA1822");
cs("fail", "restore-first.cs", "restore before disable", cls("", `${pw} restore CA1822\n${pw} disable CA1822 // ${rec("CA1822")}\n`),
  "restore of CA1822 with no open disable");
cs("fail", "restore-only.cs", "restore with no disable", cls("", `${pw} restore CA1822\n`),
  "restore of CA1822 with no open disable");
cs("fail", "no-restore.cs", "missing restore", cls("", `${pw} disable CA1822 // ${rec("CA1822")}\n`),
  "disable of CA1822 has no later restore");
cs("fail", "bare-disable.cs", "bare disable", cls("", `${pw} disable\n`), "bare pragma disable");
cs("fail", "bare-restore.cs", "bare restore", cls("", `${pw} restore\n`), "bare pragma restore");
cs("fail", "two-ids.cs", "disable naming two IDs", cls("", `${pw} disable CA1822, CA1823 // ${rec("CA1822")}\n`),
  "pragma disable must name exactly one ID");
cs("fail", "if-false.cs", "#if false block", cls("", "#if false\n    private int unused;\n#endif\n"),
  "inactive conditional text");
cs("fail", "global-using.cs", "short name through a project global using", cls(`[${sma}("Style", "CA1822")]`),
  "suppression attribute needs a Justification", `  <ItemGroup>\n    <Using Include="${ns}" />\n  </ItemGroup>\n`);
cs("fail", "unbound.cs", "attribute whose type does not bind", cls(`[Missing.Quiet("Style", "CA1822")]`),
  "attribute Missing.Quiet does not bind");
const repo = join(import.meta.dirname, "..", "..");
for (const f of ["global.json", "nuget.config"]) copyFileSync(join(repo, f), join(dir, "cs", f));
writeFileSync(
  join(dir, "cs", "Fixtures.slnx"),
  `<Solution>\n${csProjects.map((p) => `  <Project Path="${p}" />\n`).join("")}</Solution>\n`,
);

// Files for web/ in the propagation repository: a disallowed package, and a script that defers
// to the tracked one, because licensee is installed only beside the tracked script.
const prop = join(dir, "prop", "web");
pkg(join(prop, "node_modules", gpl[0]), gpl[0], gpl[1]);
const script = pathToFileURL(join(import.meta.dirname, "..", "..", "web", "license-check.js"));
writeFileSync(join(prop, "license-check.js"), `import ${JSON.stringify(script.href)};\n`);

console.log(cases.join("\n"));
