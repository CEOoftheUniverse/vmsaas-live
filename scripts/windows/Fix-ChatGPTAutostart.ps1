<#
.SYNOPSIS
    Diagnoses and repairs autostart for the ChatGPT desktop app on Windows,
    and creates a desktop shortcut so it can also be launched on demand.

.DESCRIPTION
    Built for streamed cloud desktops (Vagon, Azure Virtual Desktop, Parsec,
    Shadow) where the usual autostart mechanisms silently fail.

    On a streamed desktop the display/GPU stack is not ready at the instant
    the logon Run keys fire. Electron-based apps such as ChatGPT launched at
    that moment either exit immediately or never paint a window, which looks
    exactly like "it did not start". A short delay after logon is the single
    highest-impact fix, so the repair registers a delayed scheduled task
    rather than relying on the Run key alone.

    Requires no administrator rights: everything is written to the current
    user's hive, Startup folder, Desktop, and per-user task library.

.PARAMETER DelaySeconds
    Seconds to wait after logon before launching. Default 45. On a slow or
    heavily loaded VM, raise to 60-90.

.PARAMETER DiagnoseOnly
    Report findings and change nothing.

.PARAMETER NoScheduledTask
    Skip the scheduled task; use a Startup-folder shortcut instead.

.PARAMETER NoDesktopShortcut
    Skip creating the desktop shortcut.

.PARAMETER NoStartNow
    Do not launch the app once the repair is done.

.EXAMPLE
    .\Fix-ChatGPTAutostart.ps1
    Diagnose, repair autostart, create the desktop icon, launch ChatGPT.

.EXAMPLE
    .\Fix-ChatGPTAutostart.ps1 -DiagnoseOnly
    Show what is wrong without touching anything.

.EXAMPLE
    .\Fix-ChatGPTAutostart.ps1 -DelaySeconds 90
    Same repair, but wait 90 seconds after logon before launching.
#>
[CmdletBinding()]
param(
    [ValidateRange(0, 600)]
    [int]$DelaySeconds = 45,
    [switch]$DiagnoseOnly,
    [switch]$NoScheduledTask,
    [switch]$NoDesktopShortcut,
    [switch]$NoStartNow
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Start ChatGPT at logon'
$ShortcutName = 'ChatGPT.lnk'

# ── output helpers ────────────────────────────────────────────────────────
function Write-Head($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ('  ' + ('-' * $t.Length)) -ForegroundColor DarkGray }
function Write-Ok  ($t) { Write-Host "  [ OK ]   $t" -ForegroundColor Green }
function Write-Warn($t) { Write-Host "  [WARN]   $t" -ForegroundColor Yellow }
function Write-Bad ($t) { Write-Host "  [FAIL]   $t" -ForegroundColor Red }
function Write-Info($t) { Write-Host "  [INFO]   $t" -ForegroundColor Gray }
function Write-Act ($t) { Write-Host "  [FIXED]  $t" -ForegroundColor Magenta }

$findings = New-Object System.Collections.ArrayList
function Add-Finding($Check, $State, $Detail) {
    [void]$findings.Add([pscustomobject]@{ Check = $Check; State = $State; Detail = $Detail })
}

# ── locate the ChatGPT app ────────────────────────────────────────────────
function Join-PathSafe {
    # Join-Path throws if the base is null; on a locked-down or roaming profile
    # any of these environment variables can legitimately be missing.
    param([string]$Base, [string]$Child)
    if ([string]::IsNullOrWhiteSpace($Base)) { return $null }
    try { Join-Path $Base $Child } catch { $null }
}

function Find-StartMenuShortcut {
    $roots = @(
        (Join-PathSafe $env:APPDATA     'Microsoft\Windows\Start Menu\Programs'),
        (Join-PathSafe $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
    ) | Where-Object { $_ -and (Test-Path $_) }

    if (-not $roots) { return $null }
    Get-ChildItem -Path $roots -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -match 'ChatGPT' } |
        Select-Object -First 1
}

function Resolve-ChatGPTApp {
    # 1) MSIX / Microsoft Store package -- the usual OpenAI distribution
    $pkg = $null
    try {
        $pkg = Get-AppxPackage -ErrorAction Stop |
               Where-Object { $_.Name -match 'ChatGPT' -or $_.Publisher -match 'OpenAI' } |
               Select-Object -First 1
    } catch {
        Write-Info "Get-AppxPackage unavailable ($($_.Exception.Message.Split([Environment]::NewLine)[0]))"
    }

    if ($pkg) {
        $appId = $null
        try {
            $manifest = Get-AppxPackageManifest $pkg -ErrorAction Stop
            $appId = @($manifest.Package.Applications.Application.Id) | Select-Object -First 1
        } catch { }

        if ($appId) {
            $aumid = '{0}!{1}' -f $pkg.PackageFamilyName, $appId
            return [pscustomobject]@{
                Kind          = 'MSIX (Microsoft Store)'
                DisplayName   = $pkg.Name
                Version       = $pkg.Version
                Target        = (Join-Path $env:WINDIR 'explorer.exe')
                Arguments     = "shell:AppsFolder\$aumid"
                Aumid         = $aumid
                InstallPath   = $pkg.InstallLocation
                ProcessName   = 'ChatGPT'
            }
        }
    }

    # 2) Classic / Electron-style install
    $candidates = @(
        (Join-PathSafe $env:LOCALAPPDATA 'Programs\ChatGPT\ChatGPT.exe'),
        (Join-PathSafe $env:LOCALAPPDATA 'ChatGPT\ChatGPT.exe'),
        (Join-PathSafe $env:ProgramFiles 'ChatGPT\ChatGPT.exe'),
        (Join-PathSafe ${env:ProgramFiles(x86)} 'ChatGPT\ChatGPT.exe')
    )

    $exe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($exe) {
        return [pscustomobject]@{
            Kind        = 'Classic installer'
            DisplayName = 'ChatGPT'
            Version     = (Get-Item $exe).VersionInfo.ProductVersion
            Target      = $exe
            Arguments   = ''
            Aumid       = $null
            InstallPath = (Split-Path $exe -Parent)
            ProcessName = 'ChatGPT'
        }
    }

    # 3) Fall back to whatever the Start Menu points at
    $lnk = Find-StartMenuShortcut
    if ($lnk) {
        try {
            $sh = New-Object -ComObject WScript.Shell
            $sc = $sh.CreateShortcut($lnk.FullName)
            if ($sc.TargetPath) {
                return [pscustomobject]@{
                    Kind        = 'Resolved from Start Menu shortcut'
                    DisplayName = $lnk.BaseName
                    Version     = 'unknown'
                    Target      = $sc.TargetPath
                    Arguments   = $sc.Arguments
                    Aumid       = $null
                    InstallPath = (Split-Path $sc.TargetPath -Parent)
                    ProcessName = 'ChatGPT'
                }
            }
        } catch { }
    }

    return $null
}

# ── StartupApproved: Windows' own enable/disable flag ─────────────────────
# 12-byte binary value. First byte 0x02 / 0x06 = enabled, 0x03 / 0x07 = disabled
# (Task Manager > Startup and Settings > Apps > Startup both write here).
function Test-StartupApproved {
    $keys = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
    )
    foreach ($k in $keys) {
        if (-not (Test-Path $k)) { continue }
        $props = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
        foreach ($p in $props.PSObject.Properties) {
            if ($p.Name -notmatch 'ChatGPT') { continue }
            $bytes = $p.Value
            if ($bytes -isnot [byte[]] -or $bytes.Length -lt 1) { continue }
            [pscustomobject]@{
                Key      = $k
                Name     = $p.Name
                Disabled = ($bytes[0] -band 0x01) -eq 0x01
                Raw      = ($bytes[0..([Math]::Min(3, $bytes.Length - 1))] -join ',')
            }
        }
    }
}

function Enable-StartupApproved($Entry) {
    $enabled = [byte[]](0x02,0,0,0,0,0,0,0,0,0,0,0)
    Set-ItemProperty -Path $Entry.Key -Name $Entry.Name -Value $enabled -Type Binary
}

# ═══════════════════════════════════════════════════════════════════════════
Write-Host ''
Write-Host '  ChatGPT autostart repair' -ForegroundColor White
Write-Host "  host=$env:COMPUTERNAME  user=$env:USERNAME  ps=$($PSVersionTable.PSVersion)" -ForegroundColor DarkGray

# ── 1. Locate ─────────────────────────────────────────────────────────────
Write-Head 'Step 1 - Locate the app'
$app = Resolve-ChatGPTApp

if (-not $app) {
    Write-Bad 'ChatGPT desktop app not found on this machine.'
    Write-Info 'Searched: Microsoft Store packages, %LOCALAPPDATA%\Programs\ChatGPT,'
    Write-Info '          %ProgramFiles%\ChatGPT, and the Start Menu.'
    Write-Info 'If it was never installed, or the VM reset to a base image, reinstall'
    Write-Info 'it first, then re-run this script:  winget install --id OpenAI.ChatGPT'
    Write-Host ''
    exit 2
}

Write-Ok  "Found: $($app.DisplayName)  [$($app.Kind)]"
Write-Info "Version : $($app.Version)"
Write-Info "Target  : $($app.Target)"
if ($app.Arguments) { Write-Info "Args    : $($app.Arguments)" }
Add-Finding 'App installed' 'PASS' "$($app.Kind) - $($app.DisplayName)"

$running = Get-Process -Name $app.ProcessName -ErrorAction SilentlyContinue
if ($running) {
    Write-Ok "Currently running (PID $($running[0].Id))"
    Add-Finding 'Currently running' 'PASS' "PID $($running[0].Id)"
} else {
    Write-Warn 'Not currently running'
    Add-Finding 'Currently running' 'FAIL' 'no ChatGPT process'
}

# ── 2. Diagnose every autostart mechanism ─────────────────────────────────
Write-Head 'Step 2 - Why it did not start'

$startupDir = [Environment]::GetFolderPath('Startup')
$startupLnk = Join-Path $startupDir $ShortcutName
if (Test-Path $startupLnk) {
    Write-Ok "Startup-folder shortcut present: $startupLnk"
    Add-Finding 'Startup folder entry' 'PASS' $startupLnk
} else {
    Write-Warn 'No shortcut in the Startup folder'
    Add-Finding 'Startup folder entry' 'FAIL' 'missing'
}

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runHit = $null
if (Test-Path $runKey) {
    $runHit = (Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue).PSObject.Properties |
              Where-Object { $_.Name -match 'ChatGPT' -or "$($_.Value)" -match 'ChatGPT' } |
              Select-Object -First 1
}
if ($runHit) {
    Write-Ok "HKCU Run entry present: $($runHit.Name)"
    Add-Finding 'HKCU Run key' 'PASS' $runHit.Name
} else {
    Write-Warn 'No HKCU\...\Run entry for ChatGPT'
    Add-Finding 'HKCU Run key' 'FAIL' 'missing'
}

$approved = @(Test-StartupApproved)
$wasDisabled = @($approved | Where-Object { $_.Disabled })
if ($wasDisabled.Count -gt 0) {
    Write-Bad "Windows has autostart DISABLED for ChatGPT ($($wasDisabled.Count) entr(y/ies))"
    Write-Info 'This is what Task Manager > Startup apps sets when an entry is switched off.'
    Add-Finding 'Windows startup toggle' 'FAIL' "disabled in $($wasDisabled.Count) location(s)"
} elseif ($approved.Count -gt 0) {
    Write-Ok 'Windows startup toggle is enabled'
    Add-Finding 'Windows startup toggle' 'PASS' 'enabled'
} else {
    Write-Info 'No StartupApproved record (nothing has ever been registered to toggle)'
    Add-Finding 'Windows startup toggle' 'N/A' 'no record'
}

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Ok "Scheduled task present, state = $($existingTask.State)"
    Add-Finding 'Scheduled task' $(if ($existingTask.State -eq 'Disabled') { 'FAIL' } else { 'PASS' }) "state=$($existingTask.State)"
} else {
    Write-Warn "No scheduled task named '$TaskName'"
    Add-Finding 'Scheduled task' 'FAIL' 'missing'
}

$desktopDir = [Environment]::GetFolderPath('Desktop')
$desktopLnk = Join-Path $desktopDir $ShortcutName
if (Test-Path $desktopLnk) {
    Write-Ok "Desktop shortcut present: $desktopLnk"
    Add-Finding 'Desktop shortcut' 'PASS' $desktopLnk
} else {
    Write-Warn 'No desktop shortcut'
    Add-Finding 'Desktop shortcut' 'FAIL' 'missing'
}

if ($DiagnoseOnly) {
    Write-Head 'Summary (diagnose only - nothing changed)'
    $findings | Format-Table -AutoSize
    Write-Host ''
    exit 0
}

# ── 3. Repair ─────────────────────────────────────────────────────────────
Write-Head 'Step 3 - Repair'

foreach ($e in $wasDisabled) {
    try {
        Enable-StartupApproved $e
        Write-Act "Re-enabled '$($e.Name)' in $(Split-Path $e.Key -Leaf)"
    } catch {
        Write-Bad "Could not re-enable '$($e.Name)': $($_.Exception.Message)"
    }
}

if (-not $NoScheduledTask) {
    try {
        if ($app.Arguments) {
            $action = New-ScheduledTaskAction -Execute $app.Target -Argument $app.Arguments
        } else {
            $action = New-ScheduledTaskAction -Execute $app.Target
        }

        $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        try {
            $trigger.Delay = "PT${DelaySeconds}S"
        } catch {
            Write-Warn "Could not set a logon delay on this Windows build; task will fire immediately."
        }

        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -MultipleInstances IgnoreNew

        Register-ScheduledTask -TaskName $TaskName `
            -Action $action -Trigger $trigger -Settings $settings `
            -Description 'Launches the ChatGPT desktop app after logon, with a delay so the streamed desktop session is fully initialised first.' `
            -Force | Out-Null

        Write-Act "Registered scheduled task '$TaskName' (logon + ${DelaySeconds}s delay)"
        Add-Finding 'Repair: scheduled task' 'DONE' "delay=${DelaySeconds}s"
    } catch {
        Write-Bad "Scheduled task registration failed: $($_.Exception.Message)"
        Write-Info 'Falling back to a Startup-folder shortcut.'
        $NoScheduledTask = $true
    }
}

if ($NoScheduledTask) {
    try {
        $sh = New-Object -ComObject WScript.Shell
        $sc = $sh.CreateShortcut($startupLnk)
        $sc.TargetPath       = $app.Target
        $sc.Arguments        = $app.Arguments
        $sc.WorkingDirectory = $app.InstallPath
        $sc.Description      = 'Launch ChatGPT at logon'
        $sc.Save()
        Write-Act "Created Startup-folder shortcut: $startupLnk"
        Add-Finding 'Repair: startup shortcut' 'DONE' $startupLnk
    } catch {
        Write-Bad "Could not create the Startup shortcut: $($_.Exception.Message)"
    }
}

# ── 4. Desktop shortcut ───────────────────────────────────────────────────
if (-not $NoDesktopShortcut) {
    Write-Head 'Step 4 - Desktop shortcut'
    $made = $false

    # Copying the Start Menu shortcut keeps the app's real icon.
    $smLnk = Find-StartMenuShortcut
    if ($smLnk) {
        try {
            Copy-Item -Path $smLnk.FullName -Destination $desktopLnk -Force
            Write-Act "Copied the Start Menu shortcut to the Desktop (keeps the real icon)"
            $made = $true
        } catch {
            Write-Warn "Copy failed, building one instead: $($_.Exception.Message)"
        }
    }

    if (-not $made) {
        try {
            $sh = New-Object -ComObject WScript.Shell
            $sc = $sh.CreateShortcut($desktopLnk)
            $sc.TargetPath       = $app.Target
            $sc.Arguments        = $app.Arguments
            $sc.WorkingDirectory = $app.InstallPath
            $sc.Description      = 'Launch ChatGPT'
            if ($app.Kind -eq 'Classic installer') { $sc.IconLocation = "$($app.Target),0" }
            $sc.Save()
            Write-Act "Created desktop shortcut: $desktopLnk"
            $made = $true
        } catch {
            Write-Bad "Could not create the desktop shortcut: $($_.Exception.Message)"
        }
    }

    if ($made) { Add-Finding 'Repair: desktop shortcut' 'DONE' $desktopLnk }
}

# ── 5. Start it now ───────────────────────────────────────────────────────
if (-not $NoStartNow) {
    Write-Head 'Step 5 - Launch now'
    if (Get-Process -Name $app.ProcessName -ErrorAction SilentlyContinue) {
        Write-Ok 'Already running - nothing to launch.'
    } else {
        try {
            if ($app.Arguments) {
                Start-Process -FilePath $app.Target -ArgumentList $app.Arguments
            } else {
                Start-Process -FilePath $app.Target
            }
            Start-Sleep -Seconds 4
            $p = Get-Process -Name $app.ProcessName -ErrorAction SilentlyContinue
            if ($p) { Write-Ok "Launched (PID $($p[0].Id))" }
            else    { Write-Warn 'Launch issued, but no process yet - give it a few more seconds.' }
        } catch {
            Write-Bad "Launch failed: $($_.Exception.Message)"
        }
    }
}

# ── Summary ───────────────────────────────────────────────────────────────
Write-Head 'Summary'
$findings | Format-Table -AutoSize
Write-Host "  Autostart is now handled by a logon task with a ${DelaySeconds}s delay." -ForegroundColor White
Write-Host '  Verify after the next reboot with:  Get-ScheduledTask -TaskName "' -NoNewline -ForegroundColor DarkGray
Write-Host "$TaskName" -NoNewline -ForegroundColor DarkGray
Write-Host '"' -ForegroundColor DarkGray
Write-Host ''
