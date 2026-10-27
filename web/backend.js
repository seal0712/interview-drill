/* 網頁版後端：連不到本機 Python 伺服器時（例如放在 GitHub Pages、用手機打開），改在瀏覽器裡出題、批改與存檔。
   路由與 app/server.py 一一對應，提示詞同樣讀 prompts.json；資料存在這個瀏覽器的 IndexedDB。改流程時兩邊要一起改。 */
const LocalBackend = (() => {
  const MAX_FOLLOW = 2;   // 第一次回答之後最多追問 2 次，而且每次都由考生自己選擇要不要回答
  // 這些 Claude 模型支援伺服器端備援：被安全機制擋下時，自動改用其他模型完成同一個請求
  const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];
  const BACKUP_KEYS = ["profile", "docs", "bank", "progress", "attempts"];   // 備份檔不含 AI 設定與 API key
  const DEFAULTS = {
    config: { provider: "openai", base_url: "", api_key: "", model: "", effort: "", max_chars: 60000 },
    profile: { schools: [], notes: "" }, docs: [], bank: null, progress: {}, attempts: [],
  };
  const CDN = {
    // 中文字型沒內嵌的 PDF 要靠 cmaps 才讀得出字，cdnjs 沒有這個資料夾，所以 PDF 相關的都用 jsdelivr
    pdf: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
    worker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
    cmaps: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",
    mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
  };
  const JOB = { running: false, done: 0, total: 0, message: "", error: "", warnings: [] };
  class AIError extends Error {}
  const now = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  const newId = prefix => prefix + Date.now().toString(16);

  /* ---------- 存檔 ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((ok, bad) => {
      const r = indexedDB.open("interview-drill", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => bad(new Error("瀏覽器不允許存資料（可能是無痕模式），請改用一般模式開啟。"));
    });
    return dbp;
  }
  async function load(k) {
    const d = await db();
    const v = await new Promise((ok, bad) => {
      const r = d.transaction("kv").objectStore("kv").get(k);
      r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
    });
    return v === undefined ? JSON.parse(JSON.stringify(DEFAULTS[k])) : v;
  }
  async function save(k, v) {
    const d = await db();
    await new Promise((ok, bad) => {
      const t = d.transaction("kv", "readwrite");
      t.objectStore("kv").put(v, k);
      t.oncomplete = ok; t.onerror = () => bad(t.error);
    });
  }

  /* ---------- 提示詞 ---------- */
  let T = null;
  const fill = (key, v = {}) => T[key].replace(/\{\{(\w+)\}\}/g, (_, k) => String(k in v ? v[k] : (T[k] ?? "")));
  const schoolDesc = s => fill("school_line", { name: s.name, date: s.date ? fill("school_date", { date: s.date }) : "",
    style: s.style ? fill("school_style", { style: s.style }) : "" });
  const notesBlock = p => ((p.notes || "").trim() ? fill("notes", { notes: p.notes.trim() }) : "");
  // 依行切段，每段不超過 size 字；接近上限時優先在頁碼標記處切。回傳 [[段落文字, 頁碼標示]]
  function splitChunks(text, size) {
    const out = [];
    let cur = [], page = null, first = null, length = 0;
    const push = () => {
      const body = cur.join("\n").trim();
      if (!body) return;
      const pages = [...body.matchAll(/【第 (\d+) 頁】/g)].map(m => m[1]);
      const start = !body.startsWith("【第") && first ? first : (pages[0] || null);
      const end = pages.length ? pages[pages.length - 1] : start;
      out.push([body, !start ? "" : start === end ? `第 ${start} 頁` : `第 ${start}–${end} 頁`]);
    };
    for (const line of text.split("\n")) {
      const m = line.match(/^【第 (\d+) 頁】/);
      if (cur.length && (length + line.length > size || (m && length > size * 0.6))) { push(); cur = []; length = 0; first = page; }
      if (m) page = m[1];
      cur.push(line); length += line.length + 1;
    }
    push();
    return out;
  }
  function gradeTurns(q, rounds, answer) {
    const answers = rounds.map(r => r.answer).concat([answer]);
    const facts = q.f.map(([t, src]) => fill("grade_fact", { t, src })).join("\n");
    const warn = q.w && q.w.length ? fill("grade_warn", { items: q.w.map(x => "- " + x).join("\n") }) : "";
    const turns = [{ role: "user", content: fill("grade_first", { q: q.q, why: q.why || "", facts, warn, answer: answers[0] }) }];
    rounds.forEach((r, i) => {
      const asked = rounds.slice(0, i + 1).map(x => "「" + (x.fb.followup || "") + "」").join("、");
      turns.push({ role: "assistant", content: JSON.stringify(r.fb) });
      turns.push({ role: "user", content: fill("grade_follow", { followup: r.fb.followup || "", answer: answers[i + 1], asked,
        last: i + 1 >= MAX_FOLLOW ? T.grade_follow_last : T.grade_follow_more }) });
    });
    return turns;
  }

  /* ---------- AI 服務 ---------- */
  const base = (cfg, dflt) => (cfg.base_url || dflt).replace(/\/+$/, "");
  const anthropicHeaders = cfg => ({ "Content-Type": "application/json", "x-api-key": cfg.api_key || "",
    "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
  const openaiHeaders = cfg => ({ "Content-Type": "application/json", ...(cfg.api_key ? { Authorization: "Bearer " + cfg.api_key } : {}) });
  async function http(url, opts) {
    let r;
    try { r = await fetch(url, opts); } catch (e) {
      throw new AIError("連不上 AI 服務：可能是網路中斷、API 網址打錯，或這家服務不允許網頁直接呼叫（這種情況請改用 Python 版）。");
    }
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const e = Array.isArray(j) ? j[0] && j[0].error : j.error;
    const msg = e ? (typeof e === "string" ? e : e.message || JSON.stringify(e)) : "";
    if (r.status === 401 || r.status === 403) throw new AIError("API key 不正確或沒有權限。");
    if (r.status === 404) throw new AIError("找不到這個模型或網址，請確認「API 網址」與「模型名稱」。");
    if (r.status === 429) throw new AIError("呼叫太頻繁或額度用完了，等一下再試。");
    if (r.status === 400) throw new AIError("請求被拒絕：" + msg);
    throw new AIError(`AI 服務回報錯誤（${r.status}）：${msg}`);
  }
  async function chat(cfg, system, turns, maxTokens = 16000) {
    if (!cfg.model) throw new AIError("還沒設定 AI 模型，請到「設定」填寫。");
    if (cfg.provider === "anthropic") {
      const body = { model: cfg.model, max_tokens: maxTokens, messages: turns };
      if (system) body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
      if (cfg.effort) body.output_config = { effort: cfg.effort };
      const headers = anthropicHeaders(cfg);
      if (FALLBACK_MODELS.includes(cfg.model)) { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; body.fallbacks = "default"; }
      const j = await http(base(cfg, "https://api.anthropic.com") + "/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
      if (j.stop_reason === "refusal") throw new AIError("模型拒絕處理這次的內容，可以換個說法或換模型再試。");
      if (j.stop_reason === "max_tokens") throw new AIError("回覆太長被截斷了，再試一次。");
      return [(j.content || []).filter(b => b.type === "text").map(b => b.text).join(""), j.model || cfg.model];
    }
    const messages = (system ? [{ role: "system", content: system }] : []).concat(turns);
    const j = await http(base(cfg, "https://api.openai.com/v1") + "/chat/completions",
      { method: "POST", headers: openaiHeaders(cfg), body: JSON.stringify({ model: cfg.model, messages }) });
    const text = (((j.choices || [])[0] || {}).message || {}).content || "";
    // 部分推理模型會把思考過程放在 <think> 標籤裡
    return [text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), j.model || cfg.model];
  }
  function parseJSON(text) {
    try { return JSON.parse(text); } catch (e) {}
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (e) {} }
    throw new AIError("AI 回傳的格式跑掉了，再試一次。");
  }

  /* ---------- 讀檔與遮蔽個資 ---------- */
  const loadScript = src => new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error("讀檔套件下載失敗，請確認網路連線。"));
    document.head.appendChild(s);
  });
  function decode(bytes) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) {}
    try { return new TextDecoder("big5").decode(bytes); } catch (e) {}
    return new TextDecoder("utf-8").decode(bytes);
  }
  function scrub(text) {
    return text
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "〔已遮蔽 Email〕")
      .replace(/(^|[^\d])(\+886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}(?!\d)/g, "$1〔已遮蔽電話〕")
      .replace(/(^|[^\d.])\(?0\d{1,2}\)?[- ]\d{3,4}[- ]?\d{4}(?!\d)/g, "$1〔已遮蔽電話〕")
      .replace(/(^|[^A-Za-z0-9])[A-Z][12]\d{8}(?!\d)/g, "$1〔已遮蔽身分證字號〕");
  }
  async function extract(filename, bytes) {
    const ext = filename.toLowerCase().split(".").pop();
    let text, warn = "";
    if (ext === "pdf") {
      if (!window.pdfjsLib) { await loadScript(CDN.pdf); window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.worker; }
      const doc = await window.pdfjsLib.getDocument({ data: bytes, cMapUrl: CDN.cmaps, cMapPacked: true }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const c = await (await doc.getPage(i)).getTextContent();
        pages.push(c.items.map(it => it.str + (it.hasEOL ? "\n" : "")).join(""));
      }
      text = pages.map((t, i) => `【第 ${i + 1} 頁】\n${t}`).join("\n");
      if (pages.reduce((a, t) => a + t.trim().length, 0) < 30 * Math.max(1, pages.length))
        warn = "這份 PDF 幾乎讀不到文字，可能是掃描檔。請改傳可以選取文字的 PDF 或 Word 檔。";
    } else if (ext === "docx") {
      if (!window.mammoth) await loadScript(CDN.mammoth);
      text = (await window.mammoth.extractRawText({ arrayBuffer: bytes.buffer })).value;
    } else if (ext === "txt" || ext === "md") {
      text = decode(bytes);
    } else throw new Error("只支援 PDF、Word（.docx）、Markdown（.md）、純文字（.txt）。");
    text = text.replace(/[ \t　]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("這個檔案讀不到任何文字。");
    return [scrub(text), warn];
  }

  /* ---------- 路由 ---------- */
  const publicConfig = cfg => { const c = { ...cfg, has_key: !!cfg.api_key }; delete c.api_key; return c; };
  const R = {};
  R["/api/state"] = async () => ({
    config: publicConfig(await load("config")), profile: await load("profile"),
    docs: (await load("docs")).map(d => { const x = { ...d }; delete x.text; return x; }),
    bank: await load("bank"), progress: await load("progress"), attempts: await load("attempts"), job: { ...JOB },
  });
  R["/api/job"] = async () => ({ ...JOB, warnings: [...JOB.warnings] });
  R["/api/config"] = async body => {
    const cfg = await load("config");
    for (const k of ["provider", "base_url", "model", "effort"]) if (k in body) cfg[k] = String(body[k]).trim();
    if (body.api_key) cfg.api_key = body.api_key.trim();
    if (body.max_chars) cfg.max_chars = Math.max(4000, parseInt(body.max_chars, 10) || 60000);
    await save("config", cfg);
    return { config: publicConfig(cfg) };
  };
  R["/api/test-ai"] = async () => {
    const [text, model] = await chat(await load("config"), "", [{ role: "user", content: T.test }], 2000);
    return { reply: text.slice(0, 200), model };
  };
  R["/api/models"] = async () => {
    const cfg = await load("config");
    try {
      if (cfg.provider === "anthropic") {
        const j = await http(base(cfg, "https://api.anthropic.com") + "/v1/models?limit=100", { headers: anthropicHeaders(cfg) });
        return { models: (j.data || []).map(m => m.id) };
      }
      const j = await http(base(cfg, "https://api.openai.com/v1") + "/models", { headers: openaiHeaders(cfg) });
      return { models: (j.data || []).map(m => m.id).sort() };
    } catch (e) { throw new AIError("讀不到模型清單：" + e.message); }
  };
  R["/api/profile"] = async body => {
    const schools = (body.schools || []).filter(s => String(s.name || "").trim()).map((s, i) => ({
      id: s.id || newId("s") + i, name: s.name.trim(), short: String(s.short || "").trim(), date: s.date || "", style: String(s.style || "").trim(),
    }));
    const profile = { schools, notes: String(body.notes || "").trim() };
    await save("profile", profile);
    return { profile };
  };
  R["/api/docs/upload"] = async body => {
    const bytes = Uint8Array.from(atob(body.data), c => c.charCodeAt(0));
    const [text, warn] = await extract(body.filename, bytes);
    const doc = { id: newId("d"), filename: body.filename, kind: body.kind || "review", schools: body.schools || [],
      text, chars: text.length, warning: warn, added: now() };
    await save("docs", (await load("docs")).concat([doc]));
    const meta = { ...doc }; delete meta.text;
    return { doc: meta };
  };
  R["/api/docs/delete"] = async body => { await save("docs", (await load("docs")).filter(d => d.id !== body.id)); return {}; };
  R["/api/progress"] = async body => { await save("progress", body.progress); return {}; };
  R["/api/attempt"] = async body => {
    await save("attempts", (await load("attempts")).filter(x => x.id !== body.attempt.id).concat([body.attempt]));
    return {};
  };
  R["/api/questions/delete"] = async body => {
    const bank = await load("bank");
    bank.questions = bank.questions.filter(q => q.id !== body.id);
    bank.sections.forEach(s => { s.qs = s.qs.filter(x => x !== body.id); });
    await save("bank", bank);
    return { bank };
  };
  R["/api/export"] = async () => {
    const out = { app: "interview-drill", version: 1, exported_at: now() };
    for (const k of BACKUP_KEYS) out[k] = await load(k);
    return out;
  };
  R["/api/import"] = async body => {
    const data = body.data || {};
    if (data.app !== "interview-drill") throw new Error("這不是面試練習工具的備份檔。");
    for (const k of BACKUP_KEYS) if (k in data) await save(k, data[k]);
    return {};
  };

  /* ---------- 出題 ---------- */
  async function chatJSON(cfg, prompt) {
    for (let attempt = 0; ; attempt++) {
      try {
        const [text, model] = await chat(cfg, T.gen_system, [{ role: "user", content: prompt }]);
        return [parseJSON(text), model];
      } catch (e) {
        if (attempt || !String(e.message).includes("格式")) throw e;
      }
    }
  }
  function normQuestion(x, gid, n, sids, sec) {
    if (!x || typeof x !== "object" || !String(x.q || "").trim()) return null;
    const facts = [];
    for (const f of x.facts || []) {
      if (f && !Array.isArray(f) && f.t) facts.push([String(f.t), String(f.src || "")]);
      else if (Array.isArray(f) && f.length) facts.push([String(f[0]), f.length > 1 ? String(f[1]) : ""]);
    }
    const asList = v => (Array.isArray(v) ? v.map(String).filter(t => t.trim()) : []);
    return { id: `${gid}-q${n}`, s: sids, sec, cat: String(x.cat || "其他").trim().slice(0, 12), q: String(x.q).trim(),
      why: String(x.why || ""), f: facts, u: asList(x.followups), w: asList(x.cautions) };
  }
  async function runGenerate() {
    let lock = null;
    try {
      // 出題要幾分鐘，請手機不要自動關螢幕（不支援的瀏覽器就略過）
      try { lock = await navigator.wakeLock.request("screen"); } catch (e) {}
      const cfg = await load("config"), profile = await load("profile"), docs = await load("docs");
      const schools = profile.schools, reviews = docs.filter(d => d.kind === "review");
      const size = Math.max(1500, Math.min(4000, Math.floor((cfg.max_chars || 60000) / 3)));
      const plan = [];
      for (const d of reviews) {
        const sids = d.schools.length ? d.schools : schools.map(s => s.id);
        for (const [body, label] of splitChunks(d.text, size)) plan.push([d, sids, body, label]);
      }
      JOB.total = plan.length + schools.length;
      const gid = newId("g"), sections = [], questions = [];
      let used = "";
      const add = (items, sids, sec) => (Array.isArray(items) ? items : []).map(x => {
        const q = normQuestion(x, gid, questions.length + 1, sids, sec);
        if (q) questions.push(q);
        return q && q.id;
      }).filter(Boolean);

      for (const [i, [d, sids, body, label]] of plan.entries()) {
        Object.assign(JOB, { done: i, message: `正在讀「${d.filename}」${label}，出這段的題目` });
        const sch = schools.filter(s => sids.includes(s.id));
        let res = {};
        try {
          [res, used] = await chatJSON(cfg, fill("section", { schools: sch.map(schoolDesc).join("\n"), notes: notesBlock(profile),
            filename: d.filename, pages: label, chunk: body }));
        } catch (e) { JOB.warnings.push(`「${d.filename}」${label} 沒出成題目：${e.message}`); }
        const secId = `${gid}-s${i + 1}`;
        sections.push({ id: secId, doc: d.id, file: d.filename, pages: label, title: String(res.title || `${d.filename} ${label}`),
          intro: String(res.intro || ""), raw: body, s: sids, qs: add(res.questions, sids, secId) });
      }

      const limit = (cfg.max_chars || 60000) - 4000;
      for (const [j, s] of schools.entries()) {
        Object.assign(JOB, { done: plan.length + j, message: `正在出「${s.name}」的綜合題` });
        const full = reviews.filter(d => !d.schools.length || d.schools.includes(s.id)).map(d => `【檔案：${d.filename}】\n${d.text}`).join("\n\n");
        const isFull = full.length <= limit;
        const material = isFull ? full : sections.filter(x => x.s.includes(s.id)).map(x => `【${x.title}】${x.intro}`).join("\n");
        try {
          const [res, model] = await chatJSON(cfg, fill("overall", { school: schoolDesc(s), notes: notesBlock(profile), material,
            what: isFull ? T.overall_full : T.overall_summary }));
          used = model;
          add(res.questions, [s.id], null);
        } catch (e) { JOB.warnings.push(`「${s.name}」的綜合題沒出成：${e.message}`); }
      }

      if (!questions.length) throw new AIError("一題都沒有出成功。" + (JOB.warnings[0] || ""));
      await save("bank", { id: gid, generated_at: now(), model: used, sections, questions, warnings: JOB.warnings });
      Object.assign(JOB, { done: JOB.total, message: `完成，共出了 ${questions.length} 題。` });
    } catch (e) {
      JOB.error = e.message || "出題失敗。";
    } finally {
      JOB.running = false;
      if (lock) lock.release().catch(() => {});
    }
  }
  R["/api/generate"] = async () => {
    if (JOB.running) return { job: { ...JOB } };
    const profile = await load("profile"), docs = await load("docs");
    if (!(await load("config")).model) throw new Error("請先完成第 1 步：設定 AI 服務。");
    if (!profile.schools.length) throw new Error("請先完成第 2 步：至少填一個要面試的學校系所。");
    if (!docs.some(d => d.kind === "review")) throw new Error("請先完成第 3 步：至少上傳一份「審查資料」。");
    Object.assign(JOB, { running: true, done: 0, total: 0, message: "準備中…", error: "", warnings: [] });
    runGenerate();
    return { job: { ...JOB } };
  };

  /* ---------- 批改 ---------- */
  R["/api/grade"] = async body => {
    const cfg = await load("config"), profile = await load("profile"), docs = await load("docs"), bank = await load("bank");
    const q = bank && bank.questions.find(x => x.id === body.qid);
    if (!q) throw new Error("找不到這一題，題庫可能已經重新產生過。");
    const school = profile.schools.find(s => s.id === body.school) || profile.schools[0];
    const mine = kind => docs.filter(d => d.kind === kind && (!d.schools.length || d.schools.includes(school.id)));
    let review = mine("review").map(d => `【檔案：${d.filename}】\n${d.text}`).join("\n\n");
    let background = mine("background").map(d => `【檔案：${d.filename}】\n${d.text}`).join("\n\n");
    const budget = cfg.max_chars || 60000;
    let note = "";
    const full = review.length <= budget;
    if (!full) {
      const sec = bank.sections.find(s => s.id === q.sec);
      review = sec ? sec.raw : bank.sections.filter(s => s.s.includes(school.id)).map(s => `【${s.title}】${s.intro}`).join("\n");
      note = "審查資料超過字數上限，這次只送了這題相關的段落。";
    }
    if (background && review.length + background.length > budget) { background = ""; note += "補充背景超過字數上限，這次沒有送。"; }
    const system = fill("grade_system", { name: school.name, notes: notesBlock(profile), review,
      scope: full ? T.grade_scope_full : T.grade_scope_part,
      style: school.style ? fill("grade_style", { style: school.style }) : "",
      background: background ? fill("grade_background", { background }) : "" });
    const rounds = body.rounds || [];
    const [text, model] = await chat(cfg, system, gradeTurns(q, rounds, body.answer));
    const fb = parseJSON(text);
    const asList = v => (Array.isArray(v) ? v.map(String) : []);
    const clean = {
      verdict: ["good", "partial", "wrong", "blank"].includes(fb.verdict) ? fb.verdict : "partial",
      errors: (fb.errors || []).filter(e => e && typeof e === "object" && (e.said || e.fact)),
      missing: asList(fb.missing), wording: asList(fb.wording), good: String(fb.good || ""), advice: asList(fb.advice),
      followup: rounds.length < MAX_FOLLOW ? String(fb.followup || "") : "",
    };
    return { fb: clean, model, school: school.name, note };
  };

  return {
    async call(path, body) {
      if (!T) T = await (await fetch("prompts.json")).json();
      const fn = R[path];
      if (!fn) throw new Error("not found");
      try { return await fn(body || {}); } catch (e) {
        throw e instanceof AIError || e.message ? e : new Error("程式出錯：" + e);
      }
    },
  };
})();
