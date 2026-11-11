#!/bin/sh
# Local Linux counterpart of tools/check.sh: runs the checks for one commit in a prebuilt, pinned Ubuntu image.
# Usage: sh tools/check-linux.sh [--rebuild | --self-test | --offline-prepare | --inputs-hash] [<commit>]
#   (KEEP_GOING=1 reports every step; logs land in a per-run folder under .tools/check-linux/)
# The image is built from the commit's archived inputs and run only by the image ID recorded under
# .tools/check-linux/images/ after a successful build for exactly those inputs.
# --rebuild builds the image afresh for the same inputs, apt included, with no layer cache.
# --offline-prepare runs only the tool preparation, with the container's network switched off.
# --self-test feeds the Node download a wrong checksum and passes only if sha256sum rejected the downloaded file
# and nothing was extracted; it needs the network.
# --inputs-hash prints the commit's input manifest and its hash, and builds nothing.
set -eu

# Everything that decides the image's content; a change to any of them selects a different image.
inputs="tools/linux-check/Dockerfile tools/check-linux.sh tools/tool-pins.json tools/install-tools.mjs
tools/install-psscriptanalyzer.mjs tools/digest.mjs tools/requirements-yamllint.txt web/.nvmrc"
label=org.sharpladder.check-linux.inputs
state=/opt/sharpladder-check
runner_home=/home/runner
pssa_dir=$runner_home/.local/share/powershell/Modules/PSScriptAnalyzer
# The tool payload at the paths the checks run it from, which is where the build installed and recorded it.
payload="$runner_home/repo/.tools /opt/pwsh /usr/local/bin/pwsh $pssa_dir"

# linux_check_pin <key> <pins file>: the flat "linux-check" entry is read without a JSON parser, as on the host.
linux_check_pin() {
  sed -n '/^  "linux-check": {/,/^  }/s/^ *"'"$1"'": *"\([^"]*\)".*/\1/p' "$2"
}

# input_manifest <dir>: one path-labelled SHA-256 per input, then the base, platform and build arguments.
input_manifest() {
  base=$(linux_check_pin base "$1/tools/tool-pins.json")
  platform=$(linux_check_pin platform "$1/tools/tool-pins.json")
  if ! echo "$base" | grep -Eqx '[a-z0-9./-]+@sha256:[0-9a-f]{64}'; then
    echo "check-linux: tools/tool-pins.json linux-check base is not pinned by digest: '$base'" >&2
    return 1
  fi
  # The payload is linux-x64 throughout, so another platform could only build a different, broken image.
  if [ "$platform" != linux/amd64 ]; then
    echo "check-linux: tools/tool-pins.json linux-check platform must be linux/amd64, not '$platform'" >&2
    return 1
  fi
  echo "sharpladder check-linux inputs v1"
  for p in $inputs; do
    if [ -L "$1/$p" ] || [ ! -f "$1/$p" ]; then
      echo "check-linux: missing input $p" >&2
      return 1
    fi
    printf '%s  %s\n' "$(sha256sum < "$1/$p" | cut -c1-64)" "$p"
  done
  printf 'base %s\nplatform %s\nbuild-arg BASE=%s\nbuild-arg PLATFORM=%s\n' "$base" "$platform" "$base" "$platform"
}

# archive_inputs <commit> <dir>: the committed inputs only, so working-tree edits never reach the identity.
# Extracted through stdin because Git for Windows' tar reads C:/ in an archive name as a remote host.
archive_inputs() {
  a=$1
  d=$2
  set --
  for p in $inputs; do set -- "$@" "$p"; done
  git -c core.autocrlf=false archive --format=tar -o "$d.tar" "$a" -- "$@" &&
    tar -xf - -C "$d" < "$d.tar" &&
    rm "$d.tar"
}

# pin_asset <pins file> <tool> <key>: a linux-x64 asset field, read with a real JSON parser.
pin_asset() {
  python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]]["assets"]["linux-x64"][sys.argv[3]])' "$@"
}

# payload_manifest: path, type, mode and link target of every entry, then the SHA-256 of every file.
payload_manifest() {
  set --
  for p in $payload; do set -- "$@" "$p"; done
  find "$@" -printf '%y %m %p %l\n' | LC_ALL=C sort
  find "$@" -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
}

# install-tools.mjs needs a Node to start, so the first one comes from the same pin it installs.
# The checksum override lets the self-test exercise rejection without touching the repository's pins.
bootstrap_node() {
  dir=$HOME/bootstrap-node
  url=$(pin_asset tools/tool-pins.json node url) || return 1
  sum=${1:-$(pin_asset tools/tool-pins.json node sha256)} || return 1
  case "$url" in
    https://nodejs.org/dist/*) ;;
    *)
      echo "unexpected node url: $url"
      return 1
      ;;
  esac
  curl -fsSL -o /tmp/node.tar.xz "$url" || return 1
  # The markers are the self-test's evidence that the download completed and the checksum, not something else, stopped it.
  echo "bootstrap-node: download complete"
  if ! echo "$sum  /tmp/node.tar.xz" | sha256sum -c -; then
    echo "bootstrap-node: checksum rejected"
    rm -f /tmp/node.tar.xz
    return 1
  fi
  mkdir -p "$dir" &&
    tar -xJf /tmp/node.tar.xz -C "$dir" --strip-components=1 &&
    rm /tmp/node.tar.xz &&
    "$dir/bin/node" --version
}

# Image build, root part: PowerShell from its pin, and the unprivileged user the checks run as.
build_root() {
  pins=$state/inputs/tools/tool-pins.json
  url=$(pin_asset "$pins" pwsh url)
  sum=$(pin_asset "$pins" pwsh sha256)
  case "$url" in
    https://github.com/PowerShell/PowerShell/releases/download/*) ;;
    *)
      echo "unexpected pwsh url: $url"
      exit 1
      ;;
  esac
  curl -fsSL -o /tmp/pwsh.tar.gz "$url"
  # Explicit, so the archive is never extracted on a mismatch even if this ever runs as a condition.
  echo "$sum  /tmp/pwsh.tar.gz" | sha256sum -c - > /dev/null || exit 1
  mkdir -p /opt/pwsh
  tar -xzf /tmp/pwsh.tar.gz -C /opt/pwsh
  chmod 755 /opt/pwsh/pwsh
  ln -s /opt/pwsh/pwsh /usr/local/bin/pwsh
  rm /tmp/pwsh.tar.gz
  useradd -m -s /bin/sh runner
  echo "runner ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/runner
}

# Image build, user part: the verified installers at the clone path the checks use, since a venv is not relocatable.
build_user() {
  mkdir "$HOME/repo"
  cp -R "$state/inputs/." "$HOME/repo/"
  cd "$HOME/repo"
  bootstrap_node
  "$HOME/bootstrap-node/bin/node" tools/install-tools.mjs
  .tools/node/bin/node tools/install-psscriptanalyzer.mjs
  rm -rf "$HOME/bootstrap-node" "$HOME/.cache"
}

# Image build, sealing: record the payload and inputs, then keep the pristine tools outside any clone.
build_seal() {
  for p in $payload; do
    if [ ! -e "$p" ] && [ ! -L "$p" ]; then
      echo "build-seal: $p was not installed"
      exit 1
    fi
  done
  payload_manifest > "$state/payload.manifest"
  mv "$runner_home/repo/.tools" "$state/tools"
  rm -rf "$runner_home/repo"
  dpkg-query -W -f '${Package} ${Version}\n' | LC_ALL=C sort > "$state/apt-versions.txt"
  input_manifest "$state/inputs" > "$state/inputs.manifest"
  sha256sum < "$state/inputs.manifest" | cut -c1-64 > "$state/inputs.sha256"
}

is_image_id() {
  echo "$1" | grep -Eqx 'sha256:[0-9a-f]{64}'
}

# build_image: the base by digest, then the image from the archived inputs; --rebuild also reruns apt.
build_image() {
  set --
  [ "$mode" != rebuild ] || set -- --no-cache
  docker image inspect "$base" > /dev/null 2>&1 || docker pull -q --platform "$platform" "$base" || return 1
  rm -f "$log_dir/image.iid"
  MSYS_NO_PATHCONV=1 docker build "$@" --platform "$platform" --provenance=false --sbom=false \
    --build-arg "BASE=$base" --build-arg "PLATFORM=$platform" --label "$label=$hash" \
    --iidfile "$out/image.iid" -f "$ctx_m/tools/linux-check/Dockerfile" "$ctx_m"
}

# container <self-test 0|1> <log folder> [docker run options]: the recorded image ID, never a tag.
container() {
  st=$1
  logs=$2
  shift 2
  # The container clones the read-only .git, so uncommitted changes in the working tree never leak in.
  MSYS_NO_PATHCONV=1 docker run --rm --name "$name" "$@" -v "$git_dir:/src.git:ro" -v "$logs:/out" \
    -e SHA="$sha" -e INPUT_HASH="$hash" -e KEEP_GOING="${KEEP_GOING:-0}" -e SELF_TEST="$st" \
    "$id" sh "$state/inputs/tools/check-linux.sh" --enter
}

# Host side: select or build the image for the commit's inputs, then run the checks in it.
outer() {
  mode=run
  case "${1:-}" in
    --rebuild | --self-test | --offline-prepare | --inputs-hash)
      mode=${1#--}
      shift
      ;;
  esac
  root=$(git rev-parse --show-toplevel)
  cd "$root" || exit 1
  rev=${1:-HEAD}
  sha=$(git rev-parse --verify "$rev^{commit}")
  git_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd)
  # A fresh folder per run keeps an earlier run's logs from passing for this one without deleting anything,
  # and a link anywhere on the way could send the logs, and the container's writes, outside the repository.
  for d in "$root/.tools" "$root/.tools/check-linux" "$root/.tools/check-linux/images"; do
    if [ -L "$d" ]; then
      echo "check-linux: refusing, $d is a symlink or junction"
      exit 1
    fi
    [ -d "$d" ] || mkdir "$d"
  done
  out=$root/.tools/check-linux/$(date +%Y%m%d-%H%M%S)-$(echo "$sha" | cut -c1-12)-$$
  mkdir "$out"
  if [ -L "$out" ] || [ "$(cd "$out" && pwd -P)" != "$(pwd -P)/.tools/check-linux/${out##*/}" ]; then
    echo "check-linux: refusing, $out does not resolve under the repository"
    exit 1
  fi
  log_dir=$out
  ctx=$out/inputs
  mkdir "$ctx"
  if ! archive_inputs "$sha" "$ctx" || ! input_manifest "$ctx" > "$out/inputs.manifest"; then
    echo "check-linux: the inputs of $sha are missing or invalid"
    exit 1
  fi
  hash=$(sha256sum < "$out/inputs.manifest" | cut -c1-64)
  if [ "$mode" = inputs-hash ]; then
    cat "$out/inputs.manifest"
    echo "inputs $hash"
    exit 0
  fi
  evidence=$root/.tools/check-linux/images/$hash
  tag=sharpladder-check-linux:$(echo "$hash" | cut -c1-16)
  ctx_m=$ctx
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      git_dir=$(cygpath -m "$git_dir")
      out=$(cygpath -m "$out")
      ctx_m=$(cygpath -m "$ctx")
      ;;
  esac
  # Unique per commit and process so parallel runs never collide.
  name="sharpladder-check-linux-$(echo "$sha" | cut -c1-12)-$$"
  echo "check-linux: $sha, inputs $hash"
  start=$(date +%s)

  id=
  if [ "$mode" != rebuild ] && [ -f "$evidence" ] && [ ! -L "$evidence" ]; then
    id=$(cat "$evidence")
    got=
    tagged=
    if is_image_id "$id"; then
      # The label only has to agree; the recorded ID from a successful build is what binds image to inputs.
      got=$(docker image inspect --format "{{.Id}} {{index .Config.Labels \"$label\"}}" "$id" 2> /dev/null || :)
      tagged=$(docker image inspect --format '{{.Id}}' "$tag" 2> /dev/null || :)
    fi
    if [ "$got" != "$id $hash" ] || [ "$tagged" != "$id" ]; then
      echo "check-linux: evidence for $id no longer matches the image store; rebuilding"
      id=
    fi
  fi
  if [ -n "$id" ]; then
    echo "check-linux: reusing image $id (build skipped)"
    built=reused
  else
    t=$(date +%s)
    echo "check-linux: building the image ($tag)"
    if ! build_image > "$log_dir/build.log" 2>&1 || ! id=$(cat "$log_dir/image.iid") || ! is_image_id "$id"; then
      tail -n 40 "$log_dir/build.log"
      echo "check-linux: image build failed; nothing recorded; logs in $log_dir"
      exit 1
    fi
    echo "check-linux: built image $id in $(($(date +%s) - t))s"
    built=built
  fi
  printf 'image %s (%s)\ninputs %s\nplatform %s\nbase %s\ncommit %s\n' "$id" "$built" "$hash" "$platform" \
    "$base" "$sha" > "$log_dir/run-info.txt"

  if [ "$built" = built ]; then
    mkdir "$log_dir/validate"
    if ! container 0 "$out/validate" --network none -e PREPARE_ONLY=1; then
      echo "check-linux: the new image failed its offline preparation; nothing recorded; logs in $log_dir/validate"
      exit 1
    fi
    # Published only now, so a failed build or validation never leaves a record that could be reused.
    docker tag "$id" "$tag"
    echo "$id" > "$evidence.tmp-$$"
    mv "$evidence.tmp-$$" "$evidence"
    echo "check-linux: recorded $id for inputs $hash"
  fi
  rc=0
  case "$mode" in
    offline-prepare) [ "$built" = built ] || container 0 "$out" --network none -e PREPARE_ONLY=1 || rc=$? ;;
    self-test) container 1 "$out" || rc=$? ;;
    *) container 0 "$out" || rc=$? ;;
  esac
  echo "check-linux: logs in $log_dir"
  echo "check-linux: exit $rc after $(($(date +%s) - start))s"
  exit "$rc"
}

case "${1:-}" in
  --build-root)
    build_root
    exit 0
    ;;
  --build-user)
    build_user
    exit 0
    ;;
  --build-seal)
    build_seal
    exit 0
    ;;
  --enter | --inner) ;;
  *)
    outer "$@"
    ;;
esac

summary=/tmp/summary.txt
[ "$1" = --inner ] || : > "$summary"
failed=0
# Copies logs out on every exit, so a failed step's log survives the early exit below.
trap 'cp /tmp/step-*.log /out/ 2> /dev/null || true' EXIT
# A step runs as an if condition, where set -e is off: step functions must return on each failure themselves.
step() {
  label=$1
  shift
  log=/tmp/step-$(echo "$label" | tr -c 'a-z0-9\n' '-').log
  t=$(date +%s)
  if "$@" > "$log" 2>&1; then
    res=ok
  else
    res=FAIL
  fi
  line="STEP $label: $res ($(($(date +%s) - t))s)"
  echo "$line"
  echo "$line" >> "$summary"
  if [ "$res" = FAIL ]; then
    echo "---- last 40 lines of $label ----"
    tail -n 40 "$log"
    echo "---- FAIL lines ----"
    grep -E '^(FAIL|not ok)| FAIL ' "$log" | head -n 40 || true
    failed=$((failed + 1))
    # The exit stays non-zero either way; KEEP_GOING only trades speed for a full report.
    [ "$KEEP_GOING" = 1 ] || exit 1
  fi
}

if [ "$1" = --enter ]; then
  cd "$HOME"
  clone() {
    git config --global --add safe.directory /src.git &&
      git clone -q /src.git repo &&
      git -C repo checkout -q --detach "$SHA" &&
      test "$(git -C repo rev-parse HEAD)" = "$SHA"
  }
  # The image's record is not proof of origin; the host's expected hash and the clean clone must agree with it.
  verify_inputs() {
    if [ -n "$(git -C "$HOME/repo" status --porcelain)" ]; then
      echo "the clone is not clean"
      return 1
    fi
    input_manifest "$HOME/repo" > /tmp/inputs.manifest || return 1
    got=$(sha256sum < /tmp/inputs.manifest | cut -c1-64)
    echo "clone inputs $got"
    if [ "$got" != "$INPUT_HASH" ] || [ "$got" != "$(cat "$state/inputs.sha256")" ]; then
      echo "inputs differ: expected $INPUT_HASH, image built from $(cat "$state/inputs.sha256")"
      return 1
    fi
  }
  # Preparation failures always stop the run; KEEP_GOING applies to the checks only.
  keep=$KEEP_GOING
  KEEP_GOING=0
  step clone clone
  step inputs verify_inputs
  KEEP_GOING=$keep
  # The candidate's checked-in runner, now proven identical to the one the image was built with.
  exec sh "$HOME/repo/tools/check-linux.sh" --inner
fi

cd "$HOME/repo"
if [ "${SELF_TEST:-0}" = 1 ]; then
  KEEP_GOING=1
  step bootstrap-node-bad-checksum bootstrap_node 0000000000000000000000000000000000000000000000000000000000000000
  log=/tmp/step-bootstrap-node-bad-checksum.log
  if ! grep -q '^STEP bootstrap-node-bad-checksum: FAIL' "$summary"; then
    echo "self-test: FAIL (the step passed with a bad checksum)"
  elif ! grep -qx 'bootstrap-node: download complete' "$log"; then
    echo "self-test: FAIL (the download never completed, so the checksum mismatch was never reached)"
  elif ! grep -qx '/tmp/node.tar.xz: FAILED' "$log" || ! grep -qx 'bootstrap-node: checksum rejected' "$log"; then
    echo "self-test: FAIL (the step failed for a reason other than the checksum mismatch)"
  elif [ -e "$HOME/bootstrap-node" ] || [ -e /tmp/node.tar.xz ]; then
    echo "self-test: FAIL (something was extracted or left behind after the mismatch)"
  else
    echo "self-test: ok (download completed, sha256sum rejected it, nothing extracted)"
    exit 0
  fi
  exit 1
fi

restore() {
  if [ -e .tools ] || [ -L .tools ]; then
    echo ".tools already exists in the fresh clone"
    return 1
  fi
  cp -a "$state/tools" .tools
}
# Stamps only say what the installer meant to install; the build-time manifest says what is there.
verify_payload() {
  payload_manifest > /tmp/payload.manifest 2>&1
  if ! cmp -s "$state/payload.manifest" /tmp/payload.manifest; then
    echo "the tool payload differs from the build record (< recorded, > found):"
    diff "$state/payload.manifest" /tmp/payload.manifest | head -n 40
    return 1
  fi
  echo "payload: $(wc -l < /tmp/payload.manifest) entries match the build record"
}
# Run through PATH as tools/checks/lib.mjs runs it, so the restored venv's absolute paths are what is tested.
smoke_yamllint() {
  y=$HOME/repo/.tools/venv/bin
  test "$(env PATH="$y:$PATH" which yamllint)" = "$y/yamllint" && env PATH="$y:$PATH" yamllint --version
}
smoke_pwsh() {
  # The variable is PowerShell's, so the shell must leave it alone.
  # shellcheck disable=SC2016
  v=$(pwsh -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.ToString()') || return 1
  echo "pwsh $v from $(command -v pwsh)"
  test "$v" = "$(python3 -I -c 'import json; print(json.load(open("tools/tool-pins.json"))["pwsh"]["version"])')"
}
# Imported by version from the module path, as tools/checks/pssa.ps1 does, and made to find one rule.
smoke_pssa() {
  cat > /tmp/smoke-pssa.ps1 << 'EOF'
$ErrorActionPreference = 'Stop'
$want = (Get-Content -Raw -LiteralPath 'tools/tool-pins.json' | ConvertFrom-Json).psscriptanalyzer.version
Import-Module -Name PSScriptAnalyzer -RequiredVersion $want
$m = Get-Module -Name PSScriptAnalyzer
Write-Output "PSScriptAnalyzer $($m.Version) from $($m.ModuleBase)"
if ((Invoke-ScriptAnalyzer -ScriptDefinition 'gci').RuleName -notcontains 'PSAvoidUsingCmdletAliases') { exit 1 }
EOF
  pwsh -NoProfile -NonInteractive -File /tmp/smoke-pssa.ps1
}

keep=$KEEP_GOING
KEEP_GOING=0
step restore restore
step payload verify_payload
step install-tools .tools/node/bin/node tools/install-tools.mjs
# Matches the PATH and environment CI gives the checks; tools/checks/lib.mjs adds the venv the same way.
PATH=$HOME/repo/.tools/node:$HOME/repo/.tools/node/bin:$PATH
export PATH
GITHUB_ACTIONS=true
export GITHUB_ACTIONS
step smoke-yamllint smoke_yamllint
step smoke-pwsh smoke_pwsh
step smoke-pssa smoke_pssa
KEEP_GOING=$keep
cp "$state/apt-versions.txt" /out/apt-versions.txt
if [ "${PREPARE_ONLY:-0}" = 1 ]; then
  echo "==== summary ===="
  cat "$summary"
  echo "prepare: ok"
  exit 0
fi

step npm-ci sh -c 'cd web && npm ci'
step vitest-source-check sh -c 'cd web && npx vitest run source-check'
step sh-cases env REQUIRE_PARITY=1 sh tools/tests/run.sh
step check-sh sh tools/check.sh
step vitest-accept sh -c 'cd web && npm test'
step build-verbose sh -c 'cd web && npm run build'

echo "==== summary ===="
cat "$summary"
esc=$(printf '\033')
for f in /tmp/step-*.log; do
  sed "s/$esc\[[0-9;]*m//g" "$f" | grep -hE '^ *(Test Files|Tests) ' | sed "s|^|$(basename "$f" .log): |" || true
done
grep -cE '^PASS' /tmp/step-sh-cases.log | sed 's/^/sh-cases PASS lines: /' || true
grep -cE '^SKIP' /tmp/step-sh-cases.log | sed 's/^/sh-cases SKIP lines: /' || true
tail -n 3 /tmp/step-sh-cases.log
grep -cE '^PASS' /tmp/step-check-sh.log | sed 's/^/check.sh PASS lines: /' || true
grep -E '^(SKIP|WARN)' /tmp/step-check-sh.log || true
[ "$failed" = 0 ] || {
  echo "$failed step(s) failed"
  exit 1
}
