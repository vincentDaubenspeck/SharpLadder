#!/bin/sh
# Repository checks. Run before every commit; the pre-push hook and CI run it too.
# tools/check.ps1 runs the same components on Windows.
#   1. Text rules (tools/checks/text.sh): phrases, encoding, HEAD commit message
#   2. Tool checks (tools/checks/run.mjs): web, shell, PowerShell, EditorConfig, YAML
set -eu

root=$(git rev-parse --show-toplevel)
cd "$root" || exit 1

status=0
sh tools/checks/text.sh || status=1

# The Node from tools/install-tools.mjs wins over one on PATH.
node_bin=
for n in .tools/node/bin/node .tools/node/node.exe; do
  if [ -x "$n" ]; then
    node_bin=$n
    break
  fi
done
if [ -z "$node_bin" ] && command -v node > /dev/null 2>&1; then
  node_bin=node
fi
if [ -z "$node_bin" ]; then
  echo "  node not found; install the version in web/.nvmrc"
  echo "FAIL tool checks"
  status=1
elif ! "$node_bin" tools/checks/run.mjs; then
  status=1
fi

exit "$status"
