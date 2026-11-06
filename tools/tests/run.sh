#!/bin/sh
# Tests for the commit-msg hook and the repository checks.
# tools/tests/run.ps1 does the same in PowerShell.
# Builds a throwaway git repository, installs the tracked hooks there and checks:
#   a. Bad commit subjects are rejected by tools/hooks/commit-msg
#   b. Good commit subjects pass
#   c. CRLF line endings and a missing final newline fail the encoding check
#   d. tools/check.sh and tools/check.ps1 give the same result on each fixture
# Usage: sh tools/tests/run.sh
# Part d needs PowerShell; set REQUIRE_PARITY=1 to fail instead of skipping.
set -eu

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
pass() { echo "PASS $1"; passed=$((passed + 1)); }
fail() { echo "FAIL $1"; failed=$((failed + 1)); }

ps=
for c in pwsh powershell.exe; do
  if command -v "$c" > /dev/null 2>&1; then ps=$c; break; fi
done

# Fixture repository with the tracked checks and hooks.
repo=$tmp/repo
mkdir -p "$repo/tools/hooks"
cp "$src/.gitattributes" "$repo/"
cp "$src/tools/check.sh" "$src/tools/check.ps1" "$src/tools/forbidden-phrases.txt" \
  "$repo/tools/"
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

# run_checks <label> <expected exit code>: runs check.sh, then check.ps1 for parity.
run_checks() {
  rc=0
  sh tools/check.sh > "$tmp/out.sh" 2>&1 || rc=$?
  if [ "$rc" -eq "$2" ]; then pass "check.sh $1 (exit $rc)"; else fail "check.sh $1 (exit $rc)"; fi
  if [ -z "$ps" ]; then
    if [ "${REQUIRE_PARITY:-0}" = 1 ]; then
      fail "parity $1 (no PowerShell)"
    else
      echo "SKIP parity $1 (no PowerShell)"
      skipped=$((skipped + 1))
    fi
    return 0
  fi
  prc=0
  "$ps" -NoProfile -ExecutionPolicy Bypass -File tools/check.ps1 > "$tmp/out.ps" 2>&1 || prc=$?
  tr -d '\r' < "$tmp/out.ps" > "$tmp/out.ps.lf"
  if [ "$prc" -eq "$rc" ] && cmp -s "$tmp/out.sh" "$tmp/out.ps.lf"; then
    pass "parity $1"
  else
    fail "parity $1 (check.sh exit $rc, check.ps1 exit $prc)"
    diff "$tmp/out.sh" "$tmp/out.ps.lf" || :
  fi
}

run_checks "clean tree" 0

printf 'one\r\ntwo\r\n' > crlf.txt
git add crlf.txt 2> /dev/null
run_checks "CRLF file" 1
if grep -q '^  crlf.txt: CRLF line endings$' "$tmp/out.sh"; then
  pass "check.sh names the CRLF file"
else
  fail "check.sh names the CRLF file"
fi
git rm -q --cached crlf.txt && rm crlf.txt

printf 'no final newline' > tail.txt
git add tail.txt
run_checks "missing final newline" 1
if grep -q '^  tail.txt: no final newline$' "$tmp/out.sh"; then
  pass "check.sh names the file without a final newline"
else
  fail "check.sh names the file without a final newline"
fi
git rm -q --cached tail.txt && rm tail.txt

echo "$passed passed, $failed failed, $skipped skipped"
[ "$failed" -eq 0 ]
