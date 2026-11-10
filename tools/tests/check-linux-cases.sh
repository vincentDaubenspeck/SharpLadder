#!/bin/sh
# Input-identity and image-selection cases for tools/check-linux.sh, with a stand-in docker on PATH.
# Usage: sh tools/tests/check-linux-cases.sh <work dir>
# Prints one PASS or FAIL line per case; exits non-zero on any failure.
set -eu

src=$(cd "$(dirname "$0")/../.." && pwd)
work=$1
mkdir -p "$work"
work=$(cd "$work" && pwd)
failed=0
pass() { echo "PASS check-linux: $1"; }
fail() {
  echo "FAIL check-linux: $1"
  failed=$((failed + 1))
}

repo=$work/repo
mkdir -p "$repo/tools/linux-check" "$repo/web"
for p in tools/linux-check/Dockerfile tools/check-linux.sh tools/tool-pins.json tools/install-tools.mjs \
  tools/install-psscriptanalyzer.mjs tools/digest.mjs tools/requirements-yamllint.txt web/.nvmrc; do
  cp "$src/$p" "$repo/$p"
done
cd "$repo"
git init -q
git add -A
git commit -qm "Add the check inputs"
first=$(git rev-parse HEAD)

# hash_of [<commit>]: the inputs line of --inputs-hash, or the exit code when it fails.
hash_of() {
  if sh tools/check-linux.sh --inputs-hash "${1:-HEAD}" > "$work/out" 2>&1; then
    sed -n 's/^inputs //p' "$work/out"
  else
    echo "exit $?"
  fi
}
base=$(hash_of)
if echo "$base" | grep -Eqx "[0-9a-f]{64}"; then
  pass "the input hash is a SHA-256"
else
  fail "the input hash is a SHA-256"
fi
if [ "$(grep -c "^[0-9a-f]\{64\}  " "$work/out")" = 8 ] && grep -qx "build-arg PLATFORM=linux/amd64" "$work/out"; then
  pass "the manifest labels every declared input by path"
else
  fail "the manifest labels every declared input by path"
fi
if [ "$(hash_of)" = "$base" ]; then
  pass "the same commit gives the same hash"
else
  fail "the same commit gives the same hash"
fi

echo "dirty" >> tools/check-linux.sh
echo "dirty" > web/.nvmrc
if [ "$(hash_of)" = "$base" ]; then
  pass "working-tree edits leave the commit's hash unchanged"
else
  fail "working-tree edits leave the commit's hash unchanged"
fi
git checkout -q -- .

seen=$base
grep -E '^[0-9a-f]{64}  ' "$work/out" | cut -c67- > "$work/paths"
while read -r p; do
  echo "# changed" >> "$p"
  git commit -qam "Change $p"
  h=$(hash_of)
  if echo "$h" | grep -Eqx "[0-9a-f]{64}" && ! echo "$seen" | grep -qx "$h"; then
    pass "a change to $p selects a new identity"
  else
    fail "a change to $p selects a new identity"
  fi
  seen=$(printf '%s\n%s' "$seen" "$h")
  git reset -q --hard "$first"
done < "$work/paths"

sed -e 's/"base": "ubuntu@sha256:[0-9a-f]*"/"base": "ubuntu@sha256:'"$(printf '%064d' 1)"'"/' \
  "$src/tools/tool-pins.json" > tools/tool-pins.json
git commit -qam "Move the base"
h=$(hash_of)
if echo "$h" | grep -Eqx "[0-9a-f]{64}" && [ "$h" != "$base" ]; then
  pass "a different base digest selects a new identity"
else
  fail "a different base digest selects a new identity"
fi
git reset -q --hard "$first"

sed -e 's#"platform": "linux/amd64"#"platform": "linux/arm64"#' "$src/tools/tool-pins.json" > tools/tool-pins.json
git commit -qam "Move the platform"
if [ "$(hash_of)" = "exit 1" ] && grep -q "platform must be linux/amd64" "$work/out"; then
  pass "another platform is refused"
else
  fail "another platform is refused"
fi
git reset -q --hard "$first"

sed -e 's#"base": "ubuntu@sha256:[0-9a-f]*"#"base": "ubuntu:24.04"#' "$src/tools/tool-pins.json" > tools/tool-pins.json
git commit -qam "Use a tag"
if [ "$(hash_of)" = "exit 1" ] && grep -q "not pinned by digest" "$work/out"; then
  pass "a base without a digest is refused"
else
  fail "a base without a digest is refused"
fi
git reset -q --hard "$first"

git rm -q web/.nvmrc
git commit -qm "Drop an input"
if [ "$(hash_of)" = "exit 1" ] && grep -q "missing or invalid" "$work/out"; then
  pass "a missing input fails"
else
  fail "a missing input fails"
fi
git reset -q --hard "$first"

# The stand-in docker keeps images as files named by ID, each holding its input label, and tags as files
# holding an ID; every call is logged.
stub=$work/stub
mkdir -p "$work/bin" "$stub/images" "$stub/tags"
cat > "$work/bin/docker" << 'EOF'
#!/bin/sh
echo "$*" >> "$STUB/calls"
key() { echo "$1" | tr ':/@' '___'; }
case "$1" in
  image)
    fmt=
    if [ "$3" = --format ]; then fmt=$4; fi
    ref=$(eval echo "\${$#}")
    id=$ref
    [ ! -f "$STUB/tags/$(key "$ref")" ] || id=$(cat "$STUB/tags/$(key "$ref")")
    [ -f "$STUB/images/$(key "$id")" ] || exit 1
    case "$fmt" in
      *Labels*) echo "$id $(cat "$STUB/images/$(key "$id")")" ;;
      *) echo "$id" ;;
    esac
    ;;
  pull) ;;
  build)
    [ ! -f "$STUB/build-fails" ] || exit 1
    while [ $# -gt 0 ]; do
      case "$1" in
        --iidfile) iid=$2 ;;
        --label) lab=${2#*=} ;;
      esac
      shift
    done
    n=$(($(cat "$STUB/n" 2> /dev/null || echo 0) + 1))
    echo "$n" > "$STUB/n"
    id=sha256:$(printf '%064d' "$n")
    echo "$lab" > "$STUB/images/$(key "$id")"
    printf '%s\n' "$id" > "$iid"
    ;;
  tag) echo "$2" > "$STUB/tags/$(key "$3")" ;;
  run) [ ! -f "$STUB/run-fails" ] ;;
  *) exit 2 ;;
esac
EOF
chmod +x "$work/bin/docker"
STUB=$stub
export STUB
evidence=$repo/.tools/check-linux/images/$base
tag=sharpladder-check-linux:$(echo "$base" | cut -c1-16)
tag_file=$stub/tags/$(echo "$tag" | tr ':/@' '___')

# run_outer [args]: one host run against the stand-in, with the calls it made in $work/calls.
run_outer() {
  : > "$stub/calls"
  rc=0
  PATH="$work/bin:$PATH" sh tools/check-linux.sh "$@" > "$work/out" 2>&1 || rc=$?
  cp "$stub/calls" "$work/calls"
}
builds() { grep -c '^build ' "$work/calls" || :; }
runs() { grep -c '^run ' "$work/calls" || :; }

echo dirty >> tools/check-linux.sh
run_outer
git checkout -q -- .
id1=$(cat "$evidence" 2> /dev/null || :)
if [ "$rc" = 0 ] && [ "$(builds)" = 1 ] && [ -n "$id1" ] && [ "$(cat "$tag_file")" = "$id1" ] &&
  grep "^run " "$work/calls" | head -n 1 | grep -q -- "--network none -e PREPARE_ONLY=1" && [ "$(runs)" = 2 ]; then
  pass "missing evidence builds, validates offline, then records the ID and tag"
else
  fail "missing evidence builds, validates offline, then records the ID and tag"
fi
if grep -q "inputs $base" "$work/out"; then
  pass "a dirty working tree does not change the inputs built"
else
  fail "a dirty working tree does not change the inputs built"
fi
if grep "^build " "$work/calls" | grep -q "=$base"; then
  pass "the build carries the full input hash as its label"
else
  fail "the build carries the full input hash as its label"
fi
if grep "^run " "$work/calls" | grep -q " $id1 sh " && ! grep "^run " "$work/calls" | grep -q "sharpladder-check-linux:"; then
  pass "the container runs the recorded image ID, never the tag"
else
  fail "the container runs the recorded image ID, never the tag"
fi
if grep "^run " "$work/calls" | grep -q "/opt/sharpladder-check/inputs/tools/check-linux.sh --enter" &&
  ! grep "^run " "$work/calls" | grep -q "check-linux.sh:"; then
  pass "the container runs the image's checked-in runner, with no script mounted"
else
  fail "the container runs the image's checked-in runner, with no script mounted"
fi

run_outer
if [ "$rc" = 0 ] && [ "$(builds)" = 0 ] && grep -q "reusing image $id1 (build skipped)" "$work/out" && [ "$(runs)" = 1 ]; then
  pass "matching evidence reuses the image and skips the build"
else
  fail "matching evidence reuses the image and skips the build"
fi

other=sha256:$(printf '%064d' 99)
echo "$base" > "$stub/images/$(echo "$other" | tr ':/@' '___')"
echo "$other" > "$tag_file"
run_outer
id2=$(cat "$evidence")
if [ "$rc" = 0 ] && [ "$(builds)" = 1 ] && [ "$id2" != "$other" ] && [ "$(cat "$tag_file")" = "$id2" ] &&
  ! grep "^run " "$work/calls" | grep -q " $other "; then
  pass "a substituted tag is rebuilt even with a matching label"
else
  fail "a substituted tag is rebuilt even with a matching label"
fi

rm "$stub/images/$(echo "$id2" | tr ':/@' '___')"
run_outer
id3=$(cat "$evidence")
if [ "$rc" = 0 ] && [ "$(builds)" = 1 ] && [ "$id3" != "$id2" ]; then
  pass "a recorded ID missing from the image store is rebuilt"
else
  fail "a recorded ID missing from the image store is rebuilt"
fi

rm "$evidence"
run_outer
if [ "$rc" = 0 ] && [ "$(builds)" = 1 ]; then
  pass "missing evidence rebuilds even when the tag exists"
else
  fail "missing evidence rebuilds even when the tag exists"
fi
id4=$(cat "$evidence")

echo "--privileged" > "$evidence"
run_outer
if [ "$rc" = 0 ] && [ "$(builds)" = 1 ] && ! grep -q -- "--privileged" "$work/calls"; then
  pass "evidence that is not an image ID is never passed to docker and is rebuilt"
else
  fail "evidence that is not an image ID is never passed to docker and is rebuilt"
fi
id4=$(cat "$evidence")

run_outer --rebuild
if [ "$rc" = 0 ] && grep "^build " "$work/calls" | grep -q -- "--no-cache"; then
  pass "--rebuild builds without the layer cache"
else
  fail "--rebuild builds without the layer cache"
fi
id5=$(cat "$evidence")

touch "$stub/build-fails"
run_outer --rebuild
if [ "$rc" != 0 ] && [ "$(runs)" = 0 ] && [ "$(cat "$evidence")" = "$id5" ] && grep -q "image build failed" "$work/out"; then
  pass "a failed rebuild exits non-zero, runs nothing and keeps the record as it was"
else
  fail "a failed rebuild exits non-zero, runs nothing and keeps the record as it was"
fi
rm "$evidence"
run_outer
if [ "$rc" != 0 ] && [ "$(runs)" = 0 ] && [ ! -e "$evidence" ]; then
  pass "a failed build with no evidence exits non-zero and runs nothing"
else
  fail "a failed build with no evidence exits non-zero and runs nothing"
fi
rm "$stub/build-fails"

touch "$stub/run-fails"
echo "$id4" > "$tag_file"
run_outer
if [ "$rc" != 0 ] && [ "$(runs)" = 1 ] && [ ! -e "$evidence" ] && [ "$(cat "$tag_file")" = "$id4" ]; then
  pass "a new image that fails its offline preparation is never recorded or tagged"
else
  fail "a new image that fails its offline preparation is never recorded or tagged"
fi
rm "$stub/run-fails"

[ "$failed" = 0 ]
