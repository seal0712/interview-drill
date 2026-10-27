@echo off
rem Windows launcher: double-click to start. First run creates .venv and installs requirements.
cd /d "%~dp0"
if exist .venv\Scripts\python.exe goto run
echo First run: creating the environment and installing packages (about 1-2 minutes)...
python -m venv .venv
if errorlevel 1 goto nopython
.venv\Scripts\python -m pip install -q -r requirements.txt
if errorlevel 1 goto nopip
:run
.venv\Scripts\python run.py
pause
exit /b
:nopython
echo Python was not found. Install Python 3.10 or later from https://www.python.org
echo and tick "Add python.exe to PATH" during installation.
if exist .venv rmdir /s /q .venv
pause
exit /b 1
:nopip
echo Package installation failed. Check your internet connection and run start.bat again.
rmdir /s /q .venv
pause
exit /b 1
