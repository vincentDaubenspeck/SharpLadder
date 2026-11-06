$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { exit 1 }
Set-Location $root
$want = (Get-Content -Raw -LiteralPath 'tools/tool-pins.json' | ConvertFrom-Json).psscriptanalyzer.version

try { Import-Module -Name PSScriptAnalyzer -RequiredVersion $want }
catch {
  Write-Output "  PSScriptAnalyzer $want not found; install it with:"
  Write-Output "  Install-Module PSScriptAnalyzer -RequiredVersion $want -Scope CurrentUser"
  Write-Output 'FAIL PSScriptAnalyzer'
  exit 1
}
$results = @(Invoke-ScriptAnalyzer -Path tools -Recurse)
if ($results.Count -eq 0) { Write-Output 'PASS PSScriptAnalyzer'; exit 0 }
foreach ($r in $results) {
  Write-Output "  $($r.ScriptName):$($r.Line): $($r.RuleName): $($r.Message)"
}
Write-Output "FAIL PSScriptAnalyzer ($($results.Count) finding(s))"
exit 1
