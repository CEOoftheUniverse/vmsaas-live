# Windows VM helper scripts

Utilities for the Windows cloud desktops this project targets (Vagon, and any
other streamed desktop: Azure Virtual Desktop, Parsec, Shadow).

Run them **on the Windows VM itself** — they use Windows-only APIs and do
nothing on Linux or macOS.

---

## `Fix-ChatGPTAutostart.ps1`

Repairs autostart for the ChatGPT desktop app and puts a launch icon on the
Desktop.

### Quick start

Double-click **`Fix-ChatGPT-Autostart.bat`**, or from PowerShell:

```powershell
cd path\to\scripts\windows
.\Fix-ChatGPTAutostart.ps1
```

No administrator rights needed — everything is written to the current user's
registry hive, Startup folder, Desktop, and per-user task library.

### Why autostart fails on a streamed desktop

On a normal PC the logon `Run` keys fire and the app appears. On a streamed
cloud desktop the display and GPU stack are still coming up at that moment, so
an Electron app such as ChatGPT launched right then exits immediately or never
paints a window. The symptom is indistinguishable from "it never started".

That is why the repair registers a **logon task with a delay** instead of
relying on the `Run` key. The delay is the single highest-impact change.

| Mechanism | Fires at | Survives a streamed logon? | Used as |
|---|---|---|---|
| `HKCU\...\Run` | logon, immediately | ✗ often too early | diagnosed, re-enabled if disabled |
| Startup folder shortcut | logon, immediately | ✗ often too early | fallback only |
| `StartupApproved` toggle | n/a (enable/disable flag) | n/a | diagnosed, repaired if switched off |
| **Scheduled task, logon + delay** | logon + N seconds | **✓** | **primary repair** |

### What it does

1. **Locates** the app — Microsoft Store (MSIX) package, classic installer
   under `%LOCALAPPDATA%` / `%ProgramFiles%`, or whatever the Start Menu
   shortcut resolves to.
2. **Diagnoses** all four autostart mechanisms above plus the desktop shortcut,
   and prints a pass/fail table.
3. **Repairs** — re-enables anything Windows had switched off, then registers
   the delayed logon task.
4. **Creates the Desktop shortcut.** Where a Start Menu shortcut exists it is
   copied, which preserves the app's real icon; otherwise one is built.
5. **Launches** the app so you do not have to reboot to get going.

### Options

| Parameter | Default | Effect |
|---|---|---|
| `-DelaySeconds <n>` | `45` | Seconds to wait after logon. Raise to 60–90 on a slow or loaded VM. |
| `-DiagnoseOnly` | off | Report findings, change nothing. |
| `-NoScheduledTask` | off | Use a Startup-folder shortcut instead of the task. |
| `-NoDesktopShortcut` | off | Skip the desktop icon. |
| `-NoStartNow` | off | Do not launch the app after repairing. |

```powershell
.\Fix-ChatGPTAutostart.ps1 -DiagnoseOnly      # look, don't touch
.\Fix-ChatGPTAutostart.ps1 -DelaySeconds 90   # slower VM
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Completed (or diagnose-only finished). |
| `2` | ChatGPT is not installed. Install it, then re-run: `winget install --id OpenAI.ChatGPT` |

### Verifying after a reboot

```powershell
Get-ScheduledTask -TaskName 'Start ChatGPT at logon' | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName 'Start ChatGPT at logon' | Select-Object LastRunTime, LastTaskResult
```

`LastTaskResult` of `0` means the launch succeeded.

### Undo

```powershell
Unregister-ScheduledTask -TaskName 'Start ChatGPT at logon' -Confirm:$false
Remove-Item "$([Environment]::GetFolderPath('Desktop'))\ChatGPT.lnk"
Remove-Item "$([Environment]::GetFolderPath('Startup'))\ChatGPT.lnk" -ErrorAction SilentlyContinue
```

### Test coverage

Validated on Linux with PowerShell 7.4.6 (parser plus unit tests against the
extracted functions). The Windows-only calls cannot be exercised off-Windows:

| Area | Status |
|---|---|
| Script parses with 0 errors | ✅ verified |
| App-not-installed path exits `2` cleanly | ✅ verified |
| Classic-installer detection | ✅ verified (mock tree) |
| Start Menu shortcut fallback | ✅ verified (mock tree) |
| Null/missing environment variables | ✅ verified |
| `StartupApproved` byte decoding | ✅ verified |
| MSIX / Store package detection | ⚠️ needs a Windows run |
| Scheduled task registration | ⚠️ needs a Windows run |
| COM shortcut creation | ⚠️ needs a Windows run |

Run with `-DiagnoseOnly` first on the VM to confirm detection before it
changes anything.
