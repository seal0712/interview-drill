"""出題與批改用的提示詞。文字都在 web/prompts.json（網頁版也讀同一份），這裡只負責把資料填進去。"""
import json
import os
import re

from .store import ROOT

with open(os.path.join(ROOT, "web", "prompts.json"), encoding="utf-8") as f:
    T = json.load(f)

GEN_SYSTEM = T["gen_system"]


def fill(_key, **v):
    """把 {{名稱}} 換成對應的值；填進去的內容不會再被替換。"""
    return re.sub(r"\{\{(\w+)\}\}", lambda m: str(v.get(m.group(1), T.get(m.group(1), ""))), T[_key])


def school_desc(s):
    return fill("school_line", name=s["name"], date=fill("school_date", date=s["date"]) if s.get("date") else "",
                style=fill("school_style", style=s["style"]) if s.get("style") else "")


def notes_block(profile):
    n = (profile.get("notes") or "").strip()
    return fill("notes", notes=n) if n else ""


def split_chunks(text, size):
    """依行切段，每段不超過 size 字；接近上限時優先在頁碼標記處切。回傳 [(段落文字, 頁碼標示)]。"""
    out, cur, page, first = [], [], None, None
    length = 0

    def push():
        body = "\n".join(cur).strip()
        if body:
            pages = re.findall(r"【第 (\d+) 頁】", body)
            start = first if not body.startswith("【第") and first else (pages[0] if pages else None)
            end = pages[-1] if pages else start
            label = "" if not start else (f"第 {start} 頁" if start == end else f"第 {start}–{end} 頁")
            out.append((body, label))

    for line in text.split("\n"):
        m = re.match(r"【第 (\d+) 頁】", line)
        if cur and (length + len(line) > size or (m and length > size * 0.6)):
            push()
            cur, length, first = [], 0, page
        if m:
            page = m.group(1)
        cur.append(line)
        length += len(line) + 1
    push()
    return out


def section_prompt(schools, profile, filename, pages, chunk):
    return fill("section", schools="\n".join(school_desc(s) for s in schools), notes=notes_block(profile),
                filename=filename, pages=pages, chunk=chunk)


def overall_prompt(school, profile, material, is_full):
    return fill("overall", school=school_desc(school), notes=notes_block(profile), material=material,
                what=T["overall_full"] if is_full else T["overall_summary"])


def grade_system(school, profile, review_text, review_is_full, background):
    return fill("grade_system", name=school["name"], notes=notes_block(profile), review=review_text,
                scope=T["grade_scope_full"] if review_is_full else T["grade_scope_part"],
                style=fill("grade_style", style=school["style"]) if school.get("style") else "",
                background=fill("grade_background", background=background) if background else "")


def grade_first(q, answer):
    facts = "\n".join(fill("grade_fact", t=t, src=s) for t, s in q.get("f", []))
    warn = fill("grade_warn", items="\n".join("- " + x for x in q["w"])) if q.get("w") else ""
    return fill("grade_first", q=q["q"], why=q.get("why", ""), facts=facts, warn=warn, answer=answer)


def grade_turns(q, rounds, answer, max_follow):
    """rounds：之前各輪 [{answer, fb}]。組成多輪對話：第一輪題目＋回答，之後每輪是委員的 JSON 與考生對追問的回答。"""
    answers = [r["answer"] for r in rounds] + [answer]
    turns = [{"role": "user", "content": grade_first(q, answers[0])}]
    for i, r in enumerate(rounds):
        asked = "、".join("「" + x["fb"].get("followup", "") + "」" for x in rounds[:i + 1])
        turns.append({"role": "assistant", "content": json.dumps(r["fb"], ensure_ascii=False)})
        turns.append({"role": "user", "content": fill(
            "grade_follow", followup=r["fb"].get("followup", ""), answer=answers[i + 1], asked=asked,
            last=T["grade_follow_last"] if i + 1 >= max_follow else T["grade_follow_more"])})
    return turns
