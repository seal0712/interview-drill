# 面試練習工具（interview-drill）

上傳你交給學校的審查資料（自傳、讀書計畫、作品集），讓你自己選的 AI 扮演口試委員：依資料出題、批改你的口頭回答、追問。全部在自己的電腦上執行，資料只會送到你選的 AI 服務。

A local, provider-agnostic mock-interview tool for graduate admission oral exams (Traditional Chinese UI). Upload your application documents, and an AI of your choice (OpenAI-compatible APIs, Anthropic, or a local model via LM Studio / Ollama) generates questions, grades your spoken answers, and asks follow-ups.

## 功能

- **讀資料**：把審查資料切成一段一段，每段附上委員可能注意的重點與題目，讀完一段就能只練這段。
- **抽題練習**：倒數計時（60／90／120 秒），用語音輸入回答後交給「委員」批改。批改會核對事實、指出漏掉的重點與違反口徑的說法，只給改進方向，不給範本答案。委員可能會追問，但要不要回答由你決定，最多追問 2 次。
- **口語分析**：講了多久、每分鐘幾個字、口頭禪（然後、就是、那個……）出現幾次。
- **錯題本**：每題最近一次的批改意見逐條列出，想通了就勾掉；重練時會提醒上次沒改好的地方。
- **題庫**：AI 出的所有題目、事實卡與出處。不像委員會問的題目可以刪掉。
- **多校**：可以同時準備好幾間學校，各校的審查資料、面試日期與口試形式分開設定。

## 需要準備

1. **Python 3.10 以上**：到 <https://www.python.org/downloads/> 下載。Windows 安裝時要勾選「Add python.exe to PATH」。
2. **一個 AI 服務**，以下擇一：
   - 雲端服務的 API key（OpenAI、Google Gemini、DeepSeek、OpenRouter、Anthropic 等）。依用量付費。
   - 本機模型：[LM Studio](https://lmstudio.ai/) 或 [Ollama](https://ollama.com/)。免費，但出題與批改品質比雲端大模型弱，電腦也要夠力。

## 安裝與啟動

先下載這個專案：按 GitHub 頁面上的綠色「Code」→「Download ZIP」並解壓縮。會用 git 的話也可以 `git clone`。

- **Windows**：在資料夾裡雙擊 `start.bat`。
- **macOS／Linux**：在資料夾裡開終端機，執行 `sh start.sh`。

第一次啟動會自動建立執行環境並安裝套件，大約需要一兩分鐘。完成後瀏覽器會自動打開 <http://127.0.0.1:8765/>。之後每次使用都一樣雙擊啟動；要結束時，回到黑色視窗按 `Ctrl+C`。

想自己手動安裝的話：

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt   # macOS／Linux：.venv/bin/python -m pip ...
.venv\Scripts\python run.py                               # 換埠號：run.py --port 8800
```

## 第一次使用：四個步驟

打開後會停在「設定」分頁，依序完成：

1. **AI 服務**：點一個常用服務的按鈕，會自動填好網址。填入 API key，按「讀取模型清單」選模型，按「測試連線」確認能用。
2. **面試資訊**：每個要面試的學校系所填一筆，包括全名、簡稱和面試日期。「口試形式與重點」可以貼簡章上的口試說明。「口徑提醒」寫你自己知道、但資料上看不出來的規則，例如「競賽只講佳作，不講名次」。
3. **上傳資料**：
   - **審查資料**：你實際交給學校的文件，委員看得到，題目從這裡出。
   - **補充背景**：委員看不到、但你想讓 AI 拿來核對事實的資料，例如專案完整紀錄。不會拿來出題。
   - 支援 PDF、Word（.docx）、Markdown、純文字。PDF 要能選取文字，掃描檔讀不到。
4. **產生題庫**：AI 會逐段出題，再替每個學校出綜合題，例如自我介紹、動機、弱點。完成後就會帶你到「讀資料」。

想先試用的話，`examples/` 資料夾裡有一份虛構人物的範例資料。

## AI 服務設定參考

| 服務 | 介面類型 | API 網址 |
|---|---|---|
| OpenAI | OpenAI 相容 | `https://api.openai.com/v1` |
| Google Gemini | OpenAI 相容 | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| DeepSeek | OpenAI 相容 | `https://api.deepseek.com` |
| OpenRouter | OpenAI 相容 | `https://openrouter.ai/api/v1` |
| LM Studio（本機） | OpenAI 相容 | `http://localhost:1234/v1` |
| Ollama（本機） | OpenAI 相容 | `http://localhost:11434/v1` |
| Anthropic（Claude） | Anthropic | 留空 |

模型名稱各家不同，而且常常更新。按「讀取模型清單」就能列出你的帳號可用的模型。Anthropic 預設填 `claude-opus-5-5`，「思考深度」預設 high，這兩個欄位都可以改。

**本機模型的建議設定**：在 LM Studio 載入模型時，把 context length 調到 16384 以上；在本工具把「一次最多送給 AI 的字數」設為 8000，選本機服務的按鈕時會自動填好。審查資料超過這個字數時，批改只會送這題相關的段落。

我們拿範例資料（約 1,000 字）在 LM Studio 的 qwen3-14b 上試過一次：出題花 48 秒，批改一題 12 秒。它抓到了講錯的數字和違反口徑的說法，但漏掉了「說自己一個人做完、資料上卻是三人組」這種要對照兩份資料才看得出的矛盾。這只是一台電腦上的一次測試，實際速度看你的硬體，品質看你選的模型。重要的面試，建議用雲端大模型。

## 費用與隱私

- **資料存放**：設定、API key、上傳的資料、題庫、練習紀錄全部存在專案的 `data/` 資料夾，不會上傳到任何地方，也已經排除在 git 之外。要備份就複製這個資料夾；刪掉它就能重新開始。
- **送給 AI 的內容**：出題和批改時，你的審查資料與回答會送到你選的 AI 服務，請先確認你接受該服務的資料政策。用本機模型的話，資料完全不會離開你的電腦。
- **自動遮蔽**：上傳時會把 Email、手機與市話號碼、身分證字號換成「〔已遮蔽〕」。姓名、學號不會遮，介意的話請在上傳前自己刪掉。
- **費用**：每次批改都會附上該校的審查資料全文（超過字數上限時改送相關段落）。用 Anthropic 時會自動啟用提示快取，重複送出的資料費用較低。
- **只接受本機連線**：伺服器只聽 `127.0.0.1`，同一個網路裡的其他裝置連不進來。

## 常見問題

- **啟動時說埠號已被使用**：有別的程式占用了 8765，改用 `run.py --port 8800` 之類的其他埠號。
- **PDF 上傳後顯示「幾乎讀不到文字」**：那是掃描檔，請改傳 Word 檔或可以選取文字的 PDF。
- **出題時有幾段「沒出成功」**：多半是模型回傳的格式跑掉了，本機小模型比較常發生。按「重新產生題庫」再試一次，或換一個較大的模型。
- **怎麼用說的回答**：用作業系統內建的語音輸入。Windows 按 `Windows 鍵＋H`，Mac 按兩下 `Fn`。答案框一出現字就會自動開始計時。

## 授權

MIT License，見 [LICENSE](LICENSE)。
