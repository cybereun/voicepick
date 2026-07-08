@echo off
setlocal
echo Stopping VoicePick server on port 5299...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$conns = Get-NetTCPConnection -LocalPort 5299 -State Listen -ErrorAction SilentlyContinue; if (-not $conns) { Write-Host 'VoicePick server is not running.'; exit 0 }; $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Host ('Stopped process ' + $_) }"
pause
