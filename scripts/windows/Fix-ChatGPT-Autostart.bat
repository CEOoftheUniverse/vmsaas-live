@echo off
REM ---------------------------------------------------------------------
REM  Double-click this file on the Windows VM to repair ChatGPT autostart
REM  and drop a ChatGPT icon on the Desktop.
REM
REM  No administrator rights required.
REM  Pass -DiagnoseOnly to look without changing anything:
REM      Fix-ChatGPT-Autostart.bat -DiagnoseOnly
REM ---------------------------------------------------------------------
setlocal
title ChatGPT autostart repair

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Fix-ChatGPTAutostart.ps1" %*
set RC=%ERRORLEVEL%

echo.
if %RC% EQU 0 (
    echo Done. You can close this window.
) else (
    echo Finished with exit code %RC% - see the messages above.
)
echo.
pause
endlocal
