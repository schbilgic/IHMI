@echo off
setlocal

:: 1. Force the script to execute from its current folder
cd /d "%~dp0"

:: 2. Launch the Node server in a new window using cmd /k so errors stay visible
start "Node Server" cmd /k "node backend\server.js"

:: 3. Give Node 3 seconds to bind to port 3000
timeout /t 3 /nobreak >nul

:: 4. Launch Chrome in kiosk mode

:: start chrome.exe --kiosk --incognito --disable-pinch --overscroll-history-navigation=0 "http://localhost:3000"
start chrome.exe "http://localhost:3000"