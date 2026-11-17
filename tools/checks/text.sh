#!/bin/sh
# Text rules, run by tools/check.sh.
#   1. Unfinished-text scan against tools/forbidden-phrases.txt
#   2. UTF-8, LF line endings and final newline on every tracked file not declared -text
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
  printf 'FAIL %s\n' "$1" >&2
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

# One listing feeds both stages; with -z Git prints every name as it is, never quoted.
git -c core.quotepath=off ls-files -z --eol > "$tmp/listing" || die "git ls-files failed"
# Records end in NUL, so a newline byte can only come from a name, which read cannot carry.
newlines=$(wc -l < "$tmp/listing" | tr -d ' ')
[ "$newlines" -eq 0 ] || die "unsupported tracked filename: contains a newline"
tr '\000' '\n' < "$tmp/listing" > "$tmp/records"

tab=$(printf '\t')
# Git pads the three fields with spaces; the path is everything after the first tab.
parse_record() {
  meta=${1%%"$tab"*}
  [ "$meta" != "$1" ] || return 1
  path=${1#*"$tab"}
  i_field=${meta%%" "*}
  rest=${meta#"$i_field"}
  case $rest in " "*) ;; *) return 1 ;; esac
  rest=${rest#"${rest%%[! ]*}"}
  w_field=${rest%%" "*}
  rest=${rest#"$w_field"}
  case $rest in " "*) ;; *) return 1 ;; esac
  rest=${rest#"${rest%%[! ]*}"}
  attr_field=${rest%"${rest##*[! ]}"}
  case $i_field in i/ | i/none | i/lf | i/crlf | i/mixed | i/-text) ;; *) return 1 ;; esac
  case $w_field in w/ | w/none | w/lf | w/crlf | w/mixed | w/-text) ;; *) return 1 ;; esac
  case $attr_field in
    attr/ | attr/-text | attr/text | attr/text=auto | "attr/text eol=lf" | "attr/text eol=crlf") ;;
    "attr/text=auto eol=lf" | "attr/text=auto eol=crlf") ;;
    *) return 1 ;;
  esac
}

# Every record is accounted for before any exemption, so a deleted exempt file still fails.
: > "$tmp/valid"
while IFS= read -r record; do
  parse_record "$record" || die "unexpected git ls-files record: $record"
  if [ -f "./$path" ]; then
    printf '%s\n' "$record" >> "$tmp/valid"
  else
    printf 'FAIL %s is missing or not a regular file\n' "$path"
    status=1
  fi
done < "$tmp/records"

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
    grep_rc -n -a -i -F -f "$tmp/p_any" -- "$1" >> "$tmp/hit" || :
  fi
  if [ -n "$re_word" ]; then
    cgrep_rc -n -a -i -E -e "$re_word" -- "$1" >> "$tmp/hit" || :
  fi
  if [ -n "$re_case" ]; then
    cgrep_rc -n -a -E -e "$re_case" -- "$1" >> "$tmp/hit" || :
  fi
  [ -s "$tmp/hit" ]
}
hits=0
while IFS= read -r record; do
  parse_record "$record" || die "unexpected git ls-files record: $record"
  # Only Git's attribute state exempts content; its guess at binary content never does.
  [ "$attr_field" != attr/-text ] || continue
  # Only these exact paths are exempt.
  case $path in tools/checks/text.sh | tools/forbidden-phrases.txt) continue ;; esac
  if match_phrases "./$path"; then
    while IFS= read -r hit; do
      printf '  %s:%s\n' "$path" "$hit"
    done < "$tmp/hit"
    hits=$((hits + 1))
  fi
done < "$tmp/valid"
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

undeclared='binary content without a no-text declaration; declare it in .gitattributes or fix its bytes'
bad=0
while IFS= read -r record; do
  parse_record "$record" || die "unexpected git ls-files record: $record"
  [ "$attr_field" != attr/-text ] || continue
  if [ "$i_field" = i/-text ] || [ "$w_field" = w/-text ]; then
    printf '  %s: %s\n' "$path" "$undeclared"
    bad=$((bad + 1))
    continue
  fi
  case $i_field in
    i/crlf | i/mixed)
      printf '  %s: CRLF line endings in index\n' "$path"
      bad=$((bad + 1))
      continue
      ;;
  esac
  case $w_field in
    w/crlf | w/mixed)
      printf '  %s: CRLF line endings\n' "$path"
      bad=$((bad + 1))
      continue
      ;;
  esac
  [ -s "./$path" ] || continue
  # NuGet writes lock files without a final newline; they are committed exactly as written.
  case $path in
    packages.lock.json | */packages.lock.json) ;;
    *)
      if [ "$(tail -c 1 "./$path" | wc -l | tr -d ' ')" -ne 1 ]; then
        printf '  %s: no final newline\n' "$path"
        bad=$((bad + 1))
      fi
      ;;
  esac
  if ! valid_utf8 "./$path"; then
    printf '  %s: not valid UTF-8\n' "$path"
    bad=$((bad + 1))
  fi
done < "$tmp/valid"
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
