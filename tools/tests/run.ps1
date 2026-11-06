# Tests for the commit-msg hook and the repository checks.
# Same cases as tools/tests/run.sh.
# Builds a throwaway git repository, installs the tracked hooks there and checks:
#   a. Bad commit subjects are rejected by tools/hooks/commit-msg
#   b. Good commit subjects pass
#   c. CRLF line endings and a missing final newline fail the encoding check
#   d. tools/check.ps1 and tools/check.sh give the same result on each fixture
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/tests/run.ps1
# Part d needs sh; set REQUIRE_PARITY=1 to fail instead of skipping.
$ErrorActionPreference = 'Stop'

$src = (& git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { exit 1 }
$tmp = Join-Path -Path ([IO.Path]::GetTempPath()) -ChildPath ([Guid]::NewGuid().ToString('N'))
$repo = Join-Path -Path $tmp -ChildPath 'repo'
$noBom = New-Object System.Text.UTF8Encoding($false)

$script:passed = 0
$script:failed = 0
$script:skipped = 0
function Write-Pass([string]$label) { Write-Output "PASS $label"; $script:passed++ }
function Write-Fail([string]$label) { Write-Output "FAIL $label"; $script:failed++ }

# Runs a program in the fixture repository; returns exit code and merged output.
function Invoke-Program([string]$file, [string[]]$argList) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo($file)
  $psi.Arguments = ($argList | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.UseShellExecute = $false; $psi.WorkingDirectory = $repo
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $proc = [Diagnostics.Process]::Start($psi)
  $errTask = $proc.StandardError.ReadToEndAsync()
  $out = $proc.StandardOutput.ReadToEnd()
  $proc.WaitForExit()
  return [pscustomobject]@{ Code = $proc.ExitCode; Out = $out; Err = $errTask.Result }
}

function Write-Text([string]$rel, [string]$text) {
  [IO.File]::WriteAllText((Join-Path -Path $repo -ChildPath $rel), $text, $noBom)
}

# Keep the user's and the system's git configuration out of the test.
New-Item -ItemType Directory -Path (Join-Path -Path $repo -ChildPath 'tools/hooks') | Out-Null
[IO.File]::WriteAllText((Join-Path -Path $tmp -ChildPath 'gitconfig'), '', $noBom)
$env:GIT_CONFIG_GLOBAL = Join-Path -Path $tmp -ChildPath 'gitconfig'
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_AUTHOR_NAME = 'Test'; $env:GIT_AUTHOR_EMAIL = 'test@example.invalid'
$env:GIT_COMMITTER_NAME = 'Test'; $env:GIT_COMMITTER_EMAIL = 'test@example.invalid'

$sh = Get-Command -Name sh -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty Source
if (-not $sh) {
  # Git for Windows keeps sh.exe in bin/, three levels above its exec path.
  $exec = (& git --exec-path)
  $candidate = [IO.Path]::GetFullPath((Join-Path -Path $exec -ChildPath '../../../bin/sh.exe'))
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { $sh = $candidate }
}
$psExe = (Get-Process -Id $PID).Path

try {
  # Fixture repository with the tracked checks and hooks.
  Copy-Item -LiteralPath (Join-Path -Path $src -ChildPath '.gitattributes') -Destination $repo
  foreach ($f in @('tools/check.sh', 'tools/check.ps1', 'tools/forbidden-phrases.txt',
      'tools/hooks/commit-msg')) {
    Copy-Item -LiteralPath (Join-Path -Path $src -ChildPath $f) `
      -Destination (Join-Path -Path $repo -ChildPath $f)
  }
  if ([IO.Path]::DirectorySeparatorChar -eq '/') {
    [void](Invoke-Program 'chmod' @('+x', 'tools/hooks/commit-msg'))
  }
  Write-Text 'notes.txt' "hello`n"
  [void](Invoke-Program 'git' @('init', '-q', '.'))
  [void](Invoke-Program 'git' @('config', 'core.hooksPath', 'tools/hooks'))
  [void](Invoke-Program 'git' @('update-index', '--add', '--chmod=+x', 'tools/hooks/commit-msg'))
  [void](Invoke-Program 'git' @('add', '-A'))

  function Test-Commit([string]$want, [string]$label, [string]$message) {
    Write-Text 'msg.tmp' $message
    $msgPath = Join-Path -Path $repo -ChildPath 'msg.tmp'
    $r = Invoke-Program 'git' @('commit', '-q', '--allow-empty', '-F', $msgPath)
    Remove-Item -LiteralPath $msgPath
    if ($r.Code -eq 0) { $got = 'accept' }
    elseif ($r.Err -match '(?m)^commit-msg:') { $got = 'reject' }
    else { $got = "error ($(($r.Err -split "`n")[0]))" }
    if ($got -eq $want) { Write-Pass "commit ${want}: $label" }
    else { Write-Fail "commit ${want}: $label (got $got)" }
  }

  Test-Commit -want 'accept' -label 'first commit' -message "Add fixture files for the tests`n"
  Test-Commit -want 'accept' -label '72 characters' -message ('Add ' + ('0' * 68) + "`n")
  Test-Commit -want 'reject' -label '73 characters' -message ('Add ' + ('0' * 69) + "`n")
  Test-Commit -want 'reject' -label 'trailing period' -message "Add a subject that ends in a period.`n"
  Test-Commit -want 'reject' -label 'body' -message "Add a subject with a body below`n`nThe body line.`n"
  Test-Commit -want 'reject' -label 'trailer' -message "Add a subject with a trailer below`n`nSigned-off-by: Test`n"
  Test-Commit -want 'reject' -label 'too short' -message "Fix it`n"

  # Runs check.ps1, then check.sh for parity; keeps the check.ps1 output in $script:out.
  function Test-Check([string]$label, [int]$want) {
    $r = Invoke-Program $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/check.ps1')
    $script:out = ($r.Out + $r.Err) -replace "`r", ''
    if ($r.Code -eq $want) { Write-Pass "check.ps1 $label (exit $($r.Code))" }
    else { Write-Fail "check.ps1 $label (exit $($r.Code))" }
    if (-not $sh) {
      if ($env:REQUIRE_PARITY -eq '1') { Write-Fail "parity $label (no sh)" }
      else { Write-Output "SKIP parity $label (no sh)"; $script:skipped++ }
      return
    }
    $s = Invoke-Program $sh @('tools/check.sh')
    $shOut = ($s.Out + $s.Err) -replace "`r", ''
    if ($s.Code -eq $r.Code -and $shOut -ceq $script:out) { Write-Pass "parity $label" }
    else {
      Write-Fail "parity $label (check.ps1 exit $($r.Code), check.sh exit $($s.Code))"
      Write-Output $script:out; Write-Output $shOut
    }
  }

  Test-Check 'clean tree' 0

  Write-Text 'crlf.txt' "one`r`ntwo`r`n"
  [void](Invoke-Program 'git' @('add', 'crlf.txt'))
  Test-Check 'CRLF file' 1
  if ($script:out -cmatch '(?m)^  crlf\.txt: CRLF line endings$') {
    Write-Pass 'check.ps1 names the CRLF file'
  } else { Write-Fail 'check.ps1 names the CRLF file' }
  [void](Invoke-Program 'git' @('rm', '-q', '--cached', 'crlf.txt'))
  Remove-Item -LiteralPath (Join-Path -Path $repo -ChildPath 'crlf.txt')

  Write-Text 'tail.txt' 'no final newline'
  [void](Invoke-Program 'git' @('add', 'tail.txt'))
  Test-Check 'missing final newline' 1
  if ($script:out -cmatch '(?m)^  tail\.txt: no final newline$') {
    Write-Pass 'check.ps1 names the file without a final newline'
  } else { Write-Fail 'check.ps1 names the file without a final newline' }
  [void](Invoke-Program 'git' @('rm', '-q', '--cached', 'tail.txt'))
  Remove-Item -LiteralPath (Join-Path -Path $repo -ChildPath 'tail.txt')
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "$($script:passed) passed, $($script:failed) failed, $($script:skipped) skipped"
if ($script:failed -ne 0) { exit 1 }
exit 0
