@echo off
setlocal
cd /d "%~dp0"
title VoicePick Server
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "URL=http://127.0.0.1:5299/"

if not exist "%NODE_EXE%" (
  echo Node.js not found: %NODE_EXE%
  pause
  exit /b 1
)

echo VoicePick server launcher
echo Folder: %CD%
echo URL: %URL%
echo.
echo This window keeps the server alive. Close this window to stop VoicePick.
echo.

start "" "%URL%"

:loop
echo [%date% %time%] Starting VoicePick server...
"%NODE_EXE%" --no-warnings src\server.mjs >> voicepick-server.out.log 2>> voicepick-server.err.log
echo [%date% %time%] VoicePick server stopped. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
