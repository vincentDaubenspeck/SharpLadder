# Requires a literal, single-line Justification on every SuppressMessage attribute.
# Usage: ps-suppressions.ps1 [file...]   (default: every tracked .ps1 and .psm1 file)
# Uses the PowerShell parser and runs outside PSScriptAnalyzer, so no suppression can mute it.
param([string[]]$Path)
$ErrorActionPreference = 'Stop'

if (-not $Path -or $Path.Count -eq 0) {
  $root = (& git rev-parse --show-toplevel)
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Set-Location $root
  $Path = @(& git -c core.quotepath=off ls-files -- '*.ps1' '*.psm1')
}

$suppressType = [System.Diagnostics.CodeAnalysis.SuppressMessageAttribute]

$frameworkNames = @('System.Diagnostics.CodeAnalysis.SuppressMessage', 'Diagnostics.CodeAnalysis.SuppressMessage')

# PSScriptAnalyzer honours an attribute when GetReflectionAttributeType gives the framework type.
# Should that resolution fail here, the framework's own names still count, unless shadowed locally.
function Test-IsSuppression([System.Management.Automation.Language.AttributeAst]$attr, [string[]]$usings, [string[]]$classes) {
  $resolved = $null
  try { $resolved = $attr.TypeName.GetReflectionAttributeType() } catch { $resolved = $null }
  if ($resolved) { return $resolved -eq $suppressType }
  $name = $attr.TypeName.FullName -replace 'Attribute$', ''
  if ($frameworkNames -contains $name) { return $true }
  if ($name -ine 'SuppressMessage' -or $classes -contains 'SuppressMessage') { return $false }
  return $usings -contains 'System.Diagnostics.CodeAnalysis'
}

function Get-Problem([System.Management.Automation.Language.AttributeAst]$attr) {
  $named = @($attr.NamedArguments | Where-Object { $_.ArgumentName -ieq 'Justification' })
  if ($named.Count -eq 0 -or $named[0].ExpressionOmitted) { return 'missing Justification' }
  if ($named.Count -gt 1) { return 'more than one Justification' }
  $arg = $named[0].Argument
  if ($arg -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) {
    return 'Justification must be a literal string'
  }
  if ([string]::IsNullOrWhiteSpace($arg.Value)) { return 'blank Justification' }
  if ($arg.Value -match '[\r\n]') { return 'Justification must be one line' }
  return $null
}

$bad = 0
foreach ($f in $Path) {
  $tokens = $null; $errors = $null
  # .NET resolves relative paths against the process directory, not the PowerShell location.
  $full = if ([IO.Path]::IsPathRooted($f)) { [IO.Path]::GetFullPath($f) }
  else { [IO.Path]::GetFullPath((Join-Path -Path (Get-Location).ProviderPath -ChildPath $f)) }
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($full, [ref]$tokens, [ref]$errors)
  foreach ($e in $errors) {
    Write-Output "  ${f}:$($e.Extent.StartLineNumber): parse error: $($e.Message)"; $bad++
  }
  if ($errors.Count -gt 0) { continue }
  $usings = @($ast.UsingStatements | Where-Object { $_.UsingStatementKind -eq 'Namespace' } |
      ForEach-Object { $_.Name.Value })
  $classes = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.TypeDefinitionAst] }, $true) |
      ForEach-Object { $_.Name -replace 'Attribute$', '' })
  $attrs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AttributeAst] }, $true)
  foreach ($a in $attrs) {
    if (-not (Test-IsSuppression -attr $a -usings $usings -classes $classes)) { continue }
    $problem = Get-Problem $a
    if ($problem) { Write-Output "  ${f}:$($a.Extent.StartLineNumber): $problem"; $bad++ }
  }
}
if ($bad -eq 0) { Write-Output 'PASS PowerShell suppression reasons'; exit 0 }
Write-Output "FAIL PowerShell suppression reasons ($bad problem(s))"
exit 1
