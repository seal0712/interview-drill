/* 面試練習工具前端：資料都存在本機伺服器的 data 資料夾，這裡只負責畫面與互動 */
let S = { config: {}, profile: { schools: [], notes: "" }, docs: [], bank: null, progress: {}, attempts: [], job: {} };
let QS = [], SECTIONS = [], progress = {}, reviews = {};
const ui = { school: "all", cat: "all", onlyStuck: false, tab: "setup", sec: null, current: null, flipped: false, lastId: null,
  rounds: [], draft: "", grading: false, gradeErr: "", clockText: "0:00", attempt: null };
const MAX_FOLLOW = 2;   // 第一次回答之後最多追問 2 次，而且每次都要考生自己選擇回答

async function api(path, body) {
  let r;
  try {
    r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) { throw new Error("連不上本機伺服器，請確認啟動程式的視窗還開著。"); }
  const j = await r.json().catch(() => ({ error: "伺服器回應格式錯誤。" }));
  if (!r.ok || j.error) throw new Error(j.error || "發生錯誤。");
  return j;
}
async function load() {
  S = await api("/api/state");
  QS = S.bank ? S.bank.questions : [];
  SECTIONS = S.bank ? S.bank.sections : [];
  progress = S.progress || {};
  buildReviews();
}

/* ---------- 存檔 ---------- */
let saveTimer = null, syncNote = "練習紀錄存在這台電腦的 data 資料夾。";
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api("/api/progress", { progress }).catch(() => {
    syncNote = "練習紀錄沒存成功，請確認啟動程式的視窗還開著。"; renderStats();
  }), 300);
}
// 錯題本：每題只看最近一次有批改的紀錄
function buildReviews() {
  reviews = {};
  for (const a of [...S.attempts].sort((x, y) => (y.at > x.at ? 1 : -1))) {
    if (!reviews[a.qid] && (a.rounds || []).length) reviews[a.qid] = a;
  }
}
function mark(id, result) {
  const p = progress[id] || { ok: 0, stuck: 0 };
  const next = { ok: p.ok || 0, stuck: p.stuck || 0, last: result, at: new Date().toISOString() };
  next[result] += 1;
  progress = { ...progress, [id]: next };
  persist();
}

/* ---------- 學校 ---------- */
const schools = () => S.profile.schools || [];
const schoolById = id => schools().find(s => s.id === id);
const sname = id => { const s = schoolById(id); return s ? (s.short || s.name) : "已刪除的學校"; };
// 用哪一校的委員身分批改：有選學校就用該校；題目只屬一校就用那校；多校共用時用面試日期最近的那一校
function schoolFor(q) {
  if (ui.school !== "all" && q.s.includes(ui.school)) return ui.school;
  const cands = q.s.filter(schoolById);
  if (cands.length <= 1) return cands[0] || (schools()[0] || {}).id;
  const today = new Date().toISOString().slice(0, 10);
  const next = cands.map(schoolById).filter(s => s.date && s.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  return (next[0] || schoolById(cands[0])).id;
}

/* ---------- 篩選與抽題 ---------- */
const findSec = id => SECTIONS.find(x => x.id === id);
function pool() {
  const sec = ui.sec ? findSec(ui.sec) : null;
  return QS.filter(q =>
    (!sec || sec.qs.includes(q.id)) &&
    (ui.school === "all" || q.s.includes(ui.school)) &&
    (ui.cat === "all" || q.cat === ui.cat) &&
    (!ui.onlyStuck || (progress[q.id] && progress[q.id].last === "stuck")));
}
function weight(q) {
  const p = progress[q.id];
  if (!p) return 3;
  return p.last === "stuck" ? 6 : 1;
}
function draw() {
  const list = pool().filter(q => q.id !== ui.lastId);
  const src = list.length ? list : pool();
  if (!src.length) return null;
  let r = Math.random() * src.reduce((a, q) => a + weight(q), 0);
  for (const q of src) { r -= weight(q); if (r <= 0) return q; }
  return src[src.length - 1];
}

/* ---------- 計時 ---------- */
let timerId = null, startAt = 0, target = 90;
function fmt(s) { const m = Math.floor(s / 60), r = s % 60; return m + ":" + String(r).padStart(2, "0"); }
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; const el = document.getElementById("clock"); if (el) ui.clockText = el.textContent; } }
function tick() {
  const el = document.getElementById("clock"), bar = document.getElementById("barfill");
  if (!el) { stopTimer(); return; }
  const s = Math.floor((Date.now() - startAt) / 1000);
  el.textContent = ui.clockText = fmt(s); el.classList.toggle("over", s > target);
  bar.style.width = Math.min(100, s / target * 100) + "%";
}

/* ---------- 口語分析：只看轉出來的文字和計時，不評分 ---------- */
const FILLERS = ["然後", "就是", "那個", "其實", "基本上", "嗯", "呃", "欸"];
function oral(text, secs) {
  const chars = (text.match(/\p{Script=Han}/gu) || []).length + (text.match(/[A-Za-z0-9]+/g) || []).length;
  const fillers = {};
  FILLERS.forEach(w => { const n = text.split(w).length - 1; if (n) fillers[w] = n; });
  return { secs: secs || null, target, chars, fillers };
}
function oralHTML(o) {
  if (!o) return "";
  const parts = [];
  if (o.secs) parts.push(`講了 <b>${fmt(o.secs)}</b>` + (o.secs > o.target ? `，<span class="over">超過目標 ${o.secs - o.target} 秒</span>` : ""));
  else parts.push("沒按計時，算不出時間和速度");
  if (o.secs >= 10) parts.push(`每分鐘 <b>${Math.round(o.chars / o.secs * 60)}</b> 字`);
  const f = Object.entries(o.fillers);
  parts.push(f.length ? "口頭禪：" + f.map(([w, n]) => `${w} <b>×${n}</b>`).join("、") : "沒有偵測到口頭禪");
  return `<p class="hint oral">${parts.join(" · ")}</p>`;
}

/* ---------- 畫面元件 ---------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function pills(q) {
  const p = progress[q.id];
  let h = `<span class="pill">${esc(q.cat)}</span>`;
  if (schools().length > 1) h += q.s.map(k => `<span class="pill">${esc(sname(k))}</span>`).join("");
  if (p && p.last) h += p.last === "stuck" ? `<span class="pill st-stuck">上次卡住</span>` : `<span class="pill st-ok">上次講得順</span>`;
  return h;
}
function backHTML(q) {
  let h = `<div><p class="lbl">委員想確認</p><p class="why">${esc(q.why)}</p></div>`;
  if (q.f.length) h += `<div><p class="lbl">事實卡</p><ul class="facts">${q.f.map(([t, s]) => `<li>${esc(t)}${s ? ` <span class="src">〔${esc(s)}〕</span>` : ""}</li>`).join("")}</ul></div>`;
  if (q.u && q.u.length) h += `<div><p class="lbl">可能的追問</p><ul class="fu">${q.u.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  if (q.w && q.w.length) h += `<div class="warnbox"><p class="lbl">口徑提醒</p><ul class="warn">${q.w.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  return h;
}

/* ---------- 委員批改 ---------- */
const VERDICT = { good: ["答得好", "v-good"], partial: ["大致對，但有缺", "v-partial"], wrong: ["有講錯", "v-wrong"], blank: ["沒答到題目", "v-wrong"] };
async function grade(q) {
  const ans = ui.draft.trim();
  if (!ans || ui.grading) return;
  if (timerId) ui.secs = Math.round((Date.now() - startAt) / 1000);
  stopTimer();
  ui.grading = true; ui.gradeErr = ""; renderPractice();
  try {
    const res = await api("/api/grade", { qid: q.id, school: schoolFor(q), answer: ans,
      rounds: ui.rounds.map(r => ({ answer: r.answer, fb: r.fb })) });
    ui.tier = res.model; ui.gradeNote = res.note;
    ui.rounds.push({ answer: ans, fb: res.fb, oral: oral(ans, ui.secs) });
    ui.wantFollow = false; ui.secs = null; ui.draft = "";
    saveRound(q);
  } catch (e) { ui.gradeErr = e.message; }
  ui.grading = false;
  renderPractice();
}
function fbHTML(r, i) {
  const [label, cls] = VERDICT[r.fb.verdict];
  let h = `<div class="fb"><p class="lbl">${i === 0 ? "你的回答" : "你對追問的回答"}</p><p class="said">${esc(r.answer)}</p>${oralHTML(r.oral)}`;
  h += `<p><span class="verdict ${cls}">${label}</span></p>`;
  if (r.fb.errors.length) h += `<div><p class="lbl">講錯的地方</p><ul class="facts">${r.fb.errors.map(e => `<li>你說：${esc(e.said)}<br>資料上：${esc(e.fact)}</li>`).join("")}</ul></div>`;
  if (r.fb.missing.length) h += `<div><p class="lbl">漏掉的重點</p><ul class="facts">${r.fb.missing.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  if (r.fb.wording.length) h += `<div class="warnbox"><p class="lbl">口徑問題</p><ul class="warn">${r.fb.wording.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  if (r.fb.good) h += `<p class="goodline">講得好的地方：${esc(r.fb.good)}</p>`;
  if (r.fb.advice.length) h += `<div><p class="lbl">委員建議</p><ul class="facts">${r.fb.advice.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  return h + `</div>`;
}
// 每批改完一輪就存一次，同一題的各輪寫在同一份紀錄
function saveRound(q) {
  if (!ui.attempt) ui.attempt = { id: "a" + Date.now().toString(36), qid: q.id, q: q.q, at: new Date().toISOString(), model: "", result: "", rounds: [] };
  Object.assign(ui.attempt, { model: ui.tier || "", rounds: ui.rounds });
  pushAttempt();
}
function saveAttempt(result) {
  if (!ui.attempt) return;
  ui.attempt.result = result;
  pushAttempt();
}
function pushAttempt() {
  const a = JSON.parse(JSON.stringify(ui.attempt));
  S.attempts = S.attempts.filter(x => x.id !== a.id).concat([a]);
  buildReviews(); renderReviewBadge();
  api("/api/attempt", { attempt: a }).catch(() => {});
}

/* ---------- 抽題練習 ---------- */
function renderPractice() {
  const v = document.getElementById("view-practice");
  const q = ui.current;
  if (!q) {
    stopTimer();
    v.innerHTML = `<div class="card"><p class="empty">${ui.onlyStuck ? "這個範圍裡沒有標成「卡住」的題目。" : "這個範圍沒有題目，換個篩選試試。"}</p></div>`;
    return;
  }
  const canGrade = !!S.config.model;
  const sch = schoolById(schoolFor(q)) || { name: "" };
  const last = ui.rounds[ui.rounds.length - 1];
  const graded = ui.rounds.length > 0;
  const showBack = ui.flipped || graded;
  const suggest = graded ? (last.fb.verdict === "good" ? "ok" : "stuck") : "";
  // 追問是選擇性的：批改完這題就算結束，按「我要回答這個追問」才出現回答框
  const asking = graded && last.fb.followup && ui.wantFollow;
  const offer = graded && last.fb.followup && !ui.wantFollow && !ui.flipped;
  let h = `<article class="card">
    <div class="meta">${pills(q)}</div>
    <p class="q">${esc(q.q)}</p>
    <div class="timer">
      <span class="clock" id="clock">${ui.clockText}</span>
      <div class="bar"><i id="barfill"></i></div>
      <div class="seg" id="target">${[60, 90, 120].map(t => `<button data-t="${t}" aria-pressed="${t === target}">${t} 秒</button>`).join("")}</div>
    </div>`;
  h += ui.rounds.map(fbHTML).join("");
  const todo = !graded && !ui.flipped ? fixItems(q.id).filter(it => !it.done) : [];
  if (todo.length) h += `<details class="fold warnbox"><summary>上次委員提醒你的地方（${todo.length} 條還沒勾改好，可以先自己講一次再打開）</summary>
      <ul class="facts">${todo.map(it => `<li>【${it.kind}】${esc(it.text)}</li>`).join("")}</ul></details>`;
  if (graded) h += `<p class="hint">${esc(sch.name)}委員批改${ui.tier ? "，模型：" + esc(ui.tier) : ""}。${ui.gradeNote ? esc(ui.gradeNote) : ""}這題批改完了，按下面的「講得順」或「卡住了」就換下一題。</p>`;
  if (offer) h += `<div class="warnbox"><p class="lbl">委員可能接著問（選擇性，不回答也沒關係）</p><p>${esc(last.fb.followup)}</p>
      <div class="row" style="margin-top:8px"><button class="btn" id="followBtn">我要回答這個追問</button></div></div>`;
  if (!ui.flipped && (!graded || asking)) {
    h += `<div class="answer">
        ${asking ? `<p class="lbl">委員追問（第 ${ui.rounds.length}／${MAX_FOLLOW} 次）</p><p class="q follow">${esc(last.fb.followup)}</p>` : ""}
        <label class="lbl" for="ans">${graded ? "回答追問" : "你的回答"}</label>
        <textarea id="ans" rows="5" placeholder="建議用說的：Windows 按 Windows 鍵＋H、Mac 按兩下 Fn、手機按鍵盤上的麥克風。一出現字就會自動開始計時。">${esc(ui.draft)}</textarea>
        <div class="row">
          <button class="btn" id="startBtn">${timerId ? "重新計時" : "開始計時"}</button>
          ${canGrade ? `<button class="btn primary" id="gradeBtn"${ui.grading ? " disabled" : ""}>${ui.grading ? "委員批改中…" : graded ? "交出追問的回答" : "交給委員批改"}</button>` : ""}
          ${graded ? "" : `<button class="btn" id="flipBtn">不批改，直接翻面</button>`}
        </div>
        ${ui.grading ? `<p class="hint">${esc(sch.name)}委員正在對照你的審查資料批改，依模型不同大約要幾秒到兩分鐘。</p>` : `<p class="hint">會由${esc(sch.name)}委員批改：追問只根據你交給該校的審查資料，核對與建議另外參考你上傳的補充背景。</p>`}
        ${ui.gradeErr ? `<p class="hint err">${esc(ui.gradeErr)}</p>` : ""}
        ${canGrade ? "" : `<p class="hint">還沒設定 AI 服務，先自己翻面對答案；到「設定」填好就能批改。</p>`}
      </div>`;
  }
  if (showBack) h += `<div class="row">
      <button class="btn ok${suggest === "ok" ? " sug" : ""}" id="okBtn">講得順</button>
      <button class="btn stuck${suggest === "stuck" ? " sug" : ""}" id="stuckBtn">卡住了</button>
      <button class="btn" id="skipBtn">不標記，換一題</button>
    </div>`;
  if (showBack) h += graded && !ui.flipped
    ? `<details class="back fold"><summary>看完整事實卡</summary>${backHTML(q)}</details>`
    : `<div class="back">${backHTML(q)}</div>`;
  h += `</article>`;
  v.innerHTML = h;

  v.querySelectorAll("#target button").forEach(b => b.onclick = () => {
    target = +b.dataset.t; v.querySelectorAll("#target button").forEach(x => x.setAttribute("aria-pressed", x === b)); if (timerId) tick();
  });
  const ta = document.getElementById("ans");
  // 一出現字就自動開始計時（語音輸入或打字都算），不用先按「開始計時」
  if (ta) ta.oninput = () => {
    ui.draft = ta.value;
    if (!timerId && ui.secs == null) { startAt = Date.now(); tick(); timerId = setInterval(tick, 250); const b = document.getElementById("startBtn"); if (b) b.textContent = "重新計時"; }
  };
  const sb = document.getElementById("startBtn");
  if (sb) sb.onclick = () => { stopTimer(); startAt = Date.now(); tick(); timerId = setInterval(tick, 250); sb.textContent = "重新計時"; };
  const gb = document.getElementById("gradeBtn");
  if (gb) gb.onclick = () => grade(q);
  const fl = document.getElementById("flipBtn");
  if (fl) fl.onclick = () => { stopTimer(); ui.flipped = true; renderPractice(); };
  const fw = document.getElementById("followBtn");
  if (fw) fw.onclick = () => { ui.wantFollow = true; renderPractice(); const t = document.getElementById("ans"); if (t) t.focus(); };
  const next = result => { saveAttempt(result); ui.lastId = q.id; newQuestion(); renderPractice(); renderStats(); };
  const ok = document.getElementById("okBtn"); if (ok) ok.onclick = () => { mark(q.id, "ok"); next("ok"); };
  const st = document.getElementById("stuckBtn"); if (st) st.onclick = () => { mark(q.id, "stuck"); next("stuck"); };
  const sk = document.getElementById("skipBtn"); if (sk) sk.onclick = () => next("skip");
  if (timerId) tick();
}
function newQuestion() {
  stopTimer();
  ui.current = draw(); ui.flipped = false; ui.rounds = []; ui.draft = ""; ui.grading = false; ui.gradeErr = ""; ui.gradeNote = ""; ui.clockText = "0:00";
  ui.attempt = null; ui.wantFollow = false; ui.secs = null;
}

/* ---------- 錯題本 ---------- */
// 把一題最近一次批改的每一條意見攤平；勾「改好了」記在 progress 的 fix:<紀錄id>:<位置>
function fixItems(qid) {
  const a = reviews[qid];
  if (!a) return [];
  const out = [];
  a.rounds.forEach((r, ri) => {
    const fb = r.fb || {};
    const add = (kind, k, list, f) => (list || []).forEach((x, i) => {
      const key = `fix:${a.id}:${ri}${k}${i}`;
      out.push({ kind, key, text: f(x), done: !!(progress[key] && progress[key].done) });
    });
    add("講錯", "e", fb.errors, e => `你說：${e.said || ""}／資料上：${e.fact || ""}`);
    add("口徑", "w", fb.wording, t => t);
    add("漏講", "m", fb.missing, t => t);
    add("建議", "a", fb.advice, t => t);
  });
  return out;
}
function setFix(key, on) {
  progress = { ...progress, [key]: { done: on, at: new Date().toISOString() } };
  persist();
}
function renderReviewBadge() {
  const n = Object.keys(reviews).filter(id => QS.some(q => q.id === id)).reduce((s, id) => s + fixItems(id).filter(it => !it.done).length, 0);
  document.getElementById("tab-review").textContent = n ? `錯題本（${n}）` : "錯題本";
}
const KIND_LABEL = { 講錯: "講錯的地方", 口徑: "口徑問題", 漏講: "漏掉的重點", 建議: "委員建議" };
function renderReview() {
  renderReviewBadge();
  const v = document.getElementById("view-review");
  const rows = Object.keys(reviews).map(id => ({ q: QS.find(x => x.id === id), a: reviews[id], items: fixItems(id) }))
    .filter(r => r.q && (ui.school === "all" || r.q.s.includes(ui.school)))
    .map(r => ({ ...r, left: r.items.filter(it => !it.done).length }))
    .sort((x, y) => (y.left > 0) - (x.left > 0) || (y.a.at > x.a.at ? 1 : -1));
  if (!rows.length) { v.innerHTML = `<p class="empty">還沒有批改過的題目。到「抽題練習」把回答交給委員批改，意見就會整理到這裡。</p>`; return; }
  const left = rows.reduce((s, r) => s + r.left, 0), all = rows.reduce((s, r) => s + r.items.length, 0);
  const open = new Set([...v.querySelectorAll("details[open]")].map(d => d.dataset.id));
  let h = `<div class="list"><p class="hint">每題只列<b>最近一次</b>批改的意見，共 ${rows.length} 題，還有 <b>${left}</b>／${all} 條沒改好。自己想通、能用一句話講清楚，就勾起來。重練同一題之後，這裡會換成新的批改。</p>`;
  for (const { q, a, items, left: n } of rows) {
    const [label, cls] = VERDICT[a.rounds[0].fb && a.rounds[0].fb.verdict] || ["", ""];
    const kinds = Object.keys(KIND_LABEL).filter(k => items.some(it => it.kind === k));
    h += `<details class="item" data-id="rv-${q.id}"${open.has("rv-" + q.id) ? " open" : ""}><summary><span class="t">${esc(q.q)}</span><span class="pill${n ? " hot" : " st-ok"}">${n ? `還有 ${n} 條` : "全部改好"}</span></summary>
      <div class="meta" style="margin:10px 0">${pills(q)}${label ? `<span class="verdict ${cls}" style="font-size:12px;padding:1px 8px">第一次回答：${label}</span>` : ""}<span class="src">${esc((a.at || "").slice(0, 10))} 批改</span></div>
      <div class="list">${kinds.map(k => `<div><p class="lbl">${KIND_LABEL[k]}</p><ul class="fix">${items.filter(it => it.kind === k).map(it =>
        `<li class="${it.done ? "done" : ""}"><label><input type="checkbox" data-fix="${it.key}"${it.done ? " checked" : ""}><span>${esc(it.text)}</span></label></li>`).join("")}</ul></div>`).join("")}
      <details class="fold" data-id="rva-${q.id}"${open.has("rva-" + q.id) ? " open" : ""}><summary>看你那次怎麼回答</summary>${a.rounds.map((r, i) => `<p style="white-space:pre-wrap;color:var(--muted);margin:0 0 8px">${i ? "（回答追問）" : ""}${esc(r.answer)}</p>`).join("")}</details>
      <div class="row"><button class="btn primary" data-redo="${q.id}">重練這題</button></div></div>
    </details>`;
  }
  v.innerHTML = h + `</div>`;
  v.querySelectorAll("[data-fix]").forEach(c => c.onchange = () => { setFix(c.dataset.fix, c.checked); renderReview(); });
  v.querySelectorAll("[data-redo]").forEach(b => b.onclick = () => {
    newQuestion(); ui.current = QS.find(x => x.id === b.dataset.redo); showTab("practice"); window.scrollTo(0, 0);
  });
}

/* ---------- 讀資料 ---------- */
function setRead(sid, on) {
  progress = { ...progress, ["read:" + sid]: { read: on, at: new Date().toISOString() } };
  persist();
}
function renderRead() {
  const secs = SECTIONS.filter(s => ui.school === "all" || s.s.includes(ui.school));
  const done = secs.filter(s => progress["read:" + s.id] && progress["read:" + s.id].read).length;
  const open = new Set([...document.querySelectorAll("#view-read details[open]")].map(d => d.dataset.id));
  let h = `<div class="list">
    <p class="hint">照你交出去的資料順序，一段一段讀。每段讀完先看下面的題目，再按「練這段的題目」只抽這段來講。已讀 <b>${done}</b>／${secs.length} 段。</p>`;
  let file = "";
  for (const s of secs) {
    if (s.file !== file) { file = s.file; h += `<p class="lbl" style="margin-top:8px">${esc(file)}</p>`; }
    const read = progress["read:" + s.id] && progress["read:" + s.id].read;
    const qs = s.qs.map(id => QS.find(q => q.id === id)).filter(Boolean);
    h += `<section class="sec${read ? " done" : ""}">
      <div class="sec-head"><h2>${esc(s.title)}</h2>${s.pages ? `<span class="src">${esc(s.pages)}</span>` : ""}${read ? `<span class="pill st-ok">已讀</span>` : ""}</div>
      ${s.intro ? `<p class="why">${esc(s.intro)}</p>` : ""}
      <details class="fold" data-id="raw-${s.id}"${open.has("raw-" + s.id) ? " open" : ""}><summary>讀原文</summary><div class="raw">${esc(s.raw)}</div></details>
      ${qs.length ? `<details class="fold" data-id="qs-${s.id}"${open.has("qs-" + s.id) ? " open" : ""}><summary>這段會被問的 ${qs.length} 題（含重點）</summary>
        <div class="list">${qs.map(q => `<details class="item" data-id="q-${s.id}-${q.id}"${open.has("q-" + s.id + "-" + q.id) ? " open" : ""}><summary><span class="t">${esc(q.q)}</span></summary><div class="meta" style="margin-bottom:10px">${pills(q)}</div><div class="back" style="border:0;padding:0">${backHTML(q)}</div></details>`).join("")}</div>
      </details>` : ""}
      <div class="row">
        <button class="btn" data-read="${s.id}">${read ? "改回未讀" : "這段讀完了"}</button>
        ${qs.length ? `<button class="btn primary" data-drill="${s.id}">練這段的題目</button>` : ""}
      </div>
    </section>`;
  }
  const v = document.getElementById("view-read");
  v.innerHTML = h + `</div>`;
  v.querySelectorAll("[data-read]").forEach(b => b.onclick = () => {
    const sid = b.dataset.read;
    setRead(sid, !(progress["read:" + sid] && progress["read:" + sid].read)); renderRead();
  });
  v.querySelectorAll("[data-drill]").forEach(b => b.onclick = () => {
    ui.sec = b.dataset.drill; ui.cat = "all"; ui.onlyStuck = false;
    document.getElementById("cat").value = "all"; document.getElementById("onlyStuck").checked = false;
    showTab("practice"); refresh(true); window.scrollTo(0, 0);
  });
}

/* ---------- 題庫 ---------- */
function renderBank() {
  const v = document.getElementById("view-bank");
  const order = [...new Set(QS.map(q => q.cat))];
  const list = pool().sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  if (!list.length) { v.innerHTML = `<p class="empty">這個範圍沒有題目。</p>`; return; }
  const open = new Set([...v.querySelectorAll("details[open]")].map(d => d.dataset.id));
  let h = "", cur = "";
  for (const q of list) {
    if (q.cat !== cur) { cur = q.cat; h += `<h2>${esc(cur)}</h2>`; }
    h += `<details class="item" data-id="${q.id}"${open.has(q.id) ? " open" : ""}><summary><span class="t">${esc(q.q)}</span></summary><div class="meta" style="margin-bottom:10px">${pills(q)}</div><div class="back" style="border:0;padding:0">${backHTML(q)}</div>
      <div class="row" style="margin-top:10px"><button class="btn mini" data-del="${q.id}">刪除這題</button></div></details>`;
  }
  v.innerHTML = `<div class="list"><p class="hint">AI 出的題目可能有不準的地方，覺得不像委員會問、或事實卡有錯的題目可以刪掉。</p>${h}</div>`;
  // 刪除要按兩下：第一下變成「確定刪除？」
  v.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "確定刪除？再按一次"; return; }
    const res = await api("/api/questions/delete", { id: b.dataset.del });
    S.bank = res.bank; QS = res.bank.questions; SECTIONS = res.bank.sections;
    if (ui.current && ui.current.id === b.dataset.del) newQuestion();
    initFilters(); renderBank(); renderStats();
  });
}

/* ---------- 設定 ---------- */
const PRESETS = [
  ["OpenAI", "openai", "https://api.openai.com/v1"],
  ["Google Gemini", "openai", "https://generativelanguage.googleapis.com/v1beta/openai/"],
  ["DeepSeek", "openai", "https://api.deepseek.com"],
  ["OpenRouter", "openai", "https://openrouter.ai/api/v1"],
  ["LM Studio（本機，免費）", "openai", "http://localhost:1234/v1", true],
  ["Ollama（本機，免費）", "openai", "http://localhost:11434/v1", true],
  ["Anthropic（Claude）", "anthropic", ""],
];
let cfgDraft = null, profDraft = null, setupMsg = {};
function collectSetup() {
  const val = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  if (!cfgDraft || !document.getElementById("c-model")) return;
  ["provider", "base_url", "model", "effort", "max_chars", "api_key"].forEach(k => { const x = val("c-" + k); if (x !== undefined) cfgDraft[k] = x; });
  profDraft.notes = val("p-notes");
  document.querySelectorAll(".school[data-i]").forEach(row => {
    const s = profDraft.schools[+row.dataset.i];
    row.querySelectorAll("[data-k]").forEach(el => { s[el.dataset.k] = el.value; });
  });
}
function renderSetup() {
  if (!cfgDraft) { cfgDraft = { ...S.config, api_key: "" }; profDraft = JSON.parse(JSON.stringify(S.profile)); }
  const c = cfgDraft, docs = S.docs, j = S.job || {};
  const ok = [!!S.config.model, schools().length > 0, docs.some(d => d.kind === "review"), QS.length > 0];
  const msg = k => setupMsg[k] ? `<p class="hint${setupMsg[k].err ? " err" : ""}">${esc(setupMsg[k].text)}</p>` : "";
  const step = (i, title, body) => `<section class="step${ok[i - 1] ? " ok" : ""}"><h2>${i}. ${title}${ok[i - 1] ? `<span class="pill st-ok">完成</span>` : ""}</h2>${body}</section>`;
  let h = `<div class="list">`;
  h += step(1, "AI 服務", `
    <p class="hint">出題和批改都要呼叫 AI。選一家服務，填 API key 與模型名稱。key 只存在這台電腦的 data 資料夾。用本機的 LM Studio 或 Ollama 不用 key、也不用錢，但出題與批改品質會比雲端大模型弱。</p>
    <div class="chips">${PRESETS.map((p, i) => `<button class="btn mini" data-preset="${i}">${esc(p[0])}</button>`).join("")}</div>
    <div class="grid2">
      <label class="field"><span>介面類型</span><select id="c-provider">
        <option value="openai"${c.provider !== "anthropic" ? " selected" : ""}>OpenAI 相容</option>
        <option value="anthropic"${c.provider === "anthropic" ? " selected" : ""}>Anthropic</option></select></label>
      <label class="field"><span>API 網址（Anthropic 留空）</span><input id="c-base_url" value="${esc(c.base_url)}" placeholder="例如 https://api.openai.com/v1"></label>
      <label class="field"><span>API key</span><input id="c-api_key" type="password" value="${esc(c.api_key)}" placeholder="${S.config.has_key ? "已儲存（留空表示不變）" : "本機模型可以留空"}" autocomplete="off"></label>
      <label class="field"><span>模型名稱</span><input id="c-model" value="${esc(c.model)}" list="modelList" placeholder="按「讀取模型清單」或自己填"><datalist id="modelList">${(setupMsg.models || []).map(m => `<option value="${esc(m)}">`).join("")}</datalist></label>
      <label class="field"><span>思考深度（只有 Claude 用得到）</span><select id="c-effort">${["", "low", "medium", "high", "xhigh", "max"].map(e => `<option value="${e}"${c.effort === e ? " selected" : ""}>${e || "不指定"}</option>`).join("")}</select></label>
      <label class="field"><span>一次最多送給 AI 的字數</span><input id="c-max_chars" type="number" min="4000" step="1000" value="${esc(c.max_chars)}"></label>
    </div>
    <p class="hint">字數上限：雲端大模型用 60000 即可；本機模型建議 8000，並把 LM Studio 的 context length 調到 16384 以上。資料超過上限時，批改只會送這題相關的段落。</p>
    <div class="row"><button class="btn primary" id="saveCfg">儲存</button><button class="btn" id="listModels">讀取模型清單</button><button class="btn" id="testAI">測試連線</button></div>
    ${msg("cfg")}`);
  h += step(2, "面試資訊", `
    <p class="hint">每個要面試的學校系所填一筆。「口試形式與重點」可以貼簡章上的口試說明，例如「對審查資料提問」「企業代表一起面試」，委員會照這個角色問你。</p>
    ${profDraft.schools.map((s, i) => `<div class="school" data-i="${i}"><div class="grid2">
      <label class="field"><span>學校系所全名</span><input data-k="name" value="${esc(s.name)}" placeholder="例如 某某大學資訊工程學系碩士班"></label>
      <label class="field"><span>簡稱（顯示用）</span><input data-k="short" value="${esc(s.short)}" placeholder="例如 某大資工"></label>
      <label class="field"><span>面試日期</span><input data-k="date" type="date" value="${esc(s.date)}"></label></div>
      <label class="field"><span>口試形式與重點（選填）</span><textarea data-k="style" rows="2">${esc(s.style)}</textarea></label>
      <div class="row"><button class="btn mini" data-rmschool="${i}">刪除這筆</button></div></div>`).join("")}
    <div class="row"><button class="btn" id="addSchool">＋ 新增一個學校系所</button></div>
    <label class="field"><span>口徑提醒（選填，一行一條）</span><textarea id="p-notes" rows="3" placeholder="例如：競賽只講「佳作」，不講名次&#10;團隊專案要講清楚自己負責的部分">${esc(profDraft.notes)}</textarea></label>
    <p class="hint">口徑提醒是你自己知道、但資料上看不出來的規則。出題和批改都會照這些提醒檢查你的說法。</p>
    <div class="row"><button class="btn primary" id="saveProfile">儲存</button></div>${msg("profile")}`);
  h += step(3, "上傳資料", `
    <p class="hint">支援 PDF（要能選取文字，掃描檔讀不到）、Word（.docx）、Markdown、純文字。上傳時會自動遮掉 Email、手機與市話號碼、身分證字號。</p>
    <p class="hint"><b>審查資料</b>：你實際交給學校的東西（自傳、讀書計畫、作品集、成績單摘要），委員看得到，題目從這裡出。<br><b>補充背景</b>：委員看不到、但你想讓 AI 核對事實用的資料（例如專案完整紀錄），不會拿來出題。</p>
    ${schools().length ? `<div class="grid2">
      <label class="field"><span>這次上傳的是</span><select id="u-kind"><option value="review">審查資料（委員看得到）</option><option value="background">補充背景（只供核對）</option></select></label>
      ${schools().length > 1 ? `<div class="field"><span>交給哪些學校（都不勾＝全部）</span><div class="chips">${schools().map(s => `<label class="chk"><input type="checkbox" data-usch="${s.id}"> ${esc(s.short || s.name)}</label>`).join("")}</div></div>` : ""}
    </div>
    <label class="field"><span>選擇檔案（可以一次選多個）</span><input id="u-file" type="file" multiple accept=".pdf,.docx,.md,.txt"></label>` : `<p class="hint err">請先完成第 2 步，填好要面試的學校。</p>`}
    ${msg("upload")}
    ${docs.map(d => `<div class="doc"><span class="t">${esc(d.filename)}</span><span class="pill${d.kind === "background" ? " hot" : ""}">${d.kind === "review" ? "審查資料" : "補充背景"}</span>
      <span class="src">${d.schools.length ? d.schools.map(sname).map(esc).join("、") : "全部學校"} · ${d.chars.toLocaleString()} 字</span>
      <button class="btn mini" data-deldoc="${d.id}">刪除</button>${d.warning ? `<p class="hint err" style="flex-basis:100%">${esc(d.warning)}</p>` : ""}</div>`).join("")}`);
  h += step(4, "產生題庫", `
    <p class="hint">AI 會把審查資料切成一段一段，每段出 2～4 題，再替每個學校出綜合題（自我介紹、動機、弱點等）。用雲端模型通常幾分鐘內完成；本機模型可能要十幾分鐘。${S.bank ? `<br>目前題庫：${QS.length} 題（${esc((S.bank.generated_at || "").replace("T", " "))} 產生，模型 ${esc(S.bank.model)}）。資料有更新再重新產生；舊題目的練習紀錄不會沿用。` : ""}</p>
    <div class="row"><button class="btn primary" id="genBtn"${j.running ? " disabled" : ""}>${j.running ? "出題中…" : S.bank ? "重新產生題庫" : "產生題庫"}</button></div>
    <div id="jobBox"></div>${msg("gen")}`);
  document.getElementById("view-setup").innerHTML = h + `</div>`;
  renderJob();
  bindSetup();
}
function renderJob() {
  const box = document.getElementById("jobBox");
  if (!box) return;
  const j = S.job || {}, w = (S.bank && !j.running && !j.warnings?.length) ? S.bank.warnings || [] : j.warnings || [];
  let h = "";
  if (j.running) h += `<div class="progress"><i style="width:${j.total ? Math.round(j.done / j.total * 100) : 3}%"></i></div><p class="hint">${esc(j.message)}（${j.done}／${j.total || "?"}）</p>`;
  else if (j.error) h += `<p class="hint err">出題失敗：${esc(j.error)}</p>`;
  else if (j.message) h += `<p class="hint">${esc(j.message)}</p>`;
  if (w.length) h += `<div class="warnbox"><p class="lbl">有幾段沒出成功</p><ul class="warn">${w.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  box.innerHTML = h;
}
function setMsg(k, text, err) { setupMsg[k] = { text, err }; }
async function act(k, fn) {
  try { await fn(); } catch (e) { setMsg(k, e.message, true); }
  collectSetup(); renderSetup();
}
function bindSetup() {
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
  document.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => {
    collectSetup();
    const [name, provider, url, local] = PRESETS[+b.dataset.preset];
    Object.assign(cfgDraft, { provider, base_url: url, max_chars: local ? 8000 : 60000 });
    if (provider === "anthropic") Object.assign(cfgDraft, { model: cfgDraft.model.startsWith("claude") ? cfgDraft.model : "claude-opus-5-5", effort: cfgDraft.effort || "high" });
    else cfgDraft.effort = "";
    setMsg("cfg", `已填入 ${name} 的設定，${local ? "確認本機伺服器已啟動，" : "填好 API key，"}再按「讀取模型清單」選模型，最後按「儲存」。`);
    renderSetup();
  });
  on("saveCfg", () => act("cfg", async () => {
    collectSetup();
    const res = await api("/api/config", cfgDraft);
    S.config = res.config; cfgDraft.api_key = "";
    setMsg("cfg", "已儲存。可以按「測試連線」確認能不能用。");
  }));
  on("listModels", () => act("cfg", async () => {
    collectSetup();
    S.config = (await api("/api/config", cfgDraft)).config; cfgDraft.api_key = "";
    setupMsg.models = (await api("/api/models", {})).models;
    setMsg("cfg", `讀到 ${setupMsg.models.length} 個模型，點「模型名稱」欄位就能選。`);
  }));
  on("testAI", () => act("cfg", async () => {
    collectSetup();
    S.config = (await api("/api/config", cfgDraft)).config; cfgDraft.api_key = "";
    setMsg("cfg", "測試中…"); renderSetup();
    const res = await api("/api/test-ai", {});
    setMsg("cfg", `連線成功（模型 ${res.model}）。AI 回覆：${res.reply}`);
  }));
  on("addSchool", () => { collectSetup(); profDraft.schools.push({ name: "", short: "", date: "", style: "" }); renderSetup(); });
  document.querySelectorAll("[data-rmschool]").forEach(b => b.onclick = () => { collectSetup(); profDraft.schools.splice(+b.dataset.rmschool, 1); renderSetup(); });
  on("saveProfile", () => act("profile", async () => {
    collectSetup();
    S.profile = (await api("/api/profile", profDraft)).profile;
    profDraft = JSON.parse(JSON.stringify(S.profile));
    setMsg("profile", "已儲存。"); initFilters(); renderDates();
  }));
  const file = document.getElementById("u-file");
  if (file) file.onchange = () => act("upload", async () => {
    const kind = document.getElementById("u-kind").value;
    const sch = [...document.querySelectorAll("[data-usch]:checked")].map(x => x.dataset.usch);
    const files = [...file.files];
    for (const [i, f] of files.entries()) {
      setMsg("upload", `正在讀第 ${i + 1}／${files.length} 個檔案：${f.name}`); collectSetup(); renderSetup();
      const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = bad; r.readAsDataURL(f); });
      const res = await api("/api/docs/upload", { filename: f.name, kind, schools: sch, data });
      S.docs.push(res.doc);
    }
    setMsg("upload", `已上傳 ${files.length} 個檔案。`);
  });
  // 刪除與重新出題要按兩下：第一下只改按鈕文字
  const sure = (b, text) => { if (b.dataset.sure) return true; b.dataset.sure = 1; b.textContent = text; return false; };
  document.querySelectorAll("[data-deldoc]").forEach(b => b.onclick = () => {
    if (!sure(b, "確定刪除？再按一次")) return;
    act("upload", async () => {
      await api("/api/docs/delete", { id: b.dataset.deldoc });
      S.docs = S.docs.filter(d => d.id !== b.dataset.deldoc);
      setMsg("upload", "已刪除。");
    });
  });
  on("genBtn", e => {
    if (S.bank && !sure(e.currentTarget, "會取代目前的題庫，確定嗎？再按一次")) return;
    act("gen", async () => {
      delete setupMsg.gen;
      S.job = (await api("/api/generate", {})).job;
      pollJob();
    });
  });
}
async function pollJob() {
  try { S.job = await api("/api/job"); } catch (e) { setTimeout(pollJob, 3000); return; }
  if (S.job.running) { renderJob(); setTimeout(pollJob, 1500); return; }
  await load();
  initFilters(); newQuestion(); renderDates(); renderStats(); gateTabs();
  collectSetup(); renderSetup();
}

/* ---------- 共用 ---------- */
function renderStats() {
  const list = pool();
  const done = list.filter(q => progress[q.id]).length;
  const stuck = list.filter(q => progress[q.id] && progress[q.id].last === "stuck").length;
  const sec = ui.sec ? findSec(ui.sec) : null;
  document.getElementById("stats").innerHTML =
    (sec ? `<span class="pill">只練：${esc(sec.title)}</span><button class="btn mini" id="clearSec">改回全部題目</button>` : "") +
    `<span>這個範圍 <b>${list.length}</b> 題</span><span>練過 <b>${done}</b></span><span>目前卡住 <b>${stuck}</b></span><span>${esc(syncNote)}</span>`;
  const cs = document.getElementById("clearSec");
  if (cs) cs.onclick = () => { ui.sec = null; refresh(true); };
}
function renderDates() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  document.getElementById("dates").innerHTML = schools().filter(s => s.date).map(s => {
    const n = Math.round((new Date(s.date + "T00:00:00") - today) / 86400000);
    return `<div class="date"><b>${n > 0 ? n : n === 0 ? "今天" : "已過"}</b><span>${n > 0 ? "天後 · " : ""}${esc(s.short || s.name)}</span></div>`;
  }).join("");
  document.getElementById("topHint").textContent = QS.length
    ? "建議順序：先在「讀資料」照你交出的資料一段一段讀，讀完一段就按「練這段的題目」；全部讀過，再到「抽題練習」隨機抽題，交給委員批改。"
    : "第一次使用：請在「設定」依序完成四個步驟，AI 會依你的資料出題。";
}
function initFilters() {
  const segEl = document.getElementById("school");
  if (ui.school !== "all" && !schoolById(ui.school)) ui.school = "all";
  segEl.hidden = schools().length < 2;
  segEl.innerHTML = [["all", "全部"], ...schools().map(s => [s.id, s.short || s.name])]
    .map(([v, t]) => `<button data-v="${v}" aria-pressed="${v === ui.school}">${esc(t)}</button>`).join("");
  segEl.querySelectorAll("button").forEach(b => b.onclick = () => {
    ui.school = b.dataset.v; segEl.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    const sec = ui.sec && findSec(ui.sec);
    if (sec && ui.school !== "all" && !sec.s.includes(ui.school)) ui.sec = null;
    refresh(true);
  });
  const cats = [...new Set(QS.map(q => q.cat))];
  if (!cats.includes(ui.cat)) ui.cat = "all";
  const catSel = document.getElementById("cat");
  catSel.innerHTML = `<option value="all">全部類別</option>` + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  catSel.value = ui.cat;
  if (ui.sec && !findSec(ui.sec)) ui.sec = null;
}
function refresh(redraw) {
  if (redraw) newQuestion();
  renderStats();
  if (ui.tab === "practice") renderPractice();
  if (ui.tab === "bank") renderBank();
  if (ui.tab === "read") renderRead();
  if (ui.tab === "review") renderReview();
}
const TABS = ["read", "practice", "review", "bank", "setup"];
// 還沒有題庫時，只開放「設定」
function gateTabs() {
  TABS.forEach(t => { if (t !== "setup") document.getElementById("tab-" + t).disabled = !QS.length; });
  renderReviewBadge();
}
function showTab(t) {
  ui.tab = t;
  TABS.forEach(x => {
    document.getElementById("tab-" + x).setAttribute("aria-selected", x === t);
    document.getElementById("view-" + x).hidden = x !== t;
  });
  document.getElementById("filters").hidden = t === "setup";
  document.getElementById("stats").hidden = t === "setup" || t === "read" || t === "review";
  document.getElementById("cat").hidden = t === "read" || t === "review";
  document.querySelector(".chk").hidden = t === "read" || t === "review";
  if (t === "practice") renderPractice();
  if (t === "bank") renderBank();
  if (t === "read") renderRead();
  if (t === "review") renderReview();
  if (t === "setup") renderSetup();
}
TABS.forEach(t => document.getElementById("tab-" + t).onclick = () => showTab(t));
document.getElementById("cat").onchange = e => { ui.cat = e.target.value; refresh(true); };
document.getElementById("onlyStuck").onchange = e => { ui.onlyStuck = e.target.checked; refresh(true); };

load().then(() => {
  initFilters(); newQuestion(); renderDates(); gateTabs(); renderStats();
  showTab(QS.length ? "read" : "setup");
  if (S.job && S.job.running) pollJob();
}).catch(e => {
  document.querySelector(".wrap").innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
});
