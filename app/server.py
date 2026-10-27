"""本機伺服器：提供網頁、存取 data/ 裡的資料、呼叫 AI 出題與批改。只接受本機連線。"""
import base64
import json
import os
import threading
import time
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import ai, prompts, store
from .extract import extract

WEB = os.path.join(store.ROOT, "web")
MAX_FOLLOW = 2   # 第一次回答之後最多追問 2 次，而且每次都由考生自己選擇要不要回答
TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}

JOB = {"running": False, "done": 0, "total": 0, "message": "", "error": "", "warnings": []}


def now():
    return datetime.now().isoformat(timespec="seconds")


def new_id(prefix):
    return prefix + format(int(time.time() * 1000), "x")


def public_config(cfg):
    c = {k: v for k, v in cfg.items() if k != "api_key"}
    c["has_key"] = bool(cfg.get("api_key"))
    return c


def state():
    docs = [{k: v for k, v in d.items() if k != "text"} for d in store.load("docs")]
    return {"config": public_config(store.load("config")), "profile": store.load("profile"), "docs": docs,
            "bank": store.load("bank"), "progress": store.load("progress"), "attempts": store.load("attempts"),
            "job": JOB}


def save_config(body):
    cfg = store.load("config")
    for k in ("provider", "base_url", "model", "effort"):
        if k in body:
            cfg[k] = str(body[k]).strip()
    if body.get("api_key"):
        cfg["api_key"] = body["api_key"].strip()
    if body.get("max_chars"):
        cfg["max_chars"] = max(4000, int(body["max_chars"]))
    store.save("config", cfg)
    return {"config": public_config(cfg)}


def test_ai(_):
    text, model = ai.chat(store.load("config"), "", [{"role": "user", "content": "請只回覆「連線成功」四個字。"}], max_tokens=2000)
    return {"reply": text[:200], "model": model}


def save_profile(body):
    schools = []
    for i, s in enumerate(body.get("schools", [])):
        if str(s.get("name", "")).strip():
            schools.append({"id": s.get("id") or new_id("s") + str(i), "name": s["name"].strip(),
                            "short": str(s.get("short", "")).strip(), "date": s.get("date", ""),
                            "style": str(s.get("style", "")).strip()})
    profile = {"schools": schools, "notes": str(body.get("notes", "")).strip()}
    store.save("profile", profile)
    return {"profile": profile}


def upload(body):
    text, warn = extract(body["filename"], base64.b64decode(body["data"]))
    doc = {"id": new_id("d"), "filename": body["filename"], "kind": body.get("kind", "review"),
           "schools": body.get("schools", []), "text": text, "chars": len(text), "warning": warn, "added": now()}
    docs = store.load("docs")
    docs.append(doc)
    store.save("docs", docs)
    return {"doc": {k: v for k, v in doc.items() if k != "text"}}


def delete_doc(body):
    store.save("docs", [d for d in store.load("docs") if d["id"] != body["id"]])
    return {}


def save_progress(body):
    store.save("progress", body["progress"])
    return {}


def save_attempt(body):
    a = body["attempt"]
    rest = [x for x in store.load("attempts") if x.get("id") != a["id"]]
    store.save("attempts", rest + [a])
    return {}


def delete_question(body):
    bank = store.load("bank")
    bank["questions"] = [q for q in bank["questions"] if q["id"] != body["id"]]
    for s in bank["sections"]:
        s["qs"] = [x for x in s["qs"] if x != body["id"]]
    store.save("bank", bank)
    return {"bank": bank}


def list_models(_):
    return {"models": ai.list_models(store.load("config"))}


# ---------- 出題 ----------

def chat_json(cfg, prompt):
    """出題用：格式跑掉時再試一次。"""
    for attempt in range(2):
        try:
            text, model = ai.chat(cfg, prompts.GEN_SYSTEM, [{"role": "user", "content": prompt}])
            return ai.parse_json(text), model
        except ai.AIError as e:
            if attempt or "格式" not in str(e):
                raise


def norm_question(x, gid, n, sids, sec):
    if not isinstance(x, dict) or not str(x.get("q", "")).strip():
        return None
    facts = []
    for f in x.get("facts") or []:
        if isinstance(f, dict) and f.get("t"):
            facts.append([str(f["t"]), str(f.get("src", ""))])
        elif isinstance(f, (list, tuple)) and f:
            facts.append([str(f[0]), str(f[1]) if len(f) > 1 else ""])
    as_list = lambda v: [str(t) for t in v if str(t).strip()] if isinstance(v, list) else []
    return {"id": f"{gid}-q{n}", "s": sids, "sec": sec, "cat": str(x.get("cat") or "其他").strip()[:12],
            "q": str(x["q"]).strip(), "why": str(x.get("why", "")), "f": facts,
            "u": as_list(x.get("followups")), "w": as_list(x.get("cautions"))}


def run_generate():
    try:
        cfg, profile, docs = store.load("config"), store.load("profile"), store.load("docs")
        schools = profile["schools"]
        reviews = [d for d in docs if d["kind"] == "review"]
        size = max(1500, min(4000, int(cfg.get("max_chars", 60000)) // 3))
        plan = []
        for d in reviews:
            sids = d["schools"] or [s["id"] for s in schools]
            plan += [(d, sids, body, label) for body, label in prompts.split_chunks(d["text"], size)]
        JOB.update(total=len(plan) + len(schools))
        gid, sections, questions, used = new_id("g"), [], [], ""

        def add(items, sids, sec):
            ids = []
            for x in items if isinstance(items, list) else []:
                q = norm_question(x, gid, len(questions) + 1, sids, sec)
                if q:
                    questions.append(q)
                    ids.append(q["id"])
            return ids

        for i, (d, sids, body, label) in enumerate(plan):
            JOB.update(done=i, message=f"正在讀「{d['filename']}」{label}，出這段的題目")
            sec_id = f"{gid}-s{i + 1}"
            sch = [s for s in schools if s["id"] in sids]
            try:
                res, used = chat_json(cfg, prompts.section_prompt(sch, profile, d["filename"], label, body))
            except ai.AIError as e:
                JOB["warnings"].append(f"「{d['filename']}」{label} 沒出成題目：{e}")
                res = {}
            sections.append({"id": sec_id, "doc": d["id"], "file": d["filename"], "pages": label,
                             "title": str(res.get("title") or f"{d['filename']} {label}"), "intro": str(res.get("intro", "")),
                             "raw": body, "s": sids, "qs": add(res.get("questions"), sids, sec_id)})

        limit = int(cfg.get("max_chars", 60000)) - 4000
        for j, s in enumerate(schools):
            JOB.update(done=len(plan) + j, message=f"正在出「{s['name']}」的綜合題")
            full = "\n\n".join(f"【檔案：{d['filename']}】\n{d['text']}" for d in reviews if not d["schools"] or s["id"] in d["schools"])
            if len(full) <= limit:
                material, is_full = full, True
            else:
                material, is_full = "\n".join(f"【{x['title']}】{x['intro']}" for x in sections if s["id"] in x["s"]), False
            try:
                res, used = chat_json(cfg, prompts.overall_prompt(s, profile, material, is_full))
                add(res.get("questions"), [s["id"]], None)
            except ai.AIError as e:
                JOB["warnings"].append(f"「{s['name']}」的綜合題沒出成：{e}")

        if not questions:
            raise ai.AIError("一題都沒有出成功。" + (JOB["warnings"][0] if JOB["warnings"] else ""))
        store.save("bank", {"id": gid, "generated_at": now(), "model": used, "sections": sections,
                            "questions": questions, "warnings": JOB["warnings"]})
        JOB.update(done=JOB["total"], message=f"完成，共出了 {len(questions)} 題。")
    except Exception as e:
        if not isinstance(e, (ai.AIError, ValueError)):
            traceback.print_exc()
        JOB.update(error=str(e) or "出題失敗。")
    finally:
        JOB["running"] = False


def generate(_):
    if JOB["running"]:
        return {"job": JOB}
    profile, docs = store.load("profile"), store.load("docs")
    if not store.load("config").get("model"):
        raise ValueError("請先完成第 1 步：設定 AI 服務。")
    if not profile["schools"]:
        raise ValueError("請先完成第 2 步：至少填一個要面試的學校系所。")
    if not any(d["kind"] == "review" for d in docs):
        raise ValueError("請先完成第 3 步：至少上傳一份「審查資料」。")
    JOB.update(running=True, done=0, total=0, message="準備中…", error="", warnings=[])
    threading.Thread(target=run_generate, daemon=True).start()
    return {"job": JOB}


# ---------- 批改 ----------

def grade(body):
    cfg, profile, docs, bank = store.load("config"), store.load("profile"), store.load("docs"), store.load("bank")
    q = next((x for x in bank["questions"] if x["id"] == body["qid"]), None)
    if not q:
        raise ValueError("找不到這一題，題庫可能已經重新產生過。")
    school = next((s for s in profile["schools"] if s["id"] == body.get("school")), None) or profile["schools"][0]
    mine = lambda kind: [d for d in docs if d["kind"] == kind and (not d["schools"] or school["id"] in d["schools"])]
    review = "\n\n".join(f"【檔案：{d['filename']}】\n{d['text']}" for d in mine("review"))
    background = "\n\n".join(f"【檔案：{d['filename']}】\n{d['text']}" for d in mine("background"))
    budget, note = int(cfg.get("max_chars", 60000)), ""
    full = len(review) <= budget
    if not full:
        sec = next((s for s in bank["sections"] if s["id"] == q.get("sec")), None)
        review = sec["raw"] if sec else "\n".join(f"【{s['title']}】{s['intro']}" for s in bank["sections"] if school["id"] in s["s"])
        note = "審查資料超過字數上限，這次只送了這題相關的段落。"
    if background and len(review) + len(background) > budget:
        background = ""
        note += "補充背景超過字數上限，這次沒有送。"
    system = prompts.grade_system(school, profile, review, full, background)
    rounds = body.get("rounds", [])
    text, model = ai.chat(cfg, system, prompts.grade_turns(q, rounds, body["answer"], MAX_FOLLOW))
    fb = ai.parse_json(text)
    as_list = lambda v: [str(t) for t in v] if isinstance(v, list) else []
    clean = {
        "verdict": fb.get("verdict") if fb.get("verdict") in ("good", "partial", "wrong", "blank") else "partial",
        "errors": [e for e in fb.get("errors") or [] if isinstance(e, dict) and (e.get("said") or e.get("fact"))],
        "missing": as_list(fb.get("missing")), "wording": as_list(fb.get("wording")),
        "good": str(fb.get("good") or ""), "advice": as_list(fb.get("advice")),
        "followup": str(fb.get("followup") or "") if len(rounds) < MAX_FOLLOW else "",
    }
    return {"fb": clean, "model": model, "school": school["name"], "note": note}


ROUTES = {"/api/config": save_config, "/api/test-ai": test_ai, "/api/models": list_models,
          "/api/profile": save_profile, "/api/docs/upload": upload, "/api/docs/delete": delete_doc,
          "/api/generate": generate, "/api/grade": grade, "/api/progress": save_progress,
          "/api/attempt": save_attempt, "/api/questions/delete": delete_question}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            return self.send(200, state())
        if path == "/api/job":
            return self.send(200, JOB)
        name = "index.html" if path == "/" else path.lstrip("/")
        if name in os.listdir(WEB):
            with open(os.path.join(WEB, name), "rb") as f:
                return self.send(200, f.read(), TYPES.get(os.path.splitext(name)[1], "application/octet-stream") + "; charset=utf-8")
        self.send(404, {"error": "not found"})

    def do_POST(self):
        fn = ROUTES.get(self.path)
        if not fn:
            return self.send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            self.send(200, fn(body))
        except (ai.AIError, ValueError) as e:
            self.send(400, {"error": str(e)})
        except Exception as e:
            traceback.print_exc()
            self.send(500, {"error": f"程式出錯：{e}"})


class Server(ThreadingHTTPServer):
    # Windows 上開著這個選項時，埠號被別的程式占用也不會報錯，兩邊會搶同一個埠
    allow_reuse_address = False


def serve(port):
    return Server(("127.0.0.1", port), Handler)
