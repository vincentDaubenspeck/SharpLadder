# The decision half of tools/high-contrast.ps1: state shape, the enable and restore contracts and
# the stability wait. It reads and changes nothing in the OS, so tests run it on any host; the
# same contract is in web/browser/high-contrast.ts and a test runs one table through both.
Set-StrictMode -Version Latest

$script:colourKeys = @('window', 'windowText', 'highlight', 'highlightText', 'buttonFace', 'buttonText', 'grayText', 'hotlight')
$script:stateKeys = @('flags', 'on', 'available', 'scheme', 'colours', 'registry', 'theme', 'osBuild', 'imageVersion', 'fontSmoothing', 'sysColors')
$script:fontSmoothingKeys = @('smoothing', 'type', 'contrast', 'orientation')
# Raw GetSysColor readings for COLOR_SCROLLBAR (0) to COLOR_MENUBAR (30), by index.
$script:sysColorCount = 31
# Rewritten by the OS on a scheme change and never read by an engine, so they are recorded only.
$script:evidenceOnly = @('LastUpdatedThemeId', 'Previous High Contrast Scheme MUI Ptr')
$script:schemeNames = @('High Contrast Black', 'High Contrast White')
# Registry values that hold a scheme name and so follow the same off-only last-enabled rule as the SPI name.
$script:nameKeys = @('High Contrast Scheme', 'Previous High Contrast Scheme MUI Value')

function Get-PropertyName([object]$Object) {
  if ($null -eq $Object -or $Object -isnot [Management.Automation.PSCustomObject]) { return $null }
  return , ([string[]]@($Object.PSObject.Properties | ForEach-Object { $_.Name }))
}

function Format-Value([bool]$Present, [object]$Value) {
  if (-not $Present) { return '<missing>' }
  if ($Value -is [bool]) { return $Value.ToString().ToLowerInvariant() }
  if ($Value -is [string]) { return "'$Value'" }
  return [string]$Value
}

function Get-ShapeProblem([object]$State, [string]$Name) {
  $keys = Get-PropertyName $State
  if ($null -eq $keys) { return , @("malformed $Name`: not an object") }
  $problems = @()
  foreach ($key in $script:stateKeys) { if ($keys -cnotcontains $key) { $problems += "malformed $Name`: $key missing" } }
  foreach ($key in $keys) { if ($script:stateKeys -cnotcontains $key) { $problems += "malformed $Name`: $key unexpected" } }
  if ($problems.Count -gt 0) { return , $problems }
  if (-not ($State.flags -is [int] -or $State.flags -is [long])) { $problems += "malformed $Name`: flags" }
  foreach ($key in @('on', 'available')) { if ($State.$key -isnot [bool]) { $problems += "malformed $Name`: $key" } }
  foreach ($key in @('scheme', 'theme', 'osBuild', 'imageVersion')) { if ($State.$key -isnot [string]) { $problems += "malformed $Name`: $key" } }
  $colourNames = Get-PropertyName $State.colours
  if ($null -eq $colourNames -or $colourNames.Count -ne $script:colourKeys.Count) { $problems += "malformed $Name`: colours" }
  else {
    foreach ($key in $script:colourKeys) {
      if ($colourNames -cnotcontains $key -or $State.colours.$key -isnot [string] -or $State.colours.$key -cnotmatch '^#[0-9A-F]{6}$') {
        $problems += "malformed $Name`: colour $key"
      }
    }
  }
  $registryNames = Get-PropertyName $State.registry
  if ($null -eq $registryNames) { $problems += "malformed $Name`: registry" }
  else { foreach ($key in $registryNames) { if ($State.registry.$key -isnot [string]) { $problems += "malformed $Name`: registry $key" } } }
  $smoothingNames = Get-PropertyName $State.fontSmoothing
  if ($null -eq $smoothingNames -or $smoothingNames.Count -ne $script:fontSmoothingKeys.Count) { $problems += "malformed $Name`: fontSmoothing" }
  else {
    foreach ($key in $script:fontSmoothingKeys) {
      if ($smoothingNames -cnotcontains $key -or -not (Test-RawValue $State.fontSmoothing.$key)) { $problems += "malformed $Name`: fontSmoothing $key" }
    }
  }
  if ($State.sysColors -isnot [array] -or $State.sysColors.Count -ne $script:sysColorCount) { $problems += "malformed $Name`: sysColors" }
  else {
    for ($i = 0; $i -lt $script:sysColorCount; $i++) {
      if (-not (Test-RawValue $State.sysColors[$i])) { $problems += "malformed $Name`: sysColor $i" }
    }
  }
  return , $problems
}

# A raw SPI or GetSysColor reading: a whole number that fits a 32-bit unsigned value.
function Test-RawValue([object]$Value) {
  if (-not ($Value -is [int] -or $Value -is [long])) { return $false }
  return ($Value -ge 0 -and $Value -le 4294967295)
}

function Join-ShapeProblem([object]$Baseline, [object]$Observed) {
  $was = Get-ShapeProblem $Baseline 'baseline'
  $now = Get-ShapeProblem $Observed 'observed'
  return , ([object[]]@($was) + [object[]]@($now))
}

function Test-LastEnabled([string]$LastEnabled) {
  if ($LastEnabled -ne '' -and $script:schemeNames -cnotcontains $LastEnabled) { throw "last enabled scheme '$LastEnabled' is not a known scheme" }
}

# A name field may also be the last enabled scheme, but only while high contrast is off.
function Test-NamePermitted([bool]$WasPresent, [object]$Was, [bool]$NowPresent, [object]$Now, [bool]$On, [string]$LastEnabled) {
  if ($WasPresent -eq $NowPresent -and (-not $NowPresent -or $Was -ceq $Now)) { return $true }
  return (-not $On -and $LastEnabled -ne '' -and $NowPresent -and $Now -ceq $LastEnabled)
}

function Get-RestoreProblem([object]$Baseline, [object]$Observed, [string]$LastEnabled) {
  Test-LastEnabled $LastEnabled
  $problems = Join-ShapeProblem $Baseline $Observed
  if ($problems.Count -gt 0) { return , $problems }
  if ([long]$Observed.flags -ne [long]$Baseline.flags) { $problems += "flags $($Observed.flags), not $($Baseline.flags)" }
  foreach ($key in @('on', 'available', 'osBuild', 'imageVersion')) {
    if ($Observed.$key -cne $Baseline.$key) {
      $problems += "$key $(Format-Value $true $Observed.$key), not $(Format-Value $true $Baseline.$key)"
    }
  }
  if (-not (Test-NamePermitted -WasPresent $true -Was $Baseline.scheme -NowPresent $true -Now $Observed.scheme -On $Observed.on -LastEnabled $LastEnabled)) {
    $problems += "scheme $(Format-Value $true $Observed.scheme), not $(Format-Value $true $Baseline.scheme)"
  }
  if ($Observed.theme -cne $Baseline.theme) {
    $problems += "theme $(Format-Value $true $Observed.theme), not $(Format-Value $true $Baseline.theme)"
  }
  foreach ($key in $script:colourKeys) {
    if ($Observed.colours.$key -cne $Baseline.colours.$key) {
      $problems += "colour $key $(Format-Value $true $Observed.colours.$key), not $(Format-Value $true $Baseline.colours.$key)"
    }
  }
  $was = Get-PropertyName $Baseline.registry
  $now = Get-PropertyName $Observed.registry
  $union = [string[]]@(@($was) + @($now) | Select-Object -Unique)
  [Array]::Sort($union, [StringComparer]::Ordinal)
  foreach ($key in $union) {
    if ($script:evidenceOnly -ccontains $key) { continue }
    $wasPresent = $was -ccontains $key
    $nowPresent = $now -ccontains $key
    $wasValue = if ($wasPresent) { $Baseline.registry.$key } else { $null }
    $nowValue = if ($nowPresent) { $Observed.registry.$key } else { $null }
    $same = if ($script:nameKeys -ccontains $key) {
      Test-NamePermitted -WasPresent $wasPresent -Was $wasValue -NowPresent $nowPresent -Now $nowValue -On $Observed.on -LastEnabled $LastEnabled
    } else { $wasPresent -eq $nowPresent -and $wasValue -ceq $nowValue }
    if (-not $same) { $problems += "registry $key $(Format-Value $nowPresent $nowValue), not $(Format-Value $wasPresent $wasValue)" }
  }
  foreach ($key in $script:fontSmoothingKeys) {
    if ([long]$Observed.fontSmoothing.$key -ne [long]$Baseline.fontSmoothing.$key) {
      $problems += "fontSmoothing $key $($Observed.fontSmoothing.$key), not $($Baseline.fontSmoothing.$key)"
    }
  }
  for ($i = 0; $i -lt $script:sysColorCount; $i++) {
    if ([long]$Observed.sysColors[$i] -ne [long]$Baseline.sysColors[$i]) {
      $problems += "sysColor $i $($Observed.sysColors[$i]), not $($Baseline.sysColors[$i])"
    }
  }
  return , $problems
}

function Get-EnableProblem([object]$Baseline, [object]$Observed, [string]$Scheme) {
  if ($script:schemeNames -cnotcontains $Scheme) { throw "'$Scheme' is not a known scheme" }
  $problems = Join-ShapeProblem $Baseline $Observed
  if ($problems.Count -gt 0) { return , $problems }
  if (-not $Observed.on) { $problems += 'on false, not true' }
  if (-not $Observed.available) { $problems += 'available false, not true' }
  $want = [long]$Baseline.flags -bor 1
  if ([long]$Observed.flags -ne $want) { $problems += "flags $($Observed.flags), not $want" }
  if ($Observed.scheme -cne $Scheme) { $problems += "scheme $(Format-Value $true $Observed.scheme), not '$Scheme'" }
  $changed = @($script:colourKeys | Where-Object { $Observed.colours.$_ -cne $Baseline.colours.$_ })
  if ($changed.Count -eq 0) { $problems += 'palette unchanged from the baseline' }
  return , $problems
}

# What must stay unchanged for a qualifying observation to count as stable; evidence-only keys excluded.
function Get-Fingerprint([object]$State) {
  $registry = [ordered]@{}
  $names = Get-PropertyName $State.registry
  foreach ($key in @($names)) {
    if ($null -ne $key -and $script:evidenceOnly -cnotcontains $key) { $registry[$key] = $State.registry.$key }
  }
  $colours = [ordered]@{}
  foreach ($key in $script:colourKeys) { $colours[$key] = $State.colours.$key }
  $smoothing = [ordered]@{}
  foreach ($key in $script:fontSmoothingKeys) { $smoothing[$key] = $State.fontSmoothing.$key }
  return ([ordered]@{
      flags = $State.flags; on = $State.on; available = $State.available; scheme = $State.scheme
      colours = $colours; registry = $registry; theme = $State.theme
      fontSmoothing = $smoothing; sysColors = @($State.sysColors)
    } | ConvertTo-Json -Depth 4 -Compress)
}

# Polls until the contract has held, unchanged, for StableMs; any mismatch or change restarts the
# window. A read error or the deadline fails at once, without a retry. Time, reading, sleeping
# and recording are injected, so the decision runs without the OS.
function Wait-HighContrast {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Read,
    [Parameter(Mandatory = $true)][scriptblock]$Problems,
    [Parameter(Mandatory = $true)][scriptblock]$Elapsed,
    [Parameter(Mandatory = $true)][scriptblock]$Sleep,
    [Parameter(Mandatory = $true)][scriptblock]$Record,
    [int]$PollMs = 250,
    [int]$StableMs = 1000,
    [int]$DeadlineMs = 30000
  )
  $since = $null
  $previous = $null
  while ($true) {
    try { $state = & $Read }
    catch {
      $at = [long](& $Elapsed)
      & $Record ([ordered]@{ elapsedMs = $at; state = $null; problems = @(); qualifying = $false; error = $_.Exception.Message })
      throw "read failed at $at ms, not retried: $($_.Exception.Message)"
    }
    $at = [long](& $Elapsed)
    $found = & $Problems $state
    if ($null -eq $found) { $found = @() }
    if ($found.Count -gt 0) { $since = $null; $previous = $null }
    else {
      $print = Get-Fingerprint $state
      if ($null -eq $since -or $print -cne $previous) { $since = $at; $previous = $print }
    }
    & $Record ([ordered]@{ elapsedMs = $at; state = $state; problems = $found; qualifying = ($found.Count -eq 0); error = $null })
    # A slow read or record can cross the deadline, so the clock is read again before success.
    $now = [long](& $Elapsed)
    if ($now -gt $DeadlineMs) {
      throw "result at $now ms is past the $DeadlineMs ms deadline; last problems: $($found -join '; ')"
    }
    if ($null -ne $since -and $at - $since -ge $StableMs) { return $state }
    if ($at -ge $DeadlineMs) {
      throw "not stable for $StableMs ms within $DeadlineMs ms; last problems: $($found -join '; ')"
    }
    & $Sleep $PollMs
  }
}
