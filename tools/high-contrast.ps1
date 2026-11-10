# Reads, turns on or restores real Windows high contrast through SystemParametersInfo.
# Usage: high-contrast.ps1 -Action read|enable|restore [-Scheme <name>] [-Baseline <file>]
#   [-LastEnabled <name>] [-Evidence <file>]
# It changes a session-wide setting, so it refuses to run anywhere but an opted-in, disposable
# GitHub-hosted windows-2025 runner; the guard runs before any native code is loaded.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('read', 'enable', 'restore')]
  [string]$Action,
  [ValidateSet('High Contrast Black', 'High Contrast White')]
  [string]$Scheme,
  [string]$Baseline,
  [string]$LastEnabled = '',
  [string]$Evidence
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# The same table is in web/browser/high-contrast.ts; a test keeps the two equal.
$hostedRunner = [ordered]@{
  GITHUB_ACTIONS = 'true'
  CI = 'true'
  RUNNER_ENVIRONMENT = 'github-hosted'
  RUNNER_OS = 'Windows'
  ImageOS = 'win25-vs2026'
  USERNAME = 'runneradmin'
  SHARPLADDER_REAL_HIGH_CONTRAST = '1'
}

function Get-HostedProblem {
  $problems = @()
  foreach ($name in $hostedRunner.Keys) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value -cne $hostedRunner[$name]) { $problems += "$name is not $($hostedRunner[$name])" }
  }
  return , $problems
}

$problems = Get-HostedProblem
if ($problems.Count -gt 0) {
  [Console]::Error.WriteLine("high-contrast: refused, not an opted-in hosted runner: $($problems -join '; ')")
  exit 2
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SharpLadderHighContrast {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct HIGHCONTRAST {
    public int cbSize;
    public int dwFlags;
    public IntPtr lpszDefaultScheme;
  }
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool SystemParametersInfo(uint action, uint size, ref HIGHCONTRAST value, uint winIni);
  [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true)]
  public static extern bool SystemParametersInfoValue(uint action, uint size, ref uint value, uint winIni);
  [DllImport("user32.dll")]
  public static extern uint GetSysColor(int index);
}
'@
. (Join-Path $PSScriptRoot 'high-contrast-contract.ps1')

$spiGet = 0x0042
$spiSet = 0x0043
$hcfOn = 0x1
# Written to the user profile and broadcast, so running windows and the registry both follow.
$spifPersist = 0x3
$colourIndex = [ordered]@{
  window = 5; windowText = 8; highlight = 13; highlightText = 14
  buttonFace = 15; buttonText = 18; grayText = 17; hotlight = 26
}
# Read-only SPI_GET actions, as defined in WinUser.h.
$fontSmoothingAction = [ordered]@{
  smoothing = 0x004A; type = 0x200A; contrast = 0x200C; orientation = 0x2012
}
$utf8 = New-Object Text.UTF8Encoding $false

function Read-SpiValue([uint32]$Action) {
  $value = [uint32]0
  $ok = [SharpLadderHighContrast]::SystemParametersInfoValue($Action, 0, [ref]$value, 0)
  if (-not $ok) {
    throw ('SPI action 0x{0:X4} failed, Win32 error {1}' -f $Action, [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  return [long]$value
}

function Read-HighContrast {
  $hc = New-Object SharpLadderHighContrast+HIGHCONTRAST
  $hc.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($hc)
  $ok = [SharpLadderHighContrast]::SystemParametersInfo($spiGet, [uint32]$hc.cbSize, [ref]$hc, 0)
  if (-not $ok) {
    throw "SPI_GETHIGHCONTRAST failed, Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  $name = ''
  if ($hc.lpszDefaultScheme -ne [IntPtr]::Zero) {
    $name = [Runtime.InteropServices.Marshal]::PtrToStringUni($hc.lpszDefaultScheme)
  }
  $colours = [ordered]@{}
  foreach ($key in $colourIndex.Keys) {
    $ref = [SharpLadderHighContrast]::GetSysColor($colourIndex[$key])
    # COLORREF is 0x00BBGGRR.
    $colours[$key] = '#{0:X2}{1:X2}{2:X2}' -f ($ref -band 0xFF), (($ref -shr 8) -band 0xFF), (($ref -shr 16) -band 0xFF)
  }
  $registry = [ordered]@{}
  $key = Get-Item -LiteralPath 'HKCU:\Control Panel\Accessibility\HighContrast' -ErrorAction SilentlyContinue
  if ($null -ne $key) {
    foreach ($value in ($key.GetValueNames() | Sort-Object)) { $registry[$value] = [string]$key.GetValue($value) }
  }
  $themes = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes' -ErrorAction SilentlyContinue
  $theme = ''
  if ($null -ne $themes -and $themes.PSObject.Properties.Name -contains 'CurrentTheme') { $theme = [string]$themes.CurrentTheme }
  $os = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $smoothing = [ordered]@{}
  foreach ($key in $fontSmoothingAction.Keys) { $smoothing[$key] = Read-SpiValue $fontSmoothingAction[$key] }
  $sysColors = New-Object 'Collections.Generic.List[long]'
  for ($i = 0; $i -lt $script:sysColorCount; $i++) { $sysColors.Add([long][SharpLadderHighContrast]::GetSysColor($i)) }
  $state = [ordered]@{
    flags = $hc.dwFlags
    on = (($hc.dwFlags -band $hcfOn) -ne 0)
    available = (($hc.dwFlags -band 0x2) -ne 0)
    scheme = $name
    colours = $colours
    registry = $registry
    theme = $theme
    osBuild = "$($os.CurrentBuildNumber).$($os.UBR)"
    imageVersion = [string]$env:ImageVersion
    fontSmoothing = $smoothing
    sysColors = $sysColors.ToArray()
  }
  # Through JSON, so a live read and the baseline file are the same kind of object.
  return ($state | ConvertTo-Json -Depth 4 | ConvertFrom-Json)
}

function Write-HighContrast([int]$Flags, [string]$Name) {
  $hc = New-Object SharpLadderHighContrast+HIGHCONTRAST
  $hc.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($hc)
  $hc.dwFlags = $Flags
  $buffer = [IntPtr]::Zero
  try {
    if ($Name -ne '') { $buffer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($Name) }
    $hc.lpszDefaultScheme = $buffer
    $ok = [SharpLadderHighContrast]::SystemParametersInfo($spiSet, [uint32]$hc.cbSize, [ref]$hc, $spifPersist)
    if (-not $ok) {
      throw "SPI_SETHIGHCONTRAST failed, Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
  } finally {
    if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
  }
}

$log = [ordered]@{
  action = $Action; scheme = $Scheme; lastEnabled = $LastEnabled; baseline = $Baseline
  startedUtc = [DateTime]::UtcNow.ToString('o'); outcome = 'running'; beforeChange = $null
  samples = New-Object Collections.Generic.List[object]; last = $null; error = $null
}

# Rewritten after every sample, so the polling evidence is on disk whatever the exit status.
function Save-Evidence {
  if ($Evidence -ne '') { [IO.File]::WriteAllText($Evidence, (($log | ConvertTo-Json -Depth 10) + "`n"), $utf8) }
}

function Read-Baseline {
  if ($Baseline -eq '') { throw "$Action needs -Baseline" }
  $state = [IO.File]::ReadAllText($Baseline) | ConvertFrom-Json
  $shape = Get-ShapeProblem $state 'baseline'
  if ($shape.Count -gt 0) { throw "the baseline is malformed: $($shape -join '; ')" }
  if ($state.on -or -not $state.available) { throw 'the baseline is not off and available' }
  return $state
}

function Wait-Transition([scriptblock]$Problems) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  return Wait-HighContrast -Read { Read-HighContrast } -Problems $Problems `
    -Elapsed { $clock.ElapsedMilliseconds } -Sleep { param($ms) Start-Sleep -Milliseconds $ms } `
    -Record { param($sample) $log.samples.Add($sample); $log.last = $sample; Save-Evidence }
}

$exit = 0
try {
  Test-LastEnabled $LastEnabled
  if ($Action -ne 'read' -and $Evidence -eq '') { throw "$Action needs -Evidence" }
  Save-Evidence
  switch ($Action) {
    'read' { $result = Read-HighContrast }
    'enable' {
      if ($Scheme -eq '') { throw 'enable needs -Scheme' }
      $base = Read-Baseline
      $live = Read-HighContrast
      $drift = Get-RestoreProblem $base $live $LastEnabled
      $log.beforeChange = [ordered]@{ state = $live; problems = $drift }
      Save-Evidence
      if ($drift.Count -gt 0) { throw "the live state differs from the baseline before the change: $($drift -join '; ')" }
      # Unrelated flags are the baseline's; only the on bit is added.
      Write-HighContrast ([int]$base.flags -bor $hcfOn) $Scheme
      $result = Wait-Transition { param($state) Get-EnableProblem $base $state $Scheme }
    }
    'restore' {
      $base = Read-Baseline
      Write-HighContrast ([int]$base.flags) ([string]$base.scheme)
      $result = Wait-Transition { param($state) Get-RestoreProblem $base $state $LastEnabled }
    }
  }
  $log.outcome = 'accepted'
  $result | ConvertTo-Json -Depth 4 -Compress
} catch {
  $log.outcome = 'failed'
  $log.error = $_.Exception.Message
  [Console]::Error.WriteLine("high-contrast: $($_.Exception.Message)")
  $exit = 1
} finally {
  Save-Evidence
}
exit $exit
