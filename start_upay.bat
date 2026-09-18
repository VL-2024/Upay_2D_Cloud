@echo off
cd /d "%~dp0"
echo Starting UPAY 2D on http://localhost:8080
start "" http://localhost:8080
py -m http.server 8080
if errorlevel 1 python -m http.server 8080
pause
