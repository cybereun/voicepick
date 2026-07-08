@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:5299/api/status' -TimeoutSec 5 | ConvertTo-Json -Depth 5 } catch { Write-Host 'VoicePick server is not running or not responding.'; exit 1 }"
pause
