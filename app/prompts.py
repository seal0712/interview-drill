"""出題與批改用的提示詞。"""
import json
import re

GEN_SYSTEM = ("你是協助考生準備碩士班甄試口試（也適用其他升學或求職面試）的出題老師，熟悉台灣口試委員的提問方式。"
              "你只根據考生提供的資料出題，不編造資料裡沒有的經歷、數字或事實。一律使用繁體中文，不使用日文。"
              "只回傳 JSON，不要任何其他文字。")

QUESTION_FIELDS = """每題附上：
- cat：題目類別，2～8 字（例如「研究計畫」「成績」「專題」「動機」「基礎觀念」）
- q：題目，用委員當面問的口吻
- why：出題用意，委員想確認什麼（一句話）
- facts：回答時要用到的關鍵事實，2～4 條。每條都必須能在提供的資料裡找到，src 寫出處（檔名與頁碼）；專業觀念題的事實可以是該觀念的正確說明，src 寫「觀念」
- followups：委員可能接著追問的 1～2 句
- cautions：考生回答時容易講錯、誇大或不能講的地方（依口徑提醒與資料內容判斷，沒有就給空陣列）"""

QUESTION_JSON = '{"cat":"...","q":"...","why":"...","facts":[{"t":"...","src":"..."}],"followups":["..."],"cautions":["..."]}'


def school_desc(s):
    line = f"- {s['name']}" + (f"（面試日期 {s['date']}）" if s.get("date") else "")
    if s.get("style"):
        line += f"\n  口試形式與重點：{s['style']}"
    return line


def notes_block(profile):
    n = (profile.get("notes") or "").strip()
    return f"\n考生自訂的口徑提醒（不能講或要特別注意的說法）：\n{n}\n" if n else ""


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
    return f"""考生要參加以下口試：
{chr(10).join(school_desc(s) for s in schools)}
{notes_block(profile)}
下面是考生交給學校的審查資料中的一段（出自「{filename}」{pages}）。請：
1. 幫這段取一個簡短標題（12 字以內），並用一兩句話說明這段在講什麼、委員讀到這裡最可能注意什麼（intro）。
2. 依這段內容出 2～4 題委員最可能問的題目；這段若只是封面、目錄或沒有實質內容，可以出 0 題。題目要具體扣住這段內容，例如：要求說明自己實際做了什麼、追問數字與方法的前提、質疑弱點或落差、確認是否真的理解用到的方法。
{QUESTION_FIELDS}

只回傳一個 JSON 物件：
{{"title":"...","intro":"...","questions":[{QUESTION_JSON}]}}

===== 資料段落 =====
{chunk}
===== 段落結束 ====="""


def overall_prompt(school, profile, material, is_full):
    what = "全文" if is_full else "各段摘要（全文太長，這裡只列每段的標題與重點）"
    return f"""考生要參加以下口試：
{school_desc(school)}
{notes_block(profile)}
下面是考生交給這所學校的審查資料{what}。
請出 6～10 題「綜合題」：不屬於單一段落、而是委員看完整份資料後會問的題目。要涵蓋：一分鐘自我介紹、為什麼選這個系所、入學後與畢業後的規劃、資料中最明顯的弱點或風險（例如成績、經歷落差、跨領域背景）、跨段落的整合或矛盾。口試形式說明若有特別重點，也要出題。
資料裡沒有提到的系所特色、老師或課程，不要自己編；這類題目的 facts 只寫考生資料裡自己寫的內容。
{QUESTION_FIELDS}

只回傳一個 JSON 物件：
{{"questions":[{QUESTION_JSON}]}}

===== 審查資料 =====
{material}
===== 審查資料結束 ====="""


def grade_system(school, profile, review_text, review_is_full, background):
    style = f"\n口試形式與重點：{school['style']}" if school.get("style") else ""
    scope = "全文" if review_is_full else "與這題相關的段落（全文太長，只附這部分）"
    bg = f"""

===== 補充背景（委員看不到，只供核對與建議） =====
{background}
===== 補充背景結束 =====""" if background else ""
    return f"""你是{school['name']}的口試委員。口試前你已經完整審閱過這位考生交來的審查資料（{scope}附在最後），現在當面問他問題。{style}
考生的回答多半是語音輸入轉成的文字，可能有錯字、同音字或口語贅字，這些不扣分。

你手上的資料用途不同：
- 「審查資料」：委員實際讀過的內容。你的追問與對說服力的判斷，都站在只讀過這份資料的委員立場。
- 「補充背景」（如果有）：委員看不到，只用來核對考生口頭補充的細節是否屬實，以及找出資料沒寫、但真實存在、可以口頭補充的更有力證據。背景裡標明不對外說的內容不可建議考生說出。
{notes_block(profile)}
===== 審查資料 =====
{review_text}
===== 審查資料結束 ====={bg}"""


def grade_first(q, answer):
    facts = "\n".join(f"- {t}（出處：{s}）" for t, s in q.get("f", []))
    warn = "口徑提醒（考生容易講錯或不能講的地方）：\n" + "\n".join("- " + x for x in q["w"]) + "\n" if q.get("w") else ""
    return f"""這一題：{q['q']}
出題用意：{q.get('why', '')}
重點提示（從審查資料整理出來的關鍵事實，供你快速對照）：
{facts}
{warn}
請像真正讀過資料的委員那樣批改，依序做：
1. 事實核對：考生講的經歷、數字、角色、時間，要和審查資料、補充背景一致；不一致就列進 errors（said＝考生說的，fact＝資料上的內容，並註明是哪份資料）。資料都沒提到的個人經歷不要判錯，也不要自己編造任何經歷或數字。出處標「觀念」的專業觀念題，依你的專業判斷對錯。
2. 委員觀點：評估這段回答在委員眼中的說服力。有沒有回應到出題用意、邏輯是否連貫、夠不夠具體、有沒有講得比資料更誇大、有沒有主動交代限制，以及有沒有漏掉資料裡其實更有力的證據（列進 missing，寫成簡短名稱）。
3. 建議（advice）：2～3 條具體的改進方向，例如該補哪個證據、哪個說法會被質疑要先處理、順序怎麼調整、哪裡講太多可以收。只給方向，不要寫範本答案，也不要替考生寫可以直接背的句子。
4. 口徑：違反口徑提醒的地方列進 wording。
5. 追問：以委員的身分，從審查資料與這次回答裡挑最可能被追問的地方（資料中的弱點、數字的口徑、方法的前提、和其他段落的矛盾），問一句。追問必須緊扣這一題的出題用意，不要跳到別的主題；委員看不到補充背景，追問不要用到只有背景才有的資訊。沒有值得追問的就留空字串。
6. 繁體中文，語氣像溫和但認真的委員，不用日文。

只回傳一個 JSON 物件：
{{"verdict":"good|partial|wrong|blank","errors":[{{"said":"考生說的","fact":"資料上的內容"}}],"missing":["漏掉的重點或更有力的證據"],"wording":["違反口徑的地方"],"good":"一句話說哪裡講得好，沒有就空字串","advice":["改進方向"],"followup":"委員的追問"}}
verdict：good＝事實正確、回應到出題用意且有說服力；partial＝沒講錯，但不夠具體、漏了重要內容或說服力不足；wrong＝有和資料矛盾的事實或錯誤觀念；blank＝沒有回答到題目。

考生的回答：
{answer}"""


def grade_turns(q, rounds, answer, max_follow):
    """rounds：之前各輪 [{answer, fb}]。組成多輪對話：第一輪題目＋回答，之後每輪是委員的 JSON 與考生對追問的回答。"""
    answers = [r["answer"] for r in rounds] + [answer]
    turns = [{"role": "user", "content": grade_first(q, answers[0])}]
    for i, r in enumerate(rounds):
        asked = "、".join("「" + x["fb"].get("followup", "") + "」" for x in rounds[:i + 1])
        last = i + 1 >= max_follow
        turns.append({"role": "assistant", "content": json.dumps(r["fb"], ensure_ascii=False)})
        turns.append({"role": "user", "content":
                      f"考生對追問「{r['fb'].get('followup', '')}」的回答：\n{answers[i + 1]}\n\n"
                      f"只批改這段追問的回答：errors、missing、advice 只針對這個追問，前面幾輪已經講過、講對或建議過的內容不要再列。"
                      f"已經問過的追問：{asked}，不要重複或換句話再問。"
                      + ("這是最後一輪，followup 一律留空字串。" if last else "沒有值得再問的就把 followup 留空字串。")
                      + "只回傳同格式的 JSON。"})
    return turns
