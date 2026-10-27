"""所有使用者資料都存在 data/ 資料夾（已排除在 git 之外）。"""
import json
import os
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("INTERVIEW_DRILL_DATA") or os.path.join(ROOT, "data")
_lock = threading.Lock()

DEFAULTS = {
    "config": {"provider": "openai", "base_url": "", "api_key": "", "model": "", "effort": "", "max_chars": 60000},
    "profile": {"schools": [], "notes": ""},
    "docs": [],
    "bank": None,
    "progress": {},
    "attempts": [],
}


def load(name):
    path = os.path.join(DATA, name + ".json")
    with _lock:
        if not os.path.exists(path):
            d = DEFAULTS[name]
            return json.loads(json.dumps(d))
        with open(path, encoding="utf-8") as f:
            return json.load(f)


def save(name, value):
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, name + ".json")
    with _lock:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
