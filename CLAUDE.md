# 面試練習工具 入口

把推甄口試抽題卡（`Desktop\推甄\09_面試準備\口試抽題卡.html`）改寫成不綁 Claude 的開源工具，預計公開到 GitHub `seal0712/interview-drill`。兩種用法：網頁版（GitHub Pages，手機打開網址就能用，資料存在瀏覽器）與 Python 版（本機伺服器，可接 LM Studio）。使用者第一次打開時上傳自己的審查資料，由自己選的 AI 出題與批改。沒有截止日。

## 資料夾地圖
- `run.py`、`start.bat`、`start.sh`：啟動入口（bat／sh 第一次會自動建 .venv 並安裝 requirements.txt）
- `app/`：後端（`server.py` 路由、出題工作與批改；`ai.py` OpenAI 相容／Anthropic 兩種接法；`extract.py` 讀檔與遮蔽個資；`prompts.py` 提示詞；`store.py` 存取 data/）
- `web/`：前端兼網頁版（`app.js` 畫面，由原抽題卡改寫；`backend.js` 網頁版後端，找不到本機伺服器時在瀏覽器裡出題批改、存 IndexedDB；`prompts.json` 兩個後端共用的提示詞）
- `.github/workflows/pages.yml`：推上 main 時把 web/ 發布到 GitHub Pages
- `examples/`：虛構人物的範例資料，測試用
- `data/`：使用者的設定、API key、上傳資料、題庫、練習紀錄（gitignore，絕不進 git）

## 工作規則
- repo 會公開：不得放入任何使用者本人資料（推甄文件、姓名、學號、信箱、電話）；推上 GitHub 前先問，並 grep 個資
- 原抽題卡的設計要保留：追問選擇性、最多 2 次、緊扣原題；只給改進方向不給範本答案；審查資料（委員看得到）與補充背景（只供核對）分開
- 兩個後端（`app/server.py`、`web/backend.js`）路由一一對應，改流程要兩邊一起改；提示詞只改 `web/prompts.json`
- 網頁版讀 PDF 用 jsdelivr 的 pdfjs-dist 3.11.174（含 cmaps，中文字型沒內嵌的 PDF 才讀得到；cdnjs 沒有 cmaps）
- 埠號被占用時要報錯（Windows 的 allow_reuse_address 已關掉），不可悄悄共用埠
- 測試用 `INTERVIEW_DRILL_DATA=<scratchpad 路徑>` 指定資料夾，不要寫進專案的 data/

## 目前進度（2026-10-28）
- 第一版 Python 版完成並驗證（假 AI 全流程、瀏覽器實測、LM Studio qwen3-14b 實測、乾淨 clone 雙擊 start.bat、個資 grep 零筆）
- 10/28 使用者說朋友要用手機 → 加網頁版（使用者選「A 純網頁版＋保留 Python 版」）：畫面共用、提示詞抽成 prompts.json（新舊輸出 7 組情境比對相同）、新增備份與搬家（匯出不含 API key、匯入不動 AI 設定）
- 網頁版驗證：靜態伺服器模擬 GitHub Pages，自動判斷網頁模式；上傳 md／PDF（含未內嵌與內嵌中文字型）／docx、出題、批改、追問上限、匯出、Python 版備份匯入網頁版都通過；390／360 寬手機版面實測作答與批改正常；Python 版回歸測試通過
- start.bat 必須維持純 ASCII（中文會讓 cmd 解析錯亂，已踩過）
- 10/28 已公開：https://github.com/seal0712/interview-drill （建 repo 與開 Pages 被 auto mode 擋下，由使用者用 ! 指令親自執行）；網頁版 https://seal0712.github.io/interview-drill/ 部署成功，線上實測網頁模式、PDF 讀取與遮蔽正常
- 未驗證：真實雲端 API 實際呼叫（只做 CORS 預檢）、真手機（iPhone Safari／Android Chrome）
- 下一步：請朋友用真手機與自己的 API key 實測，回報問題再修；之後推新 commit 時同樣先問使用者
- 一段工作做完，把這一節更新成最新狀態
