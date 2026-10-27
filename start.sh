#!/bin/sh
# macOS／Linux 啟動方式：在終端機執行 sh start.sh
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "第一次啟動：正在建立執行環境並安裝套件，大約需要一兩分鐘……"
  python3 -m venv .venv || { echo "找不到 Python 3，請先安裝 Python 3.10 以上版本。"; exit 1; }
  .venv/bin/python -m pip install -q -r requirements.txt || { echo "套件安裝失敗，請確認網路連線後再試一次。"; exit 1; }
fi
.venv/bin/python run.py
