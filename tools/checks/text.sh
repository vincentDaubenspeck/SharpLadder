#!/bin/sh
# Text rules, run by tools/check.sh and tools/check.ps1.
# tools/checks/text.ps1 is the PowerShell twin; tools/tests checks they agree.
#   1. Unfinished-text scan against tools/forbidden-phrases.txt
#   2. UTF-8, LF line endings and final newline on tracked text files
#   3. HEAD commit message against the commit-msg hook rule
set -eu
# Not every sh has pipefail; use it where available.
# shellcheck disable=SC3040
(set -o pipefail) 2> /dev/null && set -o pipefail

root=$(git rev-parse --show-toplevel)
cd "$root" || exit 1

status=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# die prints to stderr so the message survives when stdout is redirected.
die() {
  echo "FAIL $1" >&2
  exit 1
}

# Run grep; exit 0 (match) and 1 (no match) are results, 2 or more is an error.
grep_rc() {
  rc=0
  grep "$@" || rc=$?
  [ "$rc" -le 1 ] || die "grep error (exit $rc)"
  return "$rc"
}

phrase_file=tools/forbidden-phrases.txt
if [ ! -f "$phrase_file" ] || [ ! -r "$phrase_file" ]; then
  die "$phrase_file is missing or unreadable"
fi

git -c core.quotepath=off ls-files > "$tmp/all"

# Only these exact paths are exempt.
printf '%s\n' tools/checks/text.sh tools/checks/text.ps1 tools/forbidden-phrases.txt > "$tmp/exempt"
grep_rc -v -x -F -f "$tmp/exempt" "$tmp/all" > "$tmp/scan" || :
tr -d '\r' < "$phrase_file" | sed -e '/^#/d' -e '/^$/d' > "$tmp/phrases"
[ -s "$tmp/phrases" ] || die "$phrase_file has no phrases"
# Pattern rule: see the header of tools/forbidden-phrases.txt. LC_ALL=C keeps the locale out of it.
sed -e '/^[~=]/d' "$tmp/phrases" > "$tmp/p_any"
word_regex() {
  sed -n -e "s/^$1//p" "$tmp/phrases" |
    sed -e 's/\\/\\\\/g' -e 's/[.[()|*+?{^$]/\\&/g' > "$tmp/p_list"
  alt=
  while IFS= read -r p; do
    alt=${alt:+$alt|}$p
  done < "$tmp/p_list"
  [ -s "$tmp/p_list" ] || return 0
  printf '(^|[^A-Za-z0-9_])(%s)([^A-Za-z0-9_]|$)' "$alt"
}
re_word=$(word_regex '~')
re_case=$(word_regex '=')
# Same as grep_rc, in the C locale.
cgrep_rc() {
  rc=0
  LC_ALL=C grep "$@" || rc=$?
  [ "$rc" -le 1 ] || die "grep error (exit $rc)"
  return "$rc"
}
# Hits are listed in grep output order (no sort); a line can appear once per list.
match_phrases() {
  : > "$tmp/hit"
  if [ -s "$tmp/p_any" ]; then
    grep_rc -n -I -i -F -f "$tmp/p_any" -- "$1" >> "$tmp/hit" || :
  fi
  if [ -n "$re_word" ]; then
    cgrep_rc -n -I -i -E -e "$re_word" -- "$1" >> "$tmp/hit" || :
  fi
  if [ -n "$re_case" ]; then
    cgrep_rc -n -I -E -e "$re_case" -- "$1" >> "$tmp/hit" || :
  fi
  [ -s "$tmp/hit" ]
}
hits=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  if match_phrases "$f"; then
    sed -e "s|^|  $f:|" "$tmp/hit"
    hits=$((hits + 1))
  fi
done < "$tmp/scan"
if [ "$hits" -eq 0 ]; then
  echo "PASS phrase scan"
else
  echo "FAIL phrase scan ($hits file(s))"
  status=1
fi

# UTF-8 validation uses iconv; without it, grep under a UTF-8 locale.
utf8_locale=
if ! command -v iconv > /dev/null 2>&1; then
  for loc in C.UTF-8 en_US.UTF-8; do
    if printf '\303\251\n' | LC_ALL=$loc grep -a -x -q '.*' 2> /dev/null &&
      printf '\377\n' | LC_ALL=$loc grep -a -x -v -q '.*' 2> /dev/null; then
      utf8_locale=$loc
      break
    fi
  done
  [ -n "$utf8_locale" ] || die "cannot validate UTF-8: no iconv and no UTF-8 locale for grep"
fi
valid_utf8() {
  if [ -z "$utf8_locale" ]; then
    iconv -f UTF-8 -t UTF-8 "$1" > /dev/null 2>&1
  else
    rc=0
    LC_ALL=$utf8_locale grep -a -x -v -q '.*' "$1" || rc=$?
    [ "$rc" -le 1 ] || die "grep error (exit $rc)"
    [ "$rc" -eq 1 ]
  fi
}

bad=0
git -c core.quotepath=off ls-files --eol > "$tmp/eol"
while IFS= read -r line; do
  index_eol=$(printf '%s' "$line" | awk '{print $1}')
  work_eol=$(printf '%s' "$line" | awk '{print $2}')
  f=$(printf '%s' "$line" | cut -f 2-)
  case "$index_eol" in
    i/-text) continue ;;
    i/crlf | i/mixed)
      echo "  $f: CRLF line endings in index"
      bad=$((bad + 1))
      continue
      ;;
  esac
  case "$work_eol" in
    w/crlf | w/mixed)
      echo "  $f: CRLF line endings"
      bad=$((bad + 1))
      continue
      ;;
  esac
  [ -f "$f" ] || continue
  [ -s "$f" ] || continue
  if [ "$(tail -c 1 "$f" | wc -l | tr -d ' ')" -ne 1 ]; then
    echo "  $f: no final newline"
    bad=$((bad + 1))
  fi
  if ! valid_utf8 "$f"; then
    echo "  $f: not valid UTF-8"
    bad=$((bad + 1))
  fi
done < "$tmp/eol"
if [ "$bad" -eq 0 ]; then
  echo "PASS encoding, line endings and final newline"
else
  echo "FAIL encoding, line endings and final newline ($bad problem(s))"
  status=1
fi

if git rev-parse --verify -q HEAD > /dev/null; then
  git log -1 --format=%B HEAD > "$tmp/msg"
  if sh tools/hooks/commit-msg "$tmp/msg"; then
    echo "PASS HEAD commit message"
  else
    echo "FAIL HEAD commit message"
    status=1
  fi
else
  echo "SKIP HEAD commit message (no commits yet)"
fi

exit "$status"
