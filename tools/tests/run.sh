#!/bin/sh
# Tests for the commit-msg hook and the repository checks.
# tools/tests/run.ps1 does the same in PowerShell.
# Builds a throwaway git repository, installs the tracked hooks there and checks:
#   a. Bad commit subjects are rejected by tools/hooks/commit-msg
#   b. Good commit subjects pass
#   c. CRLF line endings and a missing final newline fail the encoding check; lock files are exempt
#   d. tools/checks/text.sh and text.ps1 give the same result on each fixture
#   e. Suppression-reason fixtures from tools/tests/fixtures.mjs, per language
#   f. Missing tools fail, and failures reach check.sh, check.ps1 and pre-push
#   g. Licence allowlist and override record cases, and a disallowed licence through check.sh and check.ps1
#   h. .NET config: SDK pin, props evaluation, digest cases and the probe build
#   i. C# cases (tools/tests/csharp-cases.mjs): suppression fixtures, nuget vulnerabilities and licences, no SDK
#   j. npm audit cases (tools/tests/npm-audit-cases.mjs): a low-severity advisory fails the audit
#   k. Content cases (tools/tests/content-cases.mjs): golden digest, compile errors, empty input,
#      full-path arguments, output containment, no partial output, schema setup errors, no SDK
# Usage: sh tools/tests/run.sh
# Parts h, i and k need the pinned .NET SDK and nuget.org. Parts d to g need PowerShell; set REQUIRE_PARITY=1 to fail instead of skipping.
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
skipped=0
pass() {
  echo "PASS $1"
  passed=$((passed + 1))
}
fail() {
  echo "FAIL $1"
  failed=$((failed + 1))
}
no_ps() {
  if [ "${REQUIRE_PARITY:-0}" = 1 ]; then
    fail "$1 (no PowerShell)"
  else
    echo "SKIP $1 (no PowerShell)"
    skipped=$((skipped + 1))
  fi
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
cp "$src/tools/checks/text.sh" "$src/tools/checks/text.ps1" "$repo/tools/checks/"
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

# run_checks <label> <expected exit code>: runs text.sh, then text.ps1 for parity.
run_checks() {
  rc=0
  sh tools/checks/text.sh > "$tmp/out.sh" 2>&1 || rc=$?
  if [ "$rc" -eq "$2" ]; then pass "text.sh $1 (exit $rc)"; else fail "text.sh $1 (exit $rc)"; fi
  if [ -z "$ps" ]; then
    no_ps "parity $1"
    return 0
  fi
  prc=0
  "$ps" -NoProfile -ExecutionPolicy Bypass -File tools/checks/text.ps1 > "$tmp/out.ps" 2>&1 || prc=$?
  tr -d '\r' < "$tmp/out.ps" > "$tmp/out.ps.lf"
  if [ "$prc" -eq "$rc" ] && cmp -s "$tmp/out.sh" "$tmp/out.ps.lf"; then
    pass "parity $1"
  else
    fail "parity $1 (text.sh exit $rc, text.ps1 exit $prc)"
    diff "$tmp/out.sh" "$tmp/out.ps.lf" || :
  fi
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
        if [ -z "$ps" ]; then
          no_ps "$lang $want: $label"
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
  if [ -z "$ps" ]; then
    no_ps "ps: absolute paths"
  else
    for want in pass fail; do
      if [ "$want" = pass ]; then f=good.ps1; else f=missing.ps1; fi
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
fi

mkdir -p "$repo/web"
cp "$src/tools/check.sh" "$src/tools/check.ps1" "$src/tools/tool-pins.json" "$repo/tools/"
cp "$src/tools/checks/lib.mjs" "$src/tools/checks/run.mjs" "$src/tools/checks/shell.mjs" \
  "$src/tools/checks/dotnet.mjs" "$src/tools/checks/csharp.mjs" "$src/tools/checks/content.mjs" \
  "$src/tools/checks/web.mjs" \
  "$src/tools/checks/ps-suppressions.ps1" "$src/tools/checks/pssa.ps1" "$repo/tools/checks/"
cp "$src/tools/hooks/pre-push" "$repo/tools/hooks/"
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
sed -e 's/"10\.0\.403"/"10.0.402"/' "$src/global.json" > global.json

rc=0
sh tools/check.sh > "$tmp/out" 2>&1 || rc=$?
for want in 'FAIL shell suppression reasons' '  web/node_modules not found; run npm ci in web/' \
  '  global.json SDK 10.0.402 differs from tools/tool-pins.json 10.0.403' \
  '  PSScriptAnalyzer 0.0.0 not found; install it with:' \
  '  web/x.sh:2: shellcheck directive needs a reason comment on the line above' \
  '  needs .NET config (see above)' 'FAIL nuget vulnerabilities' 'FAIL nuget licences'; do
  if [ "$rc" -ne 0 ] && grep -qxF "$want" "$tmp/out"; then
    pass "check.sh exit $rc with: $want"
  else
    fail "check.sh exit $rc with: $want"
  fi
done
rc=0
sh tools/hooks/pre-push > "$tmp/out" 2>&1 || rc=$?
if [ "$rc" -ne 0 ] && grep -q '^pre-push: tools/check.sh failed; push blocked$' "$tmp/out"; then
  pass "pre-push blocks on a failed check (exit $rc)"
else
  fail "pre-push blocks on a failed check (exit $rc)"
fi
if [ -z "$ps" ]; then
  no_ps "check.ps1 propagates a failure"
  no_ps "check.ps1 fails a global.json that differs from the SDK pin"
else
  rc=0
  "$ps" -NoProfile -ExecutionPolicy Bypass -File tools/check.ps1 > "$tmp/out" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ] && tr -d '\r' < "$tmp/out" | grep -qxF 'FAIL shell suppression reasons'; then
    pass "check.ps1 propagates a failure (exit $rc)"
  else
    fail "check.ps1 propagates a failure (exit $rc)"
  fi
  if [ "$rc" -ne 0 ] && tr -d '\r' < "$tmp/out" |
    grep -qxF '  global.json SDK 10.0.402 differs from tools/tool-pins.json 10.0.403'; then
    pass "check.ps1 fails a global.json that differs from the SDK pin (exit $rc)"
  else
    fail "check.ps1 fails a global.json that differs from the SDK pin (exit $rc)"
  fi
fi

# With web/node_modules present the web stages run, so a disallowed licence reaches both entry points.
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
  if [ -z "$ps" ]; then
    no_ps "check.ps1 fails a disallowed licence"
  else
    rc=0
    "$ps" -NoProfile -ExecutionPolicy Bypass -File tools/check.ps1 > "$tmp/out" 2>&1 || rc=$?
    tr -d '\r' < "$tmp/out" > "$tmp/out.lf"
    if [ "$rc" -ne 0 ] && grep -qxF 'FAIL licence allowlist' "$tmp/out.lf" &&
      grep -qxF '  fx-gpl@1.0.0' "$tmp/out.lf"; then
      pass "check.ps1 fails a disallowed licence (exit $rc)"
    else
      fail "check.ps1 fails a disallowed licence (exit $rc)"
      cat "$tmp/out.lf"
    fi
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
  "$node" "$src/tools/tests/dotnet-probe.mjs" "$tmp/dn" > "$tmp/out" 2>&1 || rc=$?
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
fi

echo "$passed passed, $failed failed, $skipped skipped in $(($(date +%s) - started))s"
[ "$failed" -eq 0 ]
