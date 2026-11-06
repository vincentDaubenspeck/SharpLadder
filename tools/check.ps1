# Repository checks for Windows PowerShell; same behaviour as tools/check.sh.
#   1. unfinished-text scan against tools/forbidden-phrases.txt
#   2. UTF-8, LF line endings and final newline on tracked text files
#   3. HEAD commit message against the commit-msg hook rule
$ErrorActionPreference = 'Stop'

$root = (& git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { exit 1 }
Set-Location $root

$status = 0
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)
$excluded = @('tools/check.sh', 'tools/check.ps1', 'tools/forbidden-phrases.txt')

function Read-PhraseFile([string]$rel) {
  $path = Join-Path $root $rel
  try { $text = $utf8.GetString([IO.File]::ReadAllBytes($path)) }
  catch { Write-Output "FAIL $rel is missing or unreadable"; exit 1 }
  return @($text -split "`n" | ForEach-Object { $_.TrimEnd("`r") } |
    Where-Object { $_ -ne '' -and -not $_.StartsWith('#') })
}

function Read-Phrases {
  if (-not (Test-Path -LiteralPath (Join-Path $root 'tools/forbidden-phrases.txt') -PathType Leaf)) {
    Write-Output 'FAIL tools/forbidden-phrases.txt is missing or unreadable'; exit 1
  }
  $list = @(Read-PhraseFile 'tools/forbidden-phrases.txt')
  if ($list.Count -eq 0) { Write-Output 'FAIL tools/forbidden-phrases.txt has no phrases'; exit 1 }
  return $list
}

function Test-ContainsPhrase([string]$text, [string[]]$phrases) {
  # Plain lines match anywhere ignoring case; ~ whole word ignoring case;
  # = whole word, case-sensitive. Word boundaries are ASCII: start or end of
  # line, or any character outside A-Z, a-z, 0-9 and _ (the same rule
  # tools/check.sh and tools/hooks/commit-msg apply with grep -E under LC_ALL=C).
  $rx = [Text.RegularExpressions.RegexOptions]
  foreach ($p in $phrases) {
    if ($p.StartsWith('~') -or $p.StartsWith('=')) {
      $opts = $rx::CultureInvariant
      if ($p.StartsWith('~')) { $opts = $opts -bor $rx::IgnoreCase }
      $pat = '(?<![A-Za-z0-9_])' + [regex]::Escape($p.Substring(1)) + '(?![A-Za-z0-9_])'
      if ([regex]::IsMatch($text, $pat, $opts)) { return $p }
    } elseif ($text.IndexOf($p, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $p }
  }
  return $null
}

function Test-CommitMessage([string]$message, [string[]]$phrases) {
  # Strip one carriage return at end of line only; any other stays and is rejected.
  $lines = @($message -split "`n" | ForEach-Object { $_ -replace '\r\z', '' } |
    Where-Object { -not $_.StartsWith('#') -and $_ -notmatch '\A[ \t\n\v\f\r]*\z' })
  if ($lines.Count -eq 0) { return 'message is empty' }
  if ($lines.Count -ne 1) { return "message must be one line (found $($lines.Count) lines)" }
  $s = $lines[0]
  if ($s -cmatch '[\x00-\x1F\x7F]') { return 'message must not contain control characters' }
  if ($s -cmatch '[^\x20-\x7E]') { return 'message must be printable ASCII only (no emoji or symbols)' }
  if ($s.Length -lt 20) { return "message is $($s.Length) characters; minimum is 20" }
  if ($s.Length -gt 72) { return "message is $($s.Length) characters; maximum is 72" }
  if ($s.EndsWith('.')) { return 'message must not end with a period' }
  if (Test-ContainsPhrase $s $phrases) {
    return 'message contains a forbidden phrase (tools/forbidden-phrases.txt)'
  }
  return $null
}

$phrases = Read-Phrases
$files = @(& git -c core.quotepath=off ls-files)

# 1. Phrase scan
$hits = 0
foreach ($f in $files) {
  if ($excluded -ccontains $f) { continue }
  $path = Join-Path $root $f
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
  $bytes = [IO.File]::ReadAllBytes($path)
  if ([Array]::IndexOf($bytes, [byte]0) -ge 0) { continue }
  $text = [Text.Encoding]::UTF8.GetString($bytes)
  $n = 0
  $fileHit = $false
  foreach ($line in ($text -split "`n")) {
    $n++
    $p = Test-ContainsPhrase $line $phrases
    if ($p) { Write-Output "  ${f}:${n}: $($line.TrimEnd("`r"))"; $fileHit = $true }
  }
  if ($fileHit) { $hits++ }
}
if ($hits -eq 0) { Write-Output 'PASS phrase scan' }
else { Write-Output "FAIL phrase scan ($hits file(s))"; $status = 1 }

# 2. Encoding, line endings and final newline
$bad = 0
foreach ($entry in @(& git -c core.quotepath=off ls-files --eol)) {
  $parts = $entry -split "`t", 2
  $cols = $parts[0] -split '\s+'
  $indexEol = $cols[0]; $workEol = $cols[1]; $f = $parts[1]
  if ($indexEol -eq 'i/-text') { continue }
  if ($indexEol -eq 'i/crlf' -or $indexEol -eq 'i/mixed') {
    Write-Output "  ${f}: CRLF line endings in index"; $bad++; continue
  }
  if ($workEol -eq 'w/crlf' -or $workEol -eq 'w/mixed') {
    Write-Output "  ${f}: CRLF line endings"; $bad++; continue
  }
  $path = Join-Path $root $f
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
  $bytes = [IO.File]::ReadAllBytes($path)
  if ($bytes.Length -eq 0) { continue }
  if ($bytes[$bytes.Length - 1] -ne 10) { Write-Output "  ${f}: no final newline"; $bad++ }
  try { [void]$utf8.GetString($bytes) }
  catch { Write-Output "  ${f}: not valid UTF-8"; $bad++ }
}
if ($bad -eq 0) { Write-Output 'PASS encoding, line endings and final newline' }
else { Write-Output "FAIL encoding, line endings and final newline ($bad problem(s))"; $status = 1 }

# 3. HEAD commit message
& git rev-parse --verify -q HEAD *> $null
if ($LASTEXITCODE -eq 0) {
  # Read the raw bytes: PowerShell's native-output capture would split lines on a lone CR.
  $gitArgs = '-c i18n.logOutputEncoding=UTF-8 log -1 --format=%B HEAD'
  $psi = New-Object System.Diagnostics.ProcessStartInfo('git', $gitArgs)
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.WorkingDirectory = $root
  $proc = [Diagnostics.Process]::Start($psi)
  $raw = $proc.StandardOutput.ReadToEnd(); $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) { Write-Output 'FAIL HEAD commit message (git log failed)'; exit 1 }
  $problem = Test-CommitMessage $raw $phrases
  if ($problem) { Write-Output "  commit-msg: $problem"; Write-Output 'FAIL HEAD commit message'; $status = 1 }
  else { Write-Output 'PASS HEAD commit message' }
} else {
  Write-Output 'SKIP HEAD commit message (no commits yet)'
}

exit $status
