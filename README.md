# SharpLadder

A C# study site for fundamentals, reference and practice problems, with hints
for when you get stuck mid-problem.

## Status

In development; not yet live.

## Stack

React, TypeScript and Vite; ASP.NET Core on .NET 10; Playwright; WebAssembly.

## Local setup

After cloning, enable the repository's git hooks:

```sh
git config core.hooksPath tools/hooks
```

## Development

The web app lives in `web/`; run `npm ci` and `npm run dev` there.

The checks need these tools, at exactly these versions (pins and the
publishers' SHA-256 or SHA-512 digests in `tools/tool-pins.json`):

- Node 26.13.0 (`web/.nvmrc`) with its bundled npm 11.20.0
  (`packageManager` in `web/package.json`), then `npm ci` in `web/`
- shfmt 3.14.1, editorconfig-checker 4.0.2 and ShellCheck 0.11.0
- yamllint 1.38.0 (Python 3.10 or later; installed from
  `tools/requirements-yamllint.txt` with hash checking)
- PowerShell with PSScriptAnalyzer 1.25.0
  (`Install-Module PSScriptAnalyzer -RequiredVersion 1.25.0 -Scope CurrentUser`)
- .NET SDK 10.0.403, pinned in `global.json` with roll-forward disabled

`node tools/install-tools.mjs` downloads Node, shfmt, editorconfig-checker,
ShellCheck, the CycloneDX CLI 0.33.1 and the .NET SDK into `.tools/`, verifies
each against its pinned digest, and sets up yamllint in `.tools/venv`. yamllint
(GPL-3.0-or-later) and its dependency pathspec (MPL-2.0) are development tools
only; nothing from them ships.

Run every check with one command:

```sh
sh tools/check.sh
```

(`powershell -File tools/check.ps1` on Windows runs the same checks.) A
missing or wrong-version tool fails the check with install guidance.

The licence allowlist check (`npm run license:check` in `web/`, also part of
the full check) runs licensee over every installed package, development
dependencies included, and fails on any licence outside the allowlist in
`web/.licensee.json`. Exceptions are listed there by exact version under
`packages`, each with a one-line reason under `reasons`; the check fails on an
exception without a reason or a reason without an exception. CI also produces a
CycloneDX SBOM of the full npm inventory, validates it with the CycloneDX CLI
and keeps it as a build artifact for 14 days.

The .NET build settings live in `Directory.Build.props`, analyzer versions in
`Directory.Packages.props` (central package management), rule severities in
`.globalconfig` and banned APIs in `BannedSymbols.txt`. Until the first C#
project exists, the check evaluates these files and the test suites build a
throwaway probe project against them.

OpenSSF Scorecard runs weekly and on every push to `main`.

## Licence

- Code: the original application code and theme CSS are licensed under the
  PolyForm Noncommercial License 1.0.0 (see `LICENSE`). It is source-available,
  not open source: use, modification and redistribution are permitted only for
  the noncommercial purposes the licence lists.
- Brand: the SharpLadder name and the ladder mark are not covered by the code
  licence; no trademark permission is granted.
- Third-party dependencies keep their own licences.

Required notice (see `NOTICE`):

Required Notice: Copyright Vincent Daubenspeck (sharpladder.com)

## Contributing

Issues are welcome. Outside code or content contributions need written terms
first, so pull requests are not accepted yet.

## Security

See `SECURITY.md` for how to report a vulnerability privately.
