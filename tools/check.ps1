# Repository checks for Windows PowerShell.
# Runs the same components as tools/check.sh:
#   1. Text rules (tools/checks/text.ps1): phrases, encoding, HEAD commit message
#   2. Tool checks (tools/checks/run.mjs): web, shell, PowerShell, EditorConfig, YAML, .NET config,
#      .NET build and tests, C# suppression reasons, nuget vulnerabilities, nuget licences, content,
#      alias retention
$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { exit 1 }
Set-Location $root

$status = 0
& (Join-Path $root 'tools/checks/text.ps1')
if ($LASTEXITCODE -ne 0) { $status = 1 }

# The Node from tools/install-tools.mjs wins over one on PATH.
$node = @('.tools/node/node.exe', '.tools/node/bin/node') |
  Where-Object { Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf } |
  Select-Object -First 1
if ($node) { $node = Join-Path $root $node }
else {
  $node = Get-Command -Name node -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty Source
}
if (-not $node) {
  Write-Output '  node not found; install the version in web/.nvmrc'
  Write-Output 'FAIL tool checks'
  $status = 1
} else {
  & $node tools/checks/run.mjs
  if ($LASTEXITCODE -ne 0) { $status = 1 }
}

exit $status
