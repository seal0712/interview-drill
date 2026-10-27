@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo 第一次啟動：正在建立執行環境並安裝套件，大約需要一兩分鐘……
  python -m venv .venv || (echo 找不到 Python，請先到 https://www.python.org 安裝 Python 3.10 以上版本，安裝時勾選 Add python.exe to PATH。& pause & exit /b 1)
  .venv\Scripts\python -m pip install -q -r requirements.txt || (echo 套件安裝失敗，請確認網路連線後再試一次。& pause & exit /b 1)
)
.venv\Scripts\python run.py
pause
