#!/bin/sh
# Local Linux counterpart of tools/check.sh: runs the checks for one commit in a pinned Ubuntu container.
# Usage: sh tools/check-linux.sh [--self-test] [<commit>]   (KEEP_GOING=1 reports every step; logs land in a per-run folder under .tools/check-linux/)
# --self-test feeds the Node download a wrong checksum and passes only if sha256sum rejected the downloaded file
# and nothing was extracted.
set -eu

image=ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
# CI runners ship PowerShell preinstalled, so the repository pins no version of it; this one is checksum-verified.
pwsh_version=7.6.9
pwsh_sha256=1da6d6d6035d651f20e70ddee7c4c15ac6ab8b9fb40ee92240d91263f28a884b

if [ "${1:-}" != "--inner" ]; then
  self_test=0
  if [ "${1:-}" = "--self-test" ]; then
    self_test=1
    shift
  fi
  root=$(git rev-parse --show-toplevel)
  cd "$root" || exit 1
  rev=${1:-HEAD}
  sha=$(git rev-parse --verify "$rev^{commit}")
  git_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd)
  script=$root/tools/check-linux.sh
  # A fresh folder per run keeps an earlier run's logs from passing for this one without deleting anything,
  # and a link anywhere on the way could send the logs, and the container's writes, outside the repository.
  for d in "$root/.tools" "$root/.tools/check-linux"; do
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
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      git_dir=$(cygpath -m "$git_dir")
      script=$(cygpath -m "$script")
      out=$(cygpath -m "$out")
      ;;
  esac
  # Unique per commit and process so parallel runs never collide.
  name="sharpladder-check-linux-$(echo "$sha" | cut -c1-12)-$$"
  docker image inspect "$image" > /dev/null 2>&1 || docker pull -q "$image" > /dev/null
  echo "check-linux: $sha in $name"
  start=$(date +%s)
  set +e
  # The container clones the read-only .git, so uncommitted changes in the working tree never leak in.
  MSYS_NO_PATHCONV=1 docker run --rm --name "$name" \
    -v "$git_dir:/src.git:ro" -v "$script:/runner/check-linux.sh:ro" -v "$out:/out" \
    -e SHA="$sha" -e KEEP_GOING="${KEEP_GOING:-0}" -e SELF_TEST="$self_test" \
    "$image" sh /runner/check-linux.sh --inner
  rc=$?
  set -e
  echo "check-linux: logs in $log_dir"
  echo "check-linux: exit $rc after $(($(date +%s) - start))s"
  exit "$rc"
fi

# System packages need root; the checks then run unprivileged, as on CI's runner.
if [ "$(id -u)" = 0 ] && [ "${2:-}" != "--user" ]; then
  export DEBIAN_FRONTEND=noninteractive
  t=$(date +%s)
  apt-get update -qq > /dev/null
  apt-get install -y -qq --no-install-recommends \
    git ca-certificates curl xz-utils python3 python3-venv libicu74 libatomic1 sudo > /dev/null
  echo "STEP apt: ok ($(($(date +%s) - t))s)"

  t=$(date +%s)
  file=powershell-$pwsh_version-linux-x64.tar.gz
  curl -fsSL -o "/tmp/$file" \
    "https://github.com/PowerShell/PowerShell/releases/download/v$pwsh_version/$file"
  # Explicit, so the archive is never extracted on a mismatch even if this block ever runs as a condition.
  echo "$pwsh_sha256  /tmp/$file" | sha256sum -c - > /dev/null || exit 1
  mkdir -p /opt/pwsh
  tar -xzf "/tmp/$file" -C /opt/pwsh
  chmod 755 /opt/pwsh/pwsh
  ln -s /opt/pwsh/pwsh /usr/local/bin/pwsh
  rm "/tmp/$file"
  echo "STEP pwsh $pwsh_version (checksum verified): ok ($(($(date +%s) - t))s)"

  useradd -m -s /bin/sh runner
  echo "runner ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/runner
  exec sudo -u runner -H env SHA="$SHA" KEEP_GOING="$KEEP_GOING" SELF_TEST="${SELF_TEST:-0}" sh /runner/check-linux.sh --inner --user
fi

summary=/tmp/summary.txt
: > "$summary"
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

cd "$HOME"
clone() {
  git config --global --add safe.directory /src.git &&
    git clone -q /src.git repo &&
    git -C repo checkout -q --detach "$SHA" &&
    test "$(git -C repo rev-parse HEAD)" = "$SHA"
}
step clone clone
cd "$HOME/repo"

# install-tools.mjs needs a Node to start, so the first one comes from the same pin it installs.
# The checksum override lets the self-test exercise rejection without touching the repository's pins.
bootstrap_node() {
  dir=$HOME/bootstrap-node
  url=$(sed -n '/"linux-x64"/,/}/s/.*"url": *"\([^"]*\)".*/\1/p' tools/tool-pins.json | head -n 1)
  sum=${1:-$(sed -n '/"linux-x64"/,/}/s/.*"sha256": *"\([^"]*\)".*/\1/p' tools/tool-pins.json | head -n 1)}
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

step bootstrap-node bootstrap_node
step install-tools "$HOME/bootstrap-node/bin/node" tools/install-tools.mjs

# Matches the PATH and environment CI gives the checks.
PATH=$HOME/repo/.tools/node:$HOME/repo/.tools/node/bin:$PATH
export PATH
GITHUB_ACTIONS=true
export GITHUB_ACTIONS

pssa() {
  v=$(sed -n '/"psscriptanalyzer"/,/}/s/.*"version": *"\([^"]*\)".*/\1/p' tools/tool-pins.json)
  if [ -z "$v" ]; then
    echo "no psscriptanalyzer pin in tools/tool-pins.json"
    return 1
  fi
  pwsh -NoProfile -Command "\$ErrorActionPreference='Stop'; Install-Module -Name PSScriptAnalyzer -RequiredVersion $v -Repository PSGallery -Scope CurrentUser -Force"
}
step pssa pssa
step npm-ci sh -c 'cd web && npm ci'
step vitest-source-check sh -c 'cd web && npx vitest run source-check'
step sh-cases env REQUIRE_PARITY=1 sh tools/tests/run.sh
step check-sh sh tools/check.sh
step vitest-verbose sh -c 'cd web && npx vitest run --reporter=verbose'
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
