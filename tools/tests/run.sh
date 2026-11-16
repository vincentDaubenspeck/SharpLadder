#!/bin/sh
# Tests for the commit-msg hook and the repository checks.
# Builds a throwaway git repository, installs the tracked hooks there and checks:
#   a. Bad commit subjects are rejected by tools/hooks/commit-msg
#   b. Good commit subjects pass
#   c. CRLF line endings and a missing final newline fail the encoding check; lock files and
#      asset licence texts (web/assets/licences/<id>/OFL.txt) are exempt; .ttf and .woff2 are binary
#   d. Suppression-reason fixtures from tools/tests/fixtures.mjs, per language
#   e. Missing tools fail and failures reach check.sh; pre-push blocks unless the working tree is clean
#   f. Licence allowlist and override record cases, and a disallowed licence through check.sh
#   g. .NET config: SDK pin, props evaluation, digest cases and the probe build
#   h. C# cases (tools/tests/csharp-cases.mjs): suppression fixtures, nuget vulnerabilities and licences, no SDK
#   i. npm audit cases (tools/tests/npm-audit-cases.mjs): a low-severity advisory fails the audit;
#      the check run's npm audit stage fails closed
#   j. Content cases (tools/tests/content-cases.mjs): golden digest, compile errors, empty input,
#      full-path arguments, output containment, no partial output, schema setup errors, no SDK
#   k. Asset licence cases (tools/tests/asset-licence-cases.mjs): a repeated JSON key fails closed
#   l. PSScriptAnalyzer installer cases (tools/tests/pssa-cases.mjs): a wrong checksum is rejected before extraction
#   m. Browser provisioning cases (tools/tests/browser-cases.mjs): unverified archives are never extracted or launched
#   n. Linux check cases (tools/tests/check-linux-cases.sh): input identity and image selection, stand-in docker
#   o. Flake check cases (tools/tests/flake-check-cases.mjs): refusals, prior chains and selection, stand-in build and Playwright
# Usage: sh tools/tests/run.sh
# Parts g, h and j need the pinned .NET SDK and nuget.org. The PowerShell cases in parts d and e fail without PowerShell.
set -eu

started=$(date +%s)
src=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Keep the user's and the system's git configuration out of the test.
: > "$tmp/gitconfig"
GIT_CONFIG_GLOBAL=$tmp/gitconfig
GIT_CONFIG_NOSYSTEM=1
GIT_AUTHOR_NAME=Test
GIT_AUTHOR_EMAIL=test@example.invalid
GIT_COMMITTER_NAME=Test
GIT_COMMITTER_EMAIL=test@example.invalid
export GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL
export GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

passed=0
failed=0
pass() {
  echo "PASS $1"
  passed=$((passed + 1))
}
fail() {
  echo "FAIL $1"
  failed=$((failed + 1))
}

ps=
for c in pwsh powershell.exe; do
  if command -v "$c" > /dev/null 2>&1; then
    ps=$c
    break
  fi
done

# PATH entries must be POSIX paths; Git for Windows reports C:/ paths.
to_posix() {
  if command -v cygpath > /dev/null 2>&1; then cygpath -u "$1"; else printf '%s\n' "$1"; fi
}
# The pinned tools from tools/install-tools.mjs, when installed, go first.
for d in "$src/.tools/venv/bin" "$src/.tools/venv/Scripts" "$src/.tools/node/bin" \
  "$src/.tools/node" "$src/.tools/bin"; do
  if [ -d "$d" ]; then PATH=$(to_posix "$d"):$PATH; fi
done
export PATH
node=$(command -v node || :)

repo=$tmp/repo
mkdir -p "$repo/tools/hooks" "$repo/tools/checks"
cp "$src/.gitattributes" "$repo/"
cp "$src/tools/checks/text.sh" "$repo/tools/checks/"
cp "$src/tools/forbidden-phrases.txt" "$repo/tools/"
cp "$src/tools/hooks/commit-msg" "$repo/tools/hooks/"
chmod +x "$repo/tools/hooks/commit-msg"
printf 'hello\n' > "$repo/notes.txt"
cd "$repo" || exit 1
git init -q .
git config core.hooksPath tools/hooks
git add -A

# try_commit accept|reject <label> <message, printf %b escapes>
try_commit() {
  printf '%b' "$3" > "$tmp/msg"
  if git commit -q --allow-empty -F "$tmp/msg" > /dev/null 2> "$tmp/err"; then
    got=accept
  elif grep -q '^commit-msg:' "$tmp/err"; then
    got=reject
  else
    got="error ($(head -n 1 "$tmp/err"))"
  fi
  if [ "$got" = "$1" ]; then pass "commit $1: $2"; else fail "commit $1: $2 (got $got)"; fi
}

try_commit accept "first commit" 'Add fixture files for the tests\n'
try_commit accept "72 characters" "Add $(printf '%068d' 0)\n"
try_commit reject "73 characters" "Add $(printf '%069d' 0)\n"
try_commit reject "trailing period" 'Add a subject that ends in a period.\n'
try_commit reject "body" 'Add a subject with a body below\n\nThe body line.\n'
try_commit reject "trailer" 'Add a subject with a trailer below\n\nSigned-off-by: Test\n'
try_commit reject "too short" 'Fix it\n'

# run_checks <label> <expected exit code>: runs text.sh, keeping its output for the cases that read it.
run_checks() {
  rc=0
  sh tools/checks/text.sh > "$tmp/out.sh" 2>&1 || rc=$?
  if [ "$rc" -eq "$2" ]; then pass "text.sh $1 (exit $rc)"; else fail "text.sh $1 (exit $rc)"; fi
}

run_checks "clean tree" 0

printf 'one\r\ntwo\r\n' > crlf.txt
git add crlf.txt 2> /dev/null
run_checks "CRLF file" 1
if grep -q '^  crlf.txt: CRLF line endings$' "$tmp/out.sh"; then
  pass "text.sh names the CRLF file"
else
  fail "text.sh names the CRLF file"
fi
git rm -q --cached crlf.txt && rm crlf.txt

printf 'no final newline' > tail.txt
git add tail.txt
run_checks "missing final newline" 1
if grep -q '^  tail.txt: no final newline$' "$tmp/out.sh"; then
  pass "text.sh names the file without a final newline"
else
  fail "text.sh names the file without a final newline"
fi
git rm -q --cached tail.txt && rm tail.txt

# Only a file named exactly packages.lock.json may end without a newline.
mkdir lock
printf '{}' > lock/packages.lock.json
git add lock/packages.lock.json
run_checks "lock file without a final newline" 0
printf '{}' > lock/other.lock.json
git add lock/other.lock.json
run_checks "other name without a final newline" 1
if grep -q '^  lock/other.lock.json: no final newline$' "$tmp/out.sh"; then
  pass "text.sh exempts only packages.lock.json"
else
  fail "text.sh exempts only packages.lock.json"
fi
git rm -q -r --cached lock && rm -r lock

# Only an OFL.txt in an asset licence folder may keep upstream CRLF bytes.
mkdir -p web/assets/licences/sample
printf 'one\r\ntwo\r\n' > web/assets/licences/sample/OFL.txt
git add web/assets/licences/sample/OFL.txt 2> /dev/null
run_checks "verbatim licence text with CRLF" 0
printf 'one\r\ntwo\r\n' > web/assets/licences/sample/NOTES.txt
git add web/assets/licences/sample/NOTES.txt 2> /dev/null
run_checks "other name in the licence folder with CRLF" 1
if grep -q '^  web/assets/licences/sample/NOTES.txt: CRLF line endings$' "$tmp/out.sh"; then
  pass "text.sh exempts only licence-folder OFL.txt"
else
  fail "text.sh exempts only licence-folder OFL.txt"
fi
git rm -q --cached web/assets/licences/sample/NOTES.txt && rm web/assets/licences/sample/NOTES.txt
mkdir -p web/assets/licences/sample/extra
printf 'one\r\ntwo\r\n' > web/assets/licences/sample/extra/OFL.txt
git add web/assets/licences/sample/extra/OFL.txt 2> /dev/null
run_checks "nested licence text with CRLF" 1
if grep -q '^  web/assets/licences/sample/extra/OFL.txt: CRLF line endings$' "$tmp/out.sh" &&
  [ "$(git check-attr text -- web/assets/licences/sample/extra/OFL.txt)" = \
    'web/assets/licences/sample/extra/OFL.txt: text: auto' ]; then
  pass "the licence text exemption covers one folder level only"
else
  fail "the licence text exemption covers one folder level only"
fi
git rm -q -r --cached web && rm -r web

# Font files are binary: CR bytes, invalid UTF-8 and no final newline are not text faults.
mkdir fonts
printf '\000\001\000\000\r\n\377' > fonts/sample.ttf
printf 'wOF2\000\001\r\n\377' > fonts/sample.woff2
git add fonts
run_checks "font files with CR and non-UTF-8 bytes" 0
if [ "$(git check-attr text -- fonts/sample.ttf fonts/sample.woff2)" = "$(printf '%s\n' \
  'fonts/sample.ttf: text: unset' 'fonts/sample.woff2: text: unset')" ]; then
  pass "font files are marked binary"
else
  fail "font files are marked binary"
fi
git rm -q -r --cached fonts && rm -r fonts

# Shell and PowerShell report a named stage; ESLint reports by exit code.
if [ -z "$node" ]; then
  fail "suppression fixtures (no node)"
else
  "$node" "$src/tools/tests/fixtures.mjs" "$tmp/fx" > "$tmp/manifest"
  tab=$(printf '\t')
  while IFS="$tab" read -r lang want file label; do
    # The C# fixtures need a build; tools/tests/csharp-cases.mjs runs them.
    if [ "$lang" = cs ]; then continue; fi
    got=fail
    case "$lang" in
      js)
        if (cd "$tmp/fx/js" && "$node" "$src/web/lint-comments.js" "$file") > "$tmp/fx.out" 2>&1; then
          got=pass
        fi
        ;;
      sh)
        (cd "$tmp/fx/sh" && "$node" "$src/tools/checks/shell.mjs" "$file") > "$tmp/fx.out" 2>&1 || :
        if grep -q '^PASS shell suppression reasons$' "$tmp/fx.out"; then got=pass; fi
        ;;
      lic)
        if (cd "$tmp/fx/lic/$file" && "$node" "$src/web/license-check.js") > "$tmp/fx.out" 2>&1; then
          got=pass
        fi
        ;;
      ovr)
        if (cd "$tmp/fx/ovr/$file" && "$node" "$src/web/dependency-overrides-check.js") > "$tmp/fx.out" 2>&1; then
          got=pass
        fi
        ;;
      ps)
        # Without PowerShell nothing ran, so an expected failure must not count as met.
        if [ -z "$ps" ]; then
          fail "$lang $want: $label (no PowerShell)"
          continue
        fi
        if (cd "$tmp/fx/ps" && "$ps" -NoProfile -ExecutionPolicy Bypass \
          -File "$src/tools/checks/ps-suppressions.ps1" "$file") > "$tmp/fx.out" 2>&1; then
          got=pass
        fi
        ;;
    esac
    if [ "$got" = "$want" ]; then
      pass "$lang $want: $label"
    else
      fail "$lang $want: $label (got $got)"
      cat "$tmp/fx.out"
    fi
  done < "$tmp/manifest"
  if (cd "$src/web" && "$node" license-check.js) > "$tmp/fx.out" 2>&1; then
    pass "lic pass: current tree"
  else
    fail "lic pass: current tree"
    cat "$tmp/fx.out"
  fi
  if (cd "$src/web" && "$node" dependency-overrides-check.js) > "$tmp/fx.out" 2>&1; then
    pass "ovr pass: current tree"
  else
    fail "ovr pass: current tree"
    cat "$tmp/fx.out"
  fi
  for want in pass fail; do
    if [ "$want" = pass ]; then f=good.ps1; else f=missing.ps1; fi
    if [ -z "$ps" ]; then
      fail "ps $want: absolute path to $f (no PowerShell)"
      continue
    fi
    p=$tmp/fx/ps/$f
    if command -v cygpath > /dev/null 2>&1; then p=$(cygpath -w "$p"); fi
    got=fail
    if "$ps" -NoProfile -ExecutionPolicy Bypass -File "$src/tools/checks/ps-suppressions.ps1" \
      "$p" > "$tmp/fx.out" 2>&1; then got=pass; fi
    if [ "$got" = "$want" ]; then
      pass "ps $want: absolute path to $f"
    else
      fail "ps $want: absolute path to $f (got $got)"
      cat "$tmp/fx.out"
    fi
  done
fi

mkdir -p "$repo/web"
cp "$src/tools/check.sh" "$src/tools/tool-pins.json" "$repo/tools/"
cp "$src/tools/checks/lib.mjs" "$src/tools/checks/run.mjs" "$src/tools/checks/shell.mjs" \
  "$src/tools/checks/dotnet.mjs" "$src/tools/checks/csharp.mjs" "$src/tools/checks/content.mjs" \
  "$src/tools/checks/web.mjs" \
  "$src/tools/checks/ps-suppressions.ps1" "$src/tools/checks/pssa.ps1" "$repo/tools/checks/"
cp "$src/web/package.json" "$src/web/.nvmrc" "$src/web/.licensee.json" "$repo/web/"
cp "$src/global.json" "$src/Directory.Build.props" "$src/Directory.Packages.props" "$repo/"
# An unavailable PSScriptAnalyzer version stands in for a missing module.
sed -e 's/"version": "1\.25\.0"/"version": "0.0.0"/' "$src/tools/tool-pins.json" > "$repo/tools/tool-pins.json"
cp "$tmp/fx/sh/missing.sh" "$repo/bad.sh"
cp "$tmp/fx/sh/missing.sh" "$repo/web/x.sh"
git add -A
git commit -q -m 'Add the propagation fixture files'

mkdir "$tmp/empty"
if [ -n "$node" ]; then
  (PATH=$(to_posix "$tmp/empty") "$node" tools/checks/shell.mjs bad.sh) > "$tmp/out" 2>&1 || :
  if grep -q '^  shfmt not found' "$tmp/out" && grep -q '^FAIL shell suppression reasons$' "$tmp/out"; then
    pass "missing shfmt fails"
  else
    fail "missing shfmt fails"
    cat "$tmp/out"
  fi
  # This repository has no .tools, so an empty PATH leaves no SDK at all.
  (PATH=$(to_posix "$tmp/empty") "$node" tools/checks/dotnet.mjs) > "$tmp/out" 2>&1 || :
  if grep -qxF '  dotnet not found; install the pinned tools with: node tools/install-tools.mjs' \
    "$tmp/out" && grep -qxF 'FAIL .NET config' "$tmp/out"; then
    pass "missing .NET SDK fails"
  else
    fail "missing .NET SDK fails"
    cat "$tmp/out"
  fi
fi
sed -e 's/"10\.0\.404"/"10.0.402"/' "$src/global.json" > global.json

rc=0
sh tools/check.sh > "$tmp/out" 2>&1 || rc=$?
for want in 'FAIL shell suppression reasons' '  web/node_modules not found; run npm ci in web/' \
  '  global.json SDK 10.0.402 differs from tools/tool-pins.json 10.0.404' \
  '  PSScriptAnalyzer 0.0.0 not found; install it with:' \
  '  web/x.sh:2: shellcheck directive needs a reason comment on the line above' \
  '  needs .NET config (see above)' 'FAIL nuget vulnerabilities' 'FAIL nuget licences'; do
  if [ "$rc" -ne 0 ] && grep -qxF "$want" "$tmp/out"; then
    pass "check.sh exit $rc with: $want"
  else
    fail "check.sh exit $rc with: $want"
  fi
done

# pre-push gets its own repository, whose tree this part alone makes clean or dirty.
hook=$tmp/hook
mkdir -p "$hook/tools/hooks" "$tmp/stand-in"
cp "$src/tools/hooks/pre-push" "$hook/tools/hooks/"
printf 'hello\n' > "$hook/notes.txt"
(cd "$hook" && git init -q . && git add -A && git commit -q -m 'Add the pre-push fixture files')
cat > "$tmp/stand-in/git" << 'EOF'
#!/bin/sh
for a in "$@"; do
  [ "$a" != status ] || exit 128
done
exec "$REAL_GIT" "$@"
EOF
chmod +x "$tmp/stand-in/git"
real_git=$(command -v git)

rc=0
(cd "$hook" && sh tools/hooks/pre-push) > "$tmp/out" 2> "$tmp/err" || rc=$?
if [ "$rc" -eq 0 ]; then
  pass "pre-push passes a clean tree"
else
  fail "pre-push passes a clean tree (exit $rc)"
  cat "$tmp/out" "$tmp/err"
fi
# The tree is still clean, so a hook that read the failed status as empty would pass it.
rc=0
(cd "$hook" && REAL_GIT=$real_git PATH="$tmp/stand-in:$PATH" sh tools/hooks/pre-push) > "$tmp/out" 2> "$tmp/err" || rc=$?
if [ "$rc" -ne 0 ] && [ ! -s "$tmp/out" ] &&
  [ "$(cat "$tmp/err")" = 'pre-push: git status failed; push blocked' ]; then
  pass "pre-push blocks when git status fails (exit $rc)"
else
  fail "pre-push blocks when git status fails (exit $rc)"
  cat "$tmp/out" "$tmp/err"
fi
printf 'changed\n' > "$hook/notes.txt"
rc=0
(cd "$hook" && sh tools/hooks/pre-push) > "$tmp/out" 2> "$tmp/err" || rc=$?
if [ "$rc" -ne 0 ] && [ ! -s "$tmp/out" ] &&
  [ "$(cat "$tmp/err")" = 'pre-push: working tree is not clean; push blocked' ]; then
  pass "pre-push blocks a changed tracked file (exit $rc)"
else
  fail "pre-push blocks a changed tracked file (exit $rc)"
  cat "$tmp/out" "$tmp/err"
fi

# With web/node_modules present the web stages run, so a disallowed licence reaches check.sh.
if [ -n "$node" ]; then
  cp -R "$tmp/fx/prop/." "$repo/"
  rc=0
  sh tools/check.sh > "$tmp/out" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ] && grep -qxF 'FAIL licence allowlist' "$tmp/out" && grep -qxF '  fx-gpl@1.0.0' "$tmp/out"; then
    pass "check.sh fails a disallowed licence (exit $rc)"
  else
    fail "check.sh fails a disallowed licence (exit $rc)"
    cat "$tmp/out"
  fi
fi

# count_lines <label> <exit code> <output file>: adds a Node case script's PASS and FAIL lines.
count_lines() {
  p=$(grep -c '^PASS ' "$3" || :)
  f=$(grep -c '^FAIL ' "$3" || :)
  grep -E '^(PASS|FAIL|  )' "$3" || :
  passed=$((passed + p))
  failed=$((failed + f))
  if [ "$2" -ne 0 ] && [ "$f" -eq 0 ]; then fail "$1 (exit $2)"; fi
  if [ "$p" -eq 0 ] && [ "$f" -eq 0 ]; then fail "$1 (no cases ran)"; fi
}

if [ -z "$node" ]; then
  fail ".NET config (no node)"
else
  rc=0
  "$node" "$src/tools/tests/digest-cases.mjs" > "$tmp/out" 2>&1 || rc=$?
  count_lines "digest cases" "$rc" "$tmp/out"

  rc=0
  "$node" "$src/tools/checks/dotnet.mjs" "$src" > "$tmp/out" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] && grep -qxF 'PASS .NET config' "$tmp/out"; then
    pass ".NET config passes on the repository"
  else
    fail ".NET config passes on the repository"
    cat "$tmp/out"
  fi

  mkdir "$tmp/malformed"
  cp "$src/global.json" "$src/Directory.Packages.props" "$tmp/malformed/"
  sed -e 's#</Project>##' "$src/Directory.Build.props" > "$tmp/malformed/Directory.Build.props"
  rc=0
  "$node" "$src/tools/checks/dotnet.mjs" "$tmp/malformed" > "$tmp/out" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ] && grep -qxF '  Directory.Build.props does not evaluate' "$tmp/out"; then
    pass ".NET config fails a malformed Directory.Build.props (exit $rc)"
  else
    fail ".NET config fails a malformed Directory.Build.props (exit $rc)"
    cat "$tmp/out"
  fi

  rc=0
  # MSBuild reports item paths with 8.3 short names expanded, so the probe needs the long form.
  long=$("$node" -e 'console.log(require("node:fs").realpathSync.native(process.argv[1]))' "$tmp")
  "$node" "$src/tools/tests/dotnet-probe.mjs" "$long/dn" > "$tmp/out" 2>&1 || rc=$?
  count_lines "dotnet probe" "$rc" "$tmp/out"

  rc=0
  "$node" "$src/tools/tests/csharp-cases.mjs" "$tmp/csharp" > "$tmp/out" 2>&1 || rc=$?
  count_lines "C# cases" "$rc" "$tmp/out"

  rc=0
  "$node" "$src/tools/tests/content-cases.mjs" "$tmp/content" > "$tmp/out" 2>&1 || rc=$?
  count_lines "content cases" "$rc" "$tmp/out"
fi

if [ -z "$node" ]; then
  fail "npm audit cases (no node)"
else
  rc=0
  "$node" "$src/tools/tests/npm-audit-cases.mjs" "$tmp/audit" > "$tmp/out" 2>&1 || rc=$?
  count_lines "npm audit cases" "$rc" "$tmp/out"

  rc=0
  "$node" "$src/tools/tests/asset-licence-cases.mjs" "$tmp/assets" > "$tmp/out" 2>&1 || rc=$?
  count_lines "asset licence cases" "$rc" "$tmp/out"

  rc=0
  "$node" "$src/tools/tests/pssa-cases.mjs" "$tmp/pssa" > "$tmp/out" 2>&1 || rc=$?
  count_lines "PSScriptAnalyzer installer cases" "$rc" "$tmp/out"

  rc=0
  "$node" "$src/tools/tests/browser-cases.mjs" "$tmp/browsers" > "$tmp/out" 2>&1 || rc=$?
  count_lines "browser provisioning cases" "$rc" "$tmp/out"

  rc=0
  "$node" "$src/tools/tests/flake-check-cases.mjs" "$tmp/flake" > "$tmp/out" 2>&1 || rc=$?
  count_lines "flake check cases" "$rc" "$tmp/out"
fi

rc=0
sh "$src/tools/tests/check-linux-cases.sh" "$tmp/check-linux" > "$tmp/out" 2>&1 || rc=$?
count_lines "Linux check cases" "$rc" "$tmp/out"

echo "$passed passed, $failed failed in $(($(date +%s) - started))s"
[ "$failed" -eq 0 ]
