# 面試練習工具 入口

把推甄口試抽題卡（`Desktop\推甄\09_面試準備\口試抽題卡.html`）改寫成不綁 Claude、可在任何電腦重現的開源工具，預計公開到 GitHub `seal0712/interview-drill`。使用者第一次打開時上傳自己的審查資料，由自己選的 AI 出題與批改。沒有截止日。

## 資料夾地圖
- `run.py`、`start.bat`、`start.sh`：啟動入口（bat／sh 第一次會自動建 .venv 並安裝 requirements.txt）
- `app/`：後端（`server.py` 路由、出題工作與批改；`ai.py` OpenAI 相容／Anthropic 兩種接法；`extract.py` 讀檔與遮蔽個資；`prompts.py` 提示詞；`store.py` 存取 data/）
- `web/`：前端（`app.js` 由原抽題卡改寫，保留讀資料、抽題練習、錯題本、題庫，新增設定精靈）
- `examples/`：虛構人物的範例資料，測試用
- `data/`：使用者的設定、API key、上傳資料、題庫、練習紀錄（gitignore，絕不進 git）

## 工作規則
- repo 會公開：不得放入任何使用者本人資料（推甄文件、姓名、學號、信箱、電話）；推上 GitHub 前先問，並 grep 個資
- 原抽題卡的設計要保留：追問選擇性、最多 2 次、緊扣原題；只給改進方向不給範本答案；審查資料（委員看得到）與補充背景（只供核對）分開
- 埠號被占用時要報錯（Windows 的 allow_reuse_address 已關掉），不可悄悄共用埠
- 測試用 `INTERVIEW_DRILL_DATA=<scratchpad 路徑>` 指定資料夾，不要寫進專案的 data/

## 目前進度（2026-10-28）
- 第一版完成：後端 API 以假 AI 服務跑通整個流程；下一步：瀏覽器實測畫面、LM Studio 實測、README
- 一段工作做完，把這一節更新成最新狀態
