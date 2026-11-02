# Reads and acts on a Windows app's window by name (buttons, rows, switches, sliders, fields), through UI Automation.
# The Windows twin of src/mac/ui-elements.swift, with the same JSON answers, so the rest of Halo doesn't care which it is.
#   list [app]                              -> { ok, app, window, items: [{ path, role, name, frame, secure, selected, disabled, value }] }
#   act <app> <path> <role> <name> <how>    -> how: press | select | focus | increase | decrease
#   type <app> <path> <role> <name> <text>  -> never into a password box
#   closesheet <app> <button>               -> only Done, OK or Cancel
# Roles use the macOS names (AXButton, AXRow...) so the AI prompts work the same on both.
param(
  [Parameter(Position = 0)][string]$Cmd = "list",
  [Parameter(Position = 1)][string]$App = "",
  [Parameter(Position = 2)][string]$ItemPath = "",
  [Parameter(Position = 3)][string]$Role = "",
  [Parameter(Position = 4)][string]$Name = "",
  [Parameter(Position = 5)][string]$How = ""
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Out-Json($o) { $o | ConvertTo-Json -Compress -Depth 6; exit 0 }

try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
  Add-Type -Namespace Halo -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetDpiForSystem();
[DllImport("user32.dll")] public static extern System.IntPtr SetProcessDpiAwarenessContext(System.IntPtr v);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, System.UIntPtr e);
'@
} catch { Out-Json @{ ok = $false; error = "UI Automation isn't available: $($_.Exception.Message)" } }

# Real pixels in, then divided by the display scale, so frames are in the same points as Halo's windows.
try { [void][Halo.Win]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}
$Scale = 1.0
try { $Scale = [Halo.Win]::GetDpiForSystem() / 96.0 } catch {}
$Own = 0
if ($env:STRIDE_PID) { $Own = [int]$env:STRIDE_PID }

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$AllItems = [System.Windows.Automation.Condition]::TrueCondition

function Get-Pattern($e, $p) {
  $o = $null
  if ($e.TryGetCurrentPattern($p, [ref]$o)) { return $o }
  return $null
}

function Get-ProcName($e) {
  try { return (Get-Process -Id $e.Current.ProcessId -ErrorAction Stop).ProcessName } catch { return "" }
}

function Get-Top {
  $root = $AE::RootElement
  $wins = $root.FindAll($TS::Children, $AllItems)
  if ($App) {
    foreach ($w in $wins) {
      if ($w.Current.ProcessId -eq $Own) { continue }
      $pn = Get-ProcName $w
      if ($pn -ieq $App -or $w.Current.Name -ieq $App -or $w.Current.Name -like "*$App*") { return $w }
    }
  }
  $h = [Halo.Win]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    try {
      $e = $AE::FromHandle($h)
      if ($e -and $e.Current.ProcessId -ne $Own) { return $e }
    } catch {}
  }
  # Halo's own bar is in front: take the next real window.
  foreach ($w in $wins) {
    if ($w.Current.ProcessId -ne $Own -and -not $w.Current.IsOffscreen -and $w.Current.Name) { return $w }
  }
  return $null
}

function Get-Role($e) {
  $ct = $e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  switch ($ct) {
    'Button' { if (Get-Pattern $e ([System.Windows.Automation.TogglePattern]::Pattern)) { return 'AXCheckBox' } else { return 'AXButton' } }
    'SplitButton' { return 'AXButton' }
    'MenuItem' { return 'AXMenuItem' }
    'Hyperlink' { return 'AXLink' }
    'CheckBox' { return 'AXCheckBox' }
    'RadioButton' { return 'AXRadioButton' }
    'TabItem' { return 'AXRadioButton' }
    'ListItem' { return 'AXRow' }
    'TreeItem' { return 'AXRow' }
    'DataItem' { return 'AXRow' }
    'Edit' {
      if ($e.Current.IsPassword) { return 'AXSecureTextField' }
      if ($e.Current.Name -match 'search') { return 'AXSearchField' }
      return 'AXTextField'
    }
    'ComboBox' { return 'AXPopUpButton' }
    'Slider' { return 'AXSlider' }
    'Spinner' { return 'AXIncrementor' }
    'Text' { return 'AXStaticText' }
    default { return $null }
  }
}

function Get-Value($e) {
  $t = Get-Pattern $e ([System.Windows.Automation.TogglePattern]::Pattern)
  if ($t) { if ($t.Current.ToggleState -eq 'On') { return 1 } else { return 0 } }
  $r = Get-Pattern $e ([System.Windows.Automation.RangeValuePattern]::Pattern)
  if ($r) { return [double]$r.Current.Value }
  return $null
}

function Get-Path($e) { return ($e.GetRuntimeId() -join '.') }

function Describe($e, $role) {
  $b = $e.Current.BoundingRectangle
  $item = [ordered]@{
    path = Get-Path $e
    role = $role
    name = [string]$e.Current.Name
    frame = [ordered]@{ x = [math]::Round($b.X / $Scale); y = [math]::Round($b.Y / $Scale); w = [math]::Round($b.Width / $Scale); h = [math]::Round($b.Height / $Scale) }
  }
  if ($role -eq 'AXSecureTextField') { $item.secure = $true }
  if (-not $e.Current.IsEnabled) { $item.disabled = $true }
  $s = Get-Pattern $e ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($s -and $s.Current.IsSelected) { $item.selected = $true }
  $v = Get-Value $e
  if ($null -ne $v) { $item.value = $v }
  return $item
}

function Find-Item($top) {
  # By its id first; if the window was rebuilt, by role and name.
  if ($ItemPath) {
    try {
      $ids = [int[]]($ItemPath -split '\.')
      $c = New-Object System.Windows.Automation.PropertyCondition($AE::RuntimeIdProperty, $ids)
      $hit = $top.FindFirst($TS::Descendants, $c)
      if ($hit) { return $hit }
    } catch {}
  }
  if ($Name) {
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $Name)
    foreach ($hit in $top.FindAll($TS::Descendants, $c)) {
      if (-not $Role -or (Get-Role $hit) -eq $Role) { return $hit }
    }
  }
  return $null
}

function Click-Center($e) {
  $b = $e.Current.BoundingRectangle
  if ($b.Width -le 0) { return $false }
  [void][Halo.Win]::SetCursorPos([int]($b.X + $b.Width / 2), [int]($b.Y + $b.Height / 2))
  Start-Sleep -Milliseconds 120
  [Halo.Win]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [Halo.Win]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  return $true
}

$top = Get-Top
if (-not $top) { Out-Json @{ ok = $false; error = "I couldn't find a window to work in." } }
$appName = Get-ProcName $top

switch ($Cmd) {
  'list' {
    $items = New-Object System.Collections.ArrayList
    foreach ($e in $top.FindAll($TS::Descendants, $AllItems)) {
      if ($items.Count -ge 400) { break }
      try {
        if ($e.Current.IsOffscreen) { continue }
        $role = Get-Role $e
        if (-not $role) { continue }
        if (-not $e.Current.Name -and $role -notin @('AXTextField', 'AXSearchField', 'AXSecureTextField', 'AXSlider')) { continue }
        [void]$items.Add((Describe $e $role))
      } catch {}
    }
    Out-Json ([ordered]@{ ok = $true; app = $appName; window = [string]$top.Current.Name; items = $items })
  }
  'act' {
    $e = Find-Item $top
    if (-not $e) { Out-Json @{ ok = $false; error = "I couldn't find `"$Name`" any more." } }
    if (-not $e.Current.IsEnabled) { Out-Json @{ ok = $false; error = "`"$Name`" is greyed out." } }
    if ($How -in @('increase', 'decrease')) {
      $r = Get-Pattern $e ([System.Windows.Automation.RangeValuePattern]::Pattern)
      if (-not $r) { Out-Json @{ ok = $false; error = "`"$Name`" isn't a slider." } }
      $step = $r.Current.SmallChange
      if (-not $step -or $step -le 0) { $step = ($r.Current.Maximum - $r.Current.Minimum) / 10 }
      $v = $r.Current.Value
      if ($How -eq 'increase') { $v = [math]::Min($r.Current.Maximum, $v + $step) } else { $v = [math]::Max($r.Current.Minimum, $v - $step) }
      $r.SetValue($v)
      Out-Json @{ ok = $true; did = $How; value = [double]$r.Current.Value }
    }
    if ($How -eq 'focus') { $e.SetFocus(); Out-Json @{ ok = $true; did = 'focus' } }
    if ($How -eq 'select') {
      $s = Get-Pattern $e ([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($s) { $s.Select(); Out-Json @{ ok = $true; did = 'select' } }
    }
    $i = Get-Pattern $e ([System.Windows.Automation.InvokePattern]::Pattern)
    if ($i) { $i.Invoke(); Out-Json @{ ok = $true; did = 'invoke' } }
    $t = Get-Pattern $e ([System.Windows.Automation.TogglePattern]::Pattern)
    if ($t) { $t.Toggle(); Out-Json @{ ok = $true; did = 'toggle'; value = (Get-Value $e) } }
    $s = Get-Pattern $e ([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if ($s) { $s.Select(); Out-Json @{ ok = $true; did = 'select' } }
    $x = Get-Pattern $e ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($x) { $x.Expand(); Out-Json @{ ok = $true; did = 'expand' } }
    if (Click-Center $e) { Out-Json @{ ok = $true; did = 'click' } }
    Out-Json @{ ok = $false; error = "I couldn't press `"$Name`"." }
  }
  'type' {
    $e = Find-Item $top
    if (-not $e) { Out-Json @{ ok = $false; error = "I couldn't find that box any more." } }
    if ($e.Current.IsPassword) { Out-Json @{ ok = $false; error = "That's a password box. Only you type there." } }
    $v = Get-Pattern $e ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($v -and -not $v.Current.IsReadOnly) { $v.SetValue($How); Out-Json @{ ok = $true } }
    $e.SetFocus()
    $escaped = [regex]::Replace($How, '[+^%~(){}\[\]]', '{$0}')
    [System.Windows.Forms.SendKeys]::SendWait($escaped)
    Out-Json @{ ok = $true }
  }
  'closesheet' {
    if ($ItemPath -notin @('Done', 'OK', 'Cancel')) { Out-Json @{ ok = $false; pressed = $null; closed = $false; error = 'Only Done, OK or Cancel close a panel.' } }
    $c = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $ItemPath)
    $b = $top.FindFirst($TS::Descendants, $c)
    if (-not $b) { Out-Json @{ ok = $true; pressed = $null; closed = $true } }
    $i = Get-Pattern $b ([System.Windows.Automation.InvokePattern]::Pattern)
    if ($i) { $i.Invoke() } else { [void](Click-Center $b) }
    Start-Sleep -Milliseconds 400
    $still = $top.FindFirst($TS::Descendants, $c)
    Out-Json @{ ok = $true; pressed = $ItemPath; closed = (-not $still) }
  }
  default { Out-Json @{ ok = $false; error = "Unknown command $Cmd" } }
}
