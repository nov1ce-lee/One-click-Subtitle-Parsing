@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   One-click Subtitle Parsing - One-click Setup & Run
echo ===================================================

REM 1. Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.11+ and add it to PATH.
    echo Download: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo [OK] Python found.

REM 2. Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js (LTS).
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found.

REM 3. Create Virtual Environment if not exists
if not exist ".venv" (
    echo [INFO] Creating Python virtual environment...
    python -m venv .venv
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
) else (
    echo [OK] Virtual environment exists.
)

REM 4. Activate Venv and Install Dependencies
call .venv\Scripts\activate.bat
echo [INFO] Installing Python dependencies...
pip install -r asr-backend\requirements.txt
if !errorlevel! neq 0 (
    echo [ERROR] Failed to install Python dependencies.
    pause
    exit /b 1
)

REM 5. Run DLL Setup
echo [INFO] Setting up CUDA libraries...
python setup_libs.py
if !errorlevel! neq 0 (
    echo [WARNING] DLL setup script failed. You might need to install CUDA manually if GPU fails.
)

REM 6. Install Node Modules
cd electron
if not exist "node_modules" (
    echo [INFO] Installing Node.js dependencies...
    call npm install
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to install npm dependencies.
        cd ..
        pause
        exit /b 1
    )
) else (
    echo [OK] Node modules exist.
)

REM 7. Start Electron
echo [INFO] Starting application...
call npm start
if !errorlevel! neq 0 (
    echo [ERROR] Application failed to start.
    cd ..
    pause
    exit /b 1
)

cd ..
echo [INFO] Application closed.
pause
