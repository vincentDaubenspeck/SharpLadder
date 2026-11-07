# Tests for the commit-msg hook and the repository checks.
# Same cases as tools/tests/run.sh.
# Builds a throwaway git repository, installs the tracked hooks there and checks:
#   a. Bad commit subjects are rejected by tools/hooks/commit-msg
#   b. Good commit subjects pass
#   c. CRLF line endings and a missing final newline fail the encoding check; lock files are exempt
#   d. tools/checks/text.ps1 and text.sh give the same result on each fixture
#   e. Suppression-reason fixtures from tools/tests/fixtures.mjs, per language
#   f. Missing tools fail, and failures reach check.ps1, check.sh and pre-push
#   g. Licence allowlist and override record cases, and a disallowed licence through check.ps1 and check.sh
#   h. .NET config: SDK pin, props evaluation, digest cases and the probe build
#   i. C# cases (tools/tests/csharp-cases.mjs): suppression fixtures, nuget vulnerabilities and licences, no SDK
#   j. npm audit cases (tools/tests/npm-audit-cases.mjs): a low-severity advisory fails the audit
#   k. Content cases (tools/tests/content-cases.mjs): golden digest, compile errors, empty input,
#      full-path arguments, output containment, no partial output, schema setup errors, no SDK
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/tests/run.ps1
# Parts h, i and k need the pinned .NET SDK and nuget.org. Parts d, f and g need sh; set REQUIRE_PARITY=1 to fail instead of skipping.
$ErrorActionPreference = 'Stop'

$started = Get-Date
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
function Write-NoSh([string]$label) {
  if ($env:REQUIRE_PARITY -eq '1') { Write-Fail "$label (no sh)" }
  else { Write-Output "SKIP $label (no sh)"; $script:skipped++ }
}

# Runs a program; returns exit code and merged output. $path replaces PATH when given.
function Invoke-Program([string]$file, [string[]]$argList, [string]$dir = $repo, [string]$path) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo($file)
  $psi.Arguments = ($argList | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.UseShellExecute = $false; $psi.WorkingDirectory = $dir
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  if ($path) { $psi.EnvironmentVariables['PATH'] = $path }
  $proc = [Diagnostics.Process]::Start($psi)
  $errTask = $proc.StandardError.ReadToEndAsync()
  $out = $proc.StandardOutput.ReadToEnd()
  $proc.WaitForExit()
  return [pscustomobject]@{
    Code = $proc.ExitCode; Out = $out; Err = $errTask.Result
    All = ($out + $errTask.Result) -replace "`r", ''
  }
}

function Write-Text([string]$rel, [string]$text) {
  [IO.File]::WriteAllText((Join-Path -Path $repo -ChildPath $rel), $text, $noBom)
}

function Copy-FromSource([string[]]$rel) {
  foreach ($f in $rel) {
    Copy-Item -LiteralPath (Join-Path -Path $src -ChildPath $f) -Destination (Join-Path -Path $repo -ChildPath $f)
  }
}

# Keep the user's and the system's git configuration out of the test.
New-Item -ItemType Directory -Path (Join-Path -Path $repo -ChildPath 'tools/hooks') | Out-Null
New-Item -ItemType Directory -Path (Join-Path -Path $repo -ChildPath 'tools/checks') | Out-Null
[IO.File]::WriteAllText((Join-Path -Path $tmp -ChildPath 'gitconfig'), '', $noBom)
$env:GIT_CONFIG_GLOBAL = Join-Path -Path $tmp -ChildPath 'gitconfig'
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_AUTHOR_NAME = 'Test'; $env:GIT_AUTHOR_EMAIL = 'test@example.invalid'
$env:GIT_COMMITTER_NAME = 'Test'; $env:GIT_COMMITTER_EMAIL = 'test@example.invalid'

# The pinned tools from tools/install-tools.mjs, when installed, go first.
foreach ($d in @('.tools/venv/bin', '.tools/venv/Scripts', '.tools/node/bin', '.tools/node', '.tools/bin')) {
  $full = Join-Path -Path $src -ChildPath $d
  if (Test-Path -LiteralPath $full -PathType Container) {
    $env:PATH = $full + [IO.Path]::PathSeparator + $env:PATH
  }
}
$node = Get-Command -Name node -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty Source

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
  Copy-FromSource @('.gitattributes', 'tools/checks/text.sh', 'tools/checks/text.ps1',
    'tools/forbidden-phrases.txt', 'tools/hooks/commit-msg')
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

  # Runs text.ps1, then text.sh for parity; keeps the text.ps1 output in $script:out.
  function Test-Check([string]$label, [int]$want) {
    $r = Invoke-Program $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/checks/text.ps1')
    $script:out = $r.All
    if ($r.Code -eq $want) { Write-Pass "text.ps1 $label (exit $($r.Code))" }
    else { Write-Fail "text.ps1 $label (exit $($r.Code))" }
    if (-not $sh) { Write-NoSh "parity $label"; return }
    $s = Invoke-Program $sh @('tools/checks/text.sh')
    if ($s.Code -eq $r.Code -and $s.All -ceq $script:out) { Write-Pass "parity $label" }
    else {
      Write-Fail "parity $label (text.ps1 exit $($r.Code), text.sh exit $($s.Code))"
      Write-Output $script:out; Write-Output $s.All
    }
  }

  Test-Check 'clean tree' 0

  Write-Text 'crlf.txt' "one`r`ntwo`r`n"
  [void](Invoke-Program 'git' @('add', 'crlf.txt'))
  Test-Check 'CRLF file' 1
  if ($script:out -cmatch '(?m)^  crlf\.txt: CRLF line endings$') {
    Write-Pass 'text.ps1 names the CRLF file'
  } else { Write-Fail 'text.ps1 names the CRLF file' }
  [void](Invoke-Program 'git' @('rm', '-q', '--cached', 'crlf.txt'))
  Remove-Item -LiteralPath (Join-Path -Path $repo -ChildPath 'crlf.txt')

  Write-Text 'tail.txt' 'no final newline'
  [void](Invoke-Program 'git' @('add', 'tail.txt'))
  Test-Check 'missing final newline' 1
  if ($script:out -cmatch '(?m)^  tail\.txt: no final newline$') {
    Write-Pass 'text.ps1 names the file without a final newline'
  } else { Write-Fail 'text.ps1 names the file without a final newline' }
  [void](Invoke-Program 'git' @('rm', '-q', '--cached', 'tail.txt'))
  Remove-Item -LiteralPath (Join-Path -Path $repo -ChildPath 'tail.txt')

  # Only a file named exactly packages.lock.json may end without a newline.
  New-Item -ItemType Directory -Path (Join-Path -Path $repo -ChildPath 'lock') | Out-Null
  Write-Text 'lock/packages.lock.json' '{}'
  [void](Invoke-Program 'git' @('add', 'lock/packages.lock.json'))
  Test-Check 'lock file without a final newline' 0
  Write-Text 'lock/other.lock.json' '{}'
  [void](Invoke-Program 'git' @('add', 'lock/other.lock.json'))
  Test-Check 'other name without a final newline' 1
  if ($script:out -cmatch '(?m)^  lock/other\.lock\.json: no final newline$') {
    Write-Pass 'text.ps1 exempts only packages.lock.json'
  } else { Write-Fail 'text.ps1 exempts only packages.lock.json' }
  [void](Invoke-Program 'git' @('rm', '-q', '-r', '--cached', 'lock'))
  Remove-Item -LiteralPath (Join-Path -Path $repo -ChildPath 'lock') -Recurse

  # Shell and PowerShell report a named stage; ESLint reports by exit code.
  $fx = Join-Path -Path $tmp -ChildPath 'fx'
  if (-not $node) { Write-Fail 'suppression fixtures (no node)' }
  else {
    $m = Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/tests/fixtures.mjs'), $fx)
    foreach ($line in ($m.Out -split "`r?`n" | Where-Object { $_ -ne '' })) {
      $lang, $want, $file, $label = $line -split "`t"
      # The C# fixtures need a build; tools/tests/csharp-cases.mjs runs them.
      if ($lang -eq 'cs') { continue }
      $dir = Join-Path -Path $fx -ChildPath $lang
      switch ($lang) {
        'js' {
          $r = Invoke-Program $node @((Join-Path -Path $src -ChildPath 'web/lint-comments.js'), $file) -dir $dir
          $got = if ($r.Code -eq 0) { 'pass' } else { 'fail' }
        }
        'sh' {
          $r = Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/checks/shell.mjs'), $file) -dir $dir
          $got = if ($r.All -cmatch '(?m)^PASS shell suppression reasons$') { 'pass' } else { 'fail' }
        }
        'ps' {
          $r = Invoke-Program $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            (Join-Path -Path $src -ChildPath 'tools/checks/ps-suppressions.ps1'), $file) -dir $dir
          $got = if ($r.Code -eq 0) { 'pass' } else { 'fail' }
        }
        'lic' {
          $r = Invoke-Program $node @((Join-Path -Path $src -ChildPath 'web/license-check.js')) -dir (Join-Path -Path $dir -ChildPath $file)
          $got = if ($r.Code -eq 0) { 'pass' } else { 'fail' }
        }
        'ovr' {
          $r = Invoke-Program $node @((Join-Path -Path $src -ChildPath 'web/dependency-overrides-check.js')) -dir (Join-Path -Path $dir -ChildPath $file)
          $got = if ($r.Code -eq 0) { 'pass' } else { 'fail' }
        }
      }
      if ($got -eq $want) { Write-Pass "$lang ${want}: $label" }
      else { Write-Fail "$lang ${want}: $label (got $got)"; Write-Output $r.All }
    }
    $r = Invoke-Program $node @('license-check.js') -dir (Join-Path -Path $src -ChildPath 'web')
    if ($r.Code -eq 0) { Write-Pass 'lic pass: current tree' }
    else { Write-Fail 'lic pass: current tree'; Write-Output $r.All }
    $r = Invoke-Program $node @('dependency-overrides-check.js') -dir (Join-Path -Path $src -ChildPath 'web')
    if ($r.Code -eq 0) { Write-Pass 'ovr pass: current tree' }
    else { Write-Fail 'ovr pass: current tree'; Write-Output $r.All }
    foreach ($case in @(@('pass', 'good.ps1'), @('fail', 'missing.ps1'))) {
      $want, $file = $case
      $r = Invoke-Program $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        (Join-Path -Path $src -ChildPath 'tools/checks/ps-suppressions.ps1'),
        (Join-Path -Path $fx -ChildPath "ps/$file"))
      $got = if ($r.Code -eq 0) { 'pass' } else { 'fail' }
      if ($got -eq $want) { Write-Pass "ps ${want}: absolute path to $file" }
      else { Write-Fail "ps ${want}: absolute path to $file (got $got)"; Write-Output $r.All }
    }
  }

  New-Item -ItemType Directory -Path (Join-Path -Path $repo -ChildPath 'web') | Out-Null
  Copy-FromSource @('tools/check.sh', 'tools/check.ps1', 'tools/checks/lib.mjs', 'tools/checks/run.mjs',
    'tools/checks/shell.mjs', 'tools/checks/dotnet.mjs', 'tools/checks/csharp.mjs', 'tools/checks/content.mjs',
    'tools/checks/web.mjs', 'tools/checks/ps-suppressions.ps1', 'tools/checks/pssa.ps1', 'tools/hooks/pre-push',
    'web/package.json', 'web/.nvmrc', 'web/.licensee.json', 'global.json', 'Directory.Build.props', 'Directory.Packages.props')
  # An unavailable PSScriptAnalyzer version stands in for a missing module.
  $pins = [IO.File]::ReadAllText((Join-Path -Path $src -ChildPath 'tools/tool-pins.json'))
  Write-Text 'tools/tool-pins.json' ($pins -replace '"version": "1\.25\.0"', '"version": "0.0.0"')
  Copy-Item -LiteralPath (Join-Path -Path $fx -ChildPath 'sh/missing.sh') -Destination (Join-Path -Path $repo -ChildPath 'bad.sh')
  Copy-Item -LiteralPath (Join-Path -Path $fx -ChildPath 'sh/missing.sh') -Destination (Join-Path -Path $repo -ChildPath 'web/x.sh')
  [void](Invoke-Program 'git' @('add', '-A'))
  [void](Invoke-Program 'git' @('commit', '-q', '-m', 'Add the propagation fixture files'))

  $empty = Join-Path -Path $tmp -ChildPath 'empty'
  New-Item -ItemType Directory -Path $empty | Out-Null
  if ($node) {
    $r = Invoke-Program $node @('tools/checks/shell.mjs', 'bad.sh') -dir $repo -path $empty
    if ($r.All -cmatch '(?m)^  shfmt not found' -and $r.All -cmatch '(?m)^FAIL shell suppression reasons$') {
      Write-Pass 'missing shfmt fails'
    } else { Write-Fail 'missing shfmt fails'; Write-Output $r.All }
    # This repository has no .tools, so an empty PATH leaves no SDK at all.
    $r = Invoke-Program $node @('tools/checks/dotnet.mjs') -dir $repo -path $empty
    $lines = $r.All -split "`n"
    if ($lines -ccontains '  dotnet not found; install the pinned tools with: node tools/install-tools.mjs' -and
      $lines -ccontains 'FAIL .NET config') { Write-Pass 'missing .NET SDK fails' }
    else { Write-Fail 'missing .NET SDK fails'; Write-Output $r.All }
  }
  $sdkPin = '  global.json SDK 10.0.402 differs from tools/tool-pins.json 10.0.403'
  $globalJson = [IO.File]::ReadAllText((Join-Path -Path $src -ChildPath 'global.json'))
  Write-Text 'global.json' ($globalJson -replace '"10\.0\.403"', '"10.0.402"')

  $r = Invoke-Program $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/check.ps1')
  foreach ($want in @('FAIL shell suppression reasons', '  web/node_modules not found; run npm ci in web/',
      $sdkPin, '  PSScriptAnalyzer 0.0.0 not found; install it with:',
      '  web/x.sh:2: shellcheck directive needs a reason comment on the line above',
      '  needs .NET config (see above)', 'FAIL nuget vulnerabilities', 'FAIL nuget licences')) {
    $lines = $r.All -split "`n"
    if ($r.Code -ne 0 -and $lines -ccontains $want) { Write-Pass "check.ps1 exit $($r.Code) with: $want" }
    else { Write-Fail "check.ps1 exit $($r.Code) with: $want" }
  }
  if (-not $sh) {
    Write-NoSh 'check.sh propagates a failure'
    Write-NoSh 'check.sh fails a global.json that differs from the SDK pin'
    Write-NoSh 'pre-push blocks on a failed check'
  } else {
    $s = Invoke-Program $sh @('tools/check.sh')
    if ($s.Code -ne 0 -and ($s.All -split "`n") -ccontains 'FAIL shell suppression reasons') {
      Write-Pass "check.sh propagates a failure (exit $($s.Code))"
    } else { Write-Fail "check.sh propagates a failure (exit $($s.Code))" }
    if ($s.Code -ne 0 -and ($s.All -split "`n") -ccontains $sdkPin) {
      Write-Pass "check.sh fails a global.json that differs from the SDK pin (exit $($s.Code))"
    } else { Write-Fail "check.sh fails a global.json that differs from the SDK pin (exit $($s.Code))" }
    $h = Invoke-Program $sh @('tools/hooks/pre-push')
    if ($h.Code -ne 0 -and $h.All -cmatch '(?m)^pre-push: tools/check\.sh failed; push blocked$') {
      Write-Pass "pre-push blocks on a failed check (exit $($h.Code))"
    } else { Write-Fail "pre-push blocks on a failed check (exit $($h.Code))" }
  }

  # With web/node_modules present the web stages run, so a disallowed licence reaches both entry points.
  if ($node) {
    Copy-Item -Path (Join-Path -Path $fx -ChildPath 'prop/*') -Destination $repo -Recurse -Force
    $r = Invoke-Program $psExe @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/check.ps1')
    $lines = $r.All -split "`n"
    if ($r.Code -ne 0 -and $lines -ccontains 'FAIL licence allowlist' -and $lines -ccontains '  fx-gpl@1.0.0') {
      Write-Pass "check.ps1 fails a disallowed licence (exit $($r.Code))"
    } else { Write-Fail "check.ps1 fails a disallowed licence (exit $($r.Code))"; Write-Output $r.All }
    if (-not $sh) { Write-NoSh 'check.sh fails a disallowed licence' }
    else {
      $s = Invoke-Program $sh @('tools/check.sh')
      $lines = $s.All -split "`n"
      if ($s.Code -ne 0 -and $lines -ccontains 'FAIL licence allowlist' -and $lines -ccontains '  fx-gpl@1.0.0') {
        Write-Pass "check.sh fails a disallowed licence (exit $($s.Code))"
      } else { Write-Fail "check.sh fails a disallowed licence (exit $($s.Code))"; Write-Output $s.All }
    }
  }

  # Adds a Node case script's PASS and FAIL lines to the totals.
  function Add-CaseLine([string]$label, $result) {
    $lines = $result.All -split "`n"
    $p = @($lines | Where-Object { $_ -clike 'PASS *' }).Count
    $f = @($lines | Where-Object { $_ -clike 'FAIL *' }).Count
    $lines | Where-Object { $_ -cmatch '^(PASS|FAIL|  )' } | Write-Output
    $script:passed += $p
    $script:failed += $f
    if ($result.Code -ne 0 -and $f -eq 0) { Write-Fail "$label (exit $($result.Code))" }
    if ($p -eq 0 -and $f -eq 0) { Write-Fail "$label (no cases ran)" }
  }

  if (-not $node) { Write-Fail '.NET config (no node)' }
  else {
    Add-CaseLine 'digest cases' (Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/tests/digest-cases.mjs')) -dir $src)

    $r = Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/checks/dotnet.mjs'), $src) -dir $src
    if ($r.Code -eq 0 -and ($r.All -split "`n") -ccontains 'PASS .NET config') {
      Write-Pass '.NET config passes on the repository'
    } else { Write-Fail '.NET config passes on the repository'; Write-Output $r.All }

    $malformedProps = Join-Path -Path $tmp -ChildPath 'malformed'
    New-Item -ItemType Directory -Path $malformedProps | Out-Null
    foreach ($f in @('global.json', 'Directory.Packages.props')) {
      Copy-Item -LiteralPath (Join-Path -Path $src -ChildPath $f) -Destination $malformedProps
    }
    $props = [IO.File]::ReadAllText((Join-Path -Path $src -ChildPath 'Directory.Build.props'))
    [IO.File]::WriteAllText((Join-Path -Path $malformedProps -ChildPath 'Directory.Build.props'),
      ($props -replace '</Project>', ''), $noBom)
    $r = Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/checks/dotnet.mjs'), $malformedProps) -dir $src
    if ($r.Code -ne 0 -and ($r.All -split "`n") -ccontains '  Directory.Build.props does not evaluate') {
      Write-Pass ".NET config fails a malformed Directory.Build.props (exit $($r.Code))"
    } else { Write-Fail ".NET config fails a malformed Directory.Build.props (exit $($r.Code))"; Write-Output $r.All }

    Add-CaseLine 'dotnet probe' (Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/tests/dotnet-probe.mjs'),
        (Join-Path -Path $tmp -ChildPath 'dn')) -dir $src)

    Add-CaseLine 'C# cases' (Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/tests/csharp-cases.mjs'),
        (Join-Path -Path $tmp -ChildPath 'csharp')) -dir $src)

    Add-CaseLine 'content cases' (Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/tests/content-cases.mjs'),
        (Join-Path -Path $tmp -ChildPath 'content')) -dir $src)
  }

  if (-not $node) { Write-Fail 'npm audit cases (no node)' }
  else {
    Add-CaseLine 'npm audit cases' (Invoke-Program $node @((Join-Path -Path $src -ChildPath 'tools/tests/npm-audit-cases.mjs'),
        (Join-Path -Path $tmp -ChildPath 'audit')) -dir $src)
  }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$secs = [int]((Get-Date) - $started).TotalSeconds
Write-Output "$($script:passed) passed, $($script:failed) failed, $($script:skipped) skipped in ${secs}s"
if ($script:failed -ne 0) { exit 1 }
exit 0
