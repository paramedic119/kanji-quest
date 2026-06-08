// 漢字クエスト ｜ ゲーム本体（画面遷移・出題・バトル・進捗）
// データは kanji-data.js（window.KANJI / CHAPTERS / FINAL_BOSS / TEST_DATE / ALL_YOMI）
(function () {
  "use strict";

  var SAVE_KEY = "kanji-quest-save-v1";

  // 端末内セーブの初期値
  var defaultState = {
    level: 1,
    exp: 0,
    clearedChapters: [], // クリアした章id
    learned: {},         // おぼえた字 { "信": true }
    weak: {},            // にがて字 { "信": 重み }
    attempts: 0,
    corrects: 0,
    streak: 0,
    lastPlayDate: null,
    finalCleared: false
  };

  // ===== DOM参照（script は body末尾なので取得できる） =====
  var screens = Array.prototype.slice.call(document.querySelectorAll(".screen"));
  var panelRead = document.getElementById("panel-read");
  var panelWrite = document.getElementById("panel-write");
  var readWord = document.getElementById("read-word");
  var readChoices = document.getElementById("read-choices");
  var writeHint = document.getElementById("write-hint");
  var modelAnswer = document.getElementById("model-answer");
  var canvasWrap = document.querySelector(".canvas-wrap");
  var canvas = document.getElementById("write-canvas");

  // 章ごとのドット絵モブ（img/mob_<name>.png）。final=ボス、weak=むらさきスライム
  var MOBS = ["creeper", "zombie", "skeleton", "spider", "slime", "enderman", "pig", "sheep", "ghast", "bee"];
  function mobSrc(name) { return "img/mob_" + name + ".png"; }

  var state = load();
  var ctx = null;
  var drawing = false;
  var lastX = 0, lastY = 0;
  var toastTimer = null;

  // ===== セーブ／ロード =====
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return Object.assign({}, defaultState);
      return Object.assign({}, defaultState, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, defaultState);
    }
  }
  function save() {
    // 一時的な戦闘データは保存しない
    var persist = {
      level: state.level, exp: state.exp,
      clearedChapters: state.clearedChapters, learned: state.learned, weak: state.weak,
      attempts: state.attempts, corrects: state.corrects,
      streak: state.streak, lastPlayDate: state.lastPlayDate, finalCleared: state.finalCleared
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(persist)); } catch (e) {}
  }

  // ===== 小道具 =====
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function fmtDate(d) {
    var m = String(d.getMonth() + 1);
    var da = String(d.getDate());
    if (m.length < 2) m = "0" + m;
    if (da.length < 2) da = "0" + da;
    return d.getFullYear() + "-" + m + "-" + da;
  }
  function todayStr() { return fmtDate(new Date()); }
  function daysUntilTest() {
    var test = new Date(TEST_DATE + "T00:00:00");
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((test - now) / 86400000));
  }
  function needExp(lv) { return lv * 100; }
  function maxHp() { return 6 + (state.level - 1); }
  function learnedCount() { return Object.keys(state.learned).length; }
  function accuracy() {
    if (!state.attempts) return "--";
    return Math.round(state.corrects / state.attempts * 100);
  }
  function heroTitle() {
    var t = ["みならい けんし", "かけだし ぼうけんしゃ", "いっぱし せんし", "ベテラン マスター", "でんせつの ゆうしゃ"];
    var i = Math.floor((state.level - 1) / 3);
    if (i > t.length - 1) i = t.length - 1;
    return t[i];
  }
  function setBar(id, pct) {
    var el = document.getElementById(id);
    if (el) el.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }
  // たいりょくをドット絵ハートで表示（cur個=満タン、残り=空）
  function renderHearts(id, cur, max, cap) {
    var box = document.getElementById(id);
    if (!box) return;
    var html = cap ? '<span class="hp-cap">' + cap + "</span>" : "";
    for (var i = 0; i < max; i++) {
      html += '<img src="img/heart_' + (i < cur ? "full" : "empty") + '.png" alt="" />';
    }
    box.innerHTML = html;
  }

  // ===== 画面切替 =====
  function go(name) {
    screens.forEach(function (s) { s.classList.remove("active"); });
    var el = document.getElementById("screen-" + name);
    if (el) el.classList.add("active");
  }

  // ===== ホーム =====
  function renderHome() {
    document.getElementById("hero-level").textContent = state.level;
    document.getElementById("hero-title-text").textContent = heroTitle();
    var need = needExp(state.level);
    setBar("exp-fill", state.exp / need * 100);
    document.getElementById("exp-label").textContent = "EXP " + state.exp + " / " + need;
    renderHearts("home-hearts", maxHp(), maxHp(), "たいりょく");
    document.getElementById("stat-streak").textContent = state.streak;
    document.getElementById("stat-learned").textContent = learnedCount();
    document.getElementById("stat-acc").textContent = accuracy();

    var days = daysUntilTest();
    document.getElementById("days-left").textContent = days;
    var cd = document.getElementById("countdown");
    if (days <= 7) cd.classList.add("urgent"); else cd.classList.remove("urgent");

    var wn = document.getElementById("weak-note");
    var wc = Object.keys(state.weak).length;
    var rest = 53 - learnedCount();
    if (wc) wn.textContent = "にがてな字が " + wc + "字。弱点とっくんで やっつけよう！（100点まで あと " + rest + "字）";
    else wn.textContent = rest > 0 ? "100点まで あと " + rest + "字！" : "ぜんぶ おぼえた！すごい！";
  }

  // ===== ステージマップ =====
  function chapterUnlocked(i) {
    if (i === 0) return true;
    var prev = CHAPTERS[i - 1];
    return state.clearedChapters.indexOf(prev.id) >= 0 || state.clearedChapters.indexOf(CHAPTERS[i].id) >= 0;
  }
  function renderMap() {
    var list = document.getElementById("chapter-list");
    list.innerHTML = "";
    CHAPTERS.forEach(function (ch, i) {
      var card = document.createElement("div");
      card.className = "chapter-card";
      var cleared = state.clearedChapters.indexOf(ch.id) >= 0;
      var unlocked = chapterUnlocked(i);
      if (cleared) card.classList.add("cleared");
      if (!unlocked) card.classList.add("locked");
      card.innerHTML =
        '<img class="ch-emoji" src="' + mobSrc(MOBS[ch.id - 1] || "creeper") + '" alt="" />' +
        '<div class="ch-title">' + ch.id + '. ' + ch.title + '</div>' +
        '<div class="ch-pages">P.' + ch.pages + ' ・ ' + ch.chars.length + '字</div>' +
        '<div class="ch-chars">' + ch.chars.join("") + '</div>' +
        '<div class="ch-progress">ボス: ' + ch.boss + '</div>';
      if (unlocked) card.addEventListener("click", function () { startBattle("chapter", ch.id); });
      list.appendChild(card);
    });

    var f = document.createElement("div");
    f.className = "chapter-card final";
    var funlocked = state.clearedChapters.length >= FINAL_BOSS.needClear;
    if (state.finalCleared) f.classList.add("cleared");
    if (!funlocked) f.classList.add("locked");
    f.innerHTML =
      '<img class="ch-emoji" src="' + mobSrc("boss") + '" alt="" />' +
      '<div class="ch-title">' + FINAL_BOSS.title + '</div>' +
      '<div class="ch-pages">ぜんぶの 漢字から しゅつだい</div>' +
      '<div class="ch-chars">' + FINAL_BOSS.boss + '</div>' +
      '<div class="ch-progress">' + (funlocked ? "ちょうせん できる！" : "10ステージ クリアで かいほう") + '</div>';
    if (funlocked) f.addEventListener("click", function () { startBattle("final"); });
    list.appendChild(f);
  }

  // ===== かんじずかん =====
  function renderDex() {
    var grid = document.getElementById("dex-grid");
    grid.innerHTML = "";
    Object.keys(KANJI).forEach(function (ch) {
      var cell = document.createElement("div");
      cell.className = "dex-cell" + (state.learned[ch] ? " got" : "");
      cell.textContent = ch;
      grid.appendChild(cell);
    });
  }

  // ===== 出題づくり =====
  function buildQuestions(chars, mode) {
    var qs = [];
    if (mode === "final") {
      Object.keys(KANJI).forEach(function (ch) {
        qs.push({ char: ch, mode: Math.random() < 0.5 ? "read" : "write" });
      });
      return shuffle(qs); // 全53字・総まとめ
    }
    chars.forEach(function (ch) {
      qs.push({ char: ch, mode: "read" });
      qs.push({ char: ch, mode: "read" }); // 読みは2回出題
      qs.push({ char: ch, mode: "write" });
    });
    qs = shuffle(qs);
    if (qs.length > 24) qs = qs.slice(0, 24);
    return qs;
  }

  // ===== バトル開始 =====
  function startBattle(type, chapterId) {
    var queue, enemyName, sprite;
    if (type === "final") {
      queue = buildQuestions(null, "final");
      enemyName = FINAL_BOSS.boss;
      sprite = "boss";
    } else if (type === "weak") {
      queue = buildQuestions(Object.keys(state.weak), "mix");
      enemyName = "にがて まじん";
      sprite = "weak";
    } else {
      var ch = CHAPTERS[chapterId - 1];
      queue = buildQuestions(ch.chars, "mix");
      enemyName = ch.boss;
      sprite = MOBS[chapterId - 1] || "creeper";
    }

    state.battle = {
      type: type,
      chapterId: chapterId || null,
      queue: queue,
      idx: 0,
      enemyMaxHp: queue.length,
      enemyHp: queue.length,
      heroMaxHp: maxHp(),
      heroHp: maxHp(),
      combo: 0,
      gainedExp: 0,
      leveledUp: false,
      awardedExp: 0
    };

    document.getElementById("enemy-name").textContent = enemyName;
    var spr = document.getElementById("enemy-sprite");
    spr.src = mobSrc(sprite);
    spr.classList.remove("defeated", "hit");
    document.getElementById("combo-box").textContent = "";
    updateBars();
    go("battle");
    nextQuestion();
  }

  function updateBars() {
    var b = state.battle;
    setBar("enemy-hp-fill", b.enemyHp / b.enemyMaxHp * 100);
    renderHearts("battle-hearts", b.heroHp, b.heroMaxHp);
  }

  function nextQuestion() {
    var b = state.battle;
    if (!b) return;
    if (b.enemyHp <= 0) { endBattle(true); return; }
    if (b.idx >= b.queue.length) { endBattle(true); return; }
    var q = b.queue[b.idx];
    if (q.mode === "read") showRead(q); else showWrite(q);
  }

  // ===== 読み問題（4択・自動採点） =====
  function showRead(q) {
    panelRead.hidden = false;
    panelWrite.hidden = true;
    var data = KANJI[q.char];
    readWord.textContent = data.read[0];
    var correct = data.read[1];
    var pool = [];
    var seen = {};
    ALL_YOMI.forEach(function (y) {
      if (y !== correct && !seen[y]) { seen[y] = true; pool.push(y); }
    });
    var distract = shuffle(pool).slice(0, 3);
    var choices = shuffle([correct].concat(distract));
    readChoices.innerHTML = "";
    choices.forEach(function (c) {
      var btn = document.createElement("button");
      btn.className = "choice";
      btn.textContent = c;
      btn.addEventListener("click", function () { judgeRead(btn, c, correct, q); }, { once: true });
      readChoices.appendChild(btn);
    });
  }

  function judgeRead(btn, chosen, correct, q) {
    var btns = readChoices.querySelectorAll(".choice");
    Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
    if (chosen === correct) {
      btn.classList.add("correct");
      onCorrect(q);
    } else {
      btn.classList.add("wrong");
      Array.prototype.forEach.call(btns, function (b) {
        if (b.textContent === correct) b.classList.add("correct");
      });
      toast("せいかいは「" + correct + "」！");
      onWrong(q, true);
    }
  }

  // ===== 書き問題（手書き・自己採点） =====
  function showWrite(q) {
    panelRead.hidden = true;
    panelWrite.hidden = false;
    var data = KANJI[q.char];
    writeHint.textContent = data.write[0];
    var ans = data.write[1];
    modelAnswer.innerHTML = "";
    for (var i = 0; i < ans.length; i++) {
      var s = document.createElement("span");
      s.textContent = ans.charAt(i);
      modelAnswer.appendChild(s); // 1文字＝1マス（十字の中心に配置）
    }
    canvasWrap.style.setProperty("--cells", ans.length);
    state.currentWrite = q;
    state.writePhase = 1;
    modelAnswer.hidden = false; // Phase 1: お手本を見ながらなぞる
    document.getElementById("btn-write-ok").hidden = true;
    document.getElementById("btn-write-ng").textContent = "なぞれた！";
    document.getElementById("btn-model").hidden = true;
    requestAnimationFrame(function () { setupCanvas(); clearCanvas(); });
  }

  function submitWrite(ok) {
    var q = state.currentWrite;
    if (!q) return;
    if (ok) {
      if (!state.hasInk) { toast("じぶんで かいてから「かけた！」をおそう"); return; }
      onCorrect(q);
    } else {
      modelAnswer.hidden = false; // お手本を見せてから再挑戦
      onWrong(q, false);          // 書きは自己申告なので体力は減らさない
    }
  }

  // ===== 正解／不正解の処理 =====
  function onCorrect(q) {
    var b = state.battle;
    b.combo++;
    var crit = b.combo >= 3;
    b.enemyHp = Math.max(0, b.enemyHp - 1);
    b.idx++;
    recordResult(q.char, true);
    b.gainedExp += crit ? 10 : 6;
    showCombo(b.combo, crit);
    hitEnemy(crit);
    spark(crit ? "💥" : "⭐");
    updateBars();
    if (b.enemyHp <= 0) {
      document.getElementById("enemy-sprite").classList.add("defeated");
      setTimeout(function () { endBattle(true); }, 760);
    } else {
      setTimeout(nextQuestion, 720);
    }
  }

  function onWrong(q, costHp) {
    var b = state.battle;
    b.combo = 0;
    recordResult(q.char, false);
    if (costHp) {
      b.heroHp = Math.max(0, b.heroHp - 1);
      screenShake();
    }
    showCombo(0, false);
    updateBars();
    if (b.heroHp <= 0) {
      setTimeout(function () { endBattle(false); }, 900);
    } else {
      setTimeout(nextQuestion, costHp ? 1800 : 950);
    }
  }

  function recordResult(ch, ok) {
    state.attempts++;
    if (ok) {
      state.corrects++;
      state.learned[ch] = true;
      if (state.weak[ch]) {
        state.weak[ch] -= 1;
        if (state.weak[ch] <= 0) delete state.weak[ch];
      }
    } else {
      // ミスは弱点に残す（同じバトル内の正解で相殺されても1以上残るよう+3）
      state.weak[ch] = (state.weak[ch] || 0) + 3;
    }
  }

  // ===== バトル終了 =====
  function endBattle(win) {
    var b = state.battle;
    if (win) {
      var bonus = b.type === "final" ? 50 : 20;
      b.awardedExp = b.gainedExp + bonus;
      b.leveledUp = gainExp(b.awardedExp);
      if (b.type === "chapter" && state.clearedChapters.indexOf(b.chapterId) < 0) {
        state.clearedChapters.push(b.chapterId);
      }
      if (b.type === "final") state.finalCleared = true;
      updateStreak();
    }
    save();
    showResult(win);
  }

  function gainExp(amount) {
    state.exp += amount;
    var leveled = false;
    while (state.exp >= needExp(state.level)) {
      state.exp -= needExp(state.level);
      state.level++;
      leveled = true;
    }
    return leveled;
  }

  function updateStreak() {
    var today = todayStr();
    if (state.lastPlayDate === today) return;
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (state.lastPlayDate === fmtDate(y)) state.streak += 1;
    else state.streak = 1;
    state.lastPlayDate = today;
  }

  // ===== 結果画面 =====
  function showResult(win) {
    var b = state.battle;
    document.getElementById("result-emoji").textContent = win ? (b.type === "final" ? "👑" : "🎉") : "💧";
    document.getElementById("result-title").textContent =
      win ? (b.type === "final" ? "漢字王を たおした！" : "ステージ クリア！") : "やられた…";
    document.getElementById("result-sub").textContent =
      win ? "よく がんばった！" : "もういちど ちょうせんしよう！";

    var rw = document.getElementById("result-rewards");
    rw.innerHTML = "";
    if (win) {
      addReward("＋" + b.awardedExp + " EXP");
      addReward("📖 おぼえた字 " + learnedCount() + " / 53");
      if (b.type === "chapter") {
        if (b.chapterId < CHAPTERS.length) addReward("🔓 つぎのステージ かいほう！");
        else if (state.clearedChapters.length >= FINAL_BOSS.needClear) addReward("🔓 最終ステージ かいほう！");
      }
    } else {
      addReward("にがて字は 弱点とっくんで とりかえせる！");
    }
    document.getElementById("levelup-banner").hidden = !(win && b.leveledUp);
    go("result");
  }

  function addReward(text) {
    var d = document.createElement("div");
    d.textContent = text;
    document.getElementById("result-rewards").appendChild(d);
  }

  // ===== 手書きキャンバス =====
  function setupCanvas() {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#22d3ee";
    ctx.fillStyle = "#22d3ee";
    ctx.shadowColor = "rgba(34,211,238,.8)";
    ctx.shadowBlur = 8;
  }
  function clearCanvas() {
    if (!ctx) return;
    var rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    state.hasInk = false;
  }
  function ptFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function startDraw(e) {
    e.preventDefault();
    if (!ctx) setupCanvas();
    drawing = true;
    var p = ptFromEvent(e);
    lastX = p.x; lastY = p.y;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    state.hasInk = true;
  }
  function moveDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    var p = ptFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
    state.hasInk = true;
  }
  function endDraw(e) {
    if (!drawing) return;
    if (e && e.preventDefault) e.preventDefault();
    drawing = false;
  }

  // ===== 演出 =====
  function hitEnemy(crit) {
    var sprite = document.getElementById("enemy-sprite");
    sprite.classList.remove("hit"); void sprite.offsetWidth; sprite.classList.add("hit");
    var hf = document.getElementById("hit-float");
    hf.textContent = crit ? "会心!" : "HIT!";
    hf.classList.remove("go"); void hf.offsetWidth; hf.classList.add("go");
  }
  function showCombo(n, crit) {
    var box = document.getElementById("combo-box");
    if (n >= 2) {
      box.textContent = (crit ? "🔥" : "") + n + " COMBO";
      box.classList.remove("show"); void box.offsetWidth; box.classList.add("show");
    } else {
      box.textContent = "";
    }
  }
  function spark(emoji) {
    var layer = document.getElementById("fx-layer");
    var el = document.createElement("div");
    el.className = "spark";
    el.textContent = emoji;
    el.style.left = (30 + Math.random() * 40) + "%";
    el.style.top = (35 + Math.random() * 20) + "%";
    layer.appendChild(el);
    setTimeout(function () { el.remove(); }, 1200);
  }
  function screenShake() {
    var app = document.getElementById("app");
    app.classList.remove("shake-screen"); void app.offsetWidth; app.classList.add("shake-screen");
    setTimeout(function () { app.classList.remove("shake-screen"); }, 400);
  }
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  // ===== 初期化 =====
  function init() {
    document.querySelectorAll("[data-go]").forEach(function (el) {
      el.addEventListener("click", function () {
        var dest = el.getAttribute("data-go");
        if (dest === "home") renderHome();
        if (dest === "map") renderMap();
        if (dest === "dex") renderDex();
        go(dest);
      });
    });

    document.getElementById("btn-adventure").addEventListener("click", function () { renderMap(); go("map"); });
    document.getElementById("btn-dex").addEventListener("click", function () { renderDex(); go("dex"); });
    document.getElementById("btn-weak").addEventListener("click", function () {
      if (!Object.keys(state.weak).length) { toast("いまは にがてな字が ないよ！"); return; }
      startBattle("weak");
    });

    document.getElementById("btn-clear").addEventListener("click", clearCanvas);
    document.getElementById("btn-model").addEventListener("click", function () {
      modelAnswer.hidden = !modelAnswer.hidden;
    });
    document.getElementById("btn-write-ok").addEventListener("click", function () { submitWrite(true); });
    document.getElementById("btn-write-ng").addEventListener("click", function () {
      if (state.writePhase === 1) {
        if (!state.hasInk) { toast("なぞってから おそう！"); return; }
        modelAnswer.hidden = true;
        clearCanvas();
        state.writePhase = 2;
        document.getElementById("btn-write-ok").hidden = false;
        document.getElementById("btn-write-ng").textContent = "もういちど";
        document.getElementById("btn-model").hidden = false;
      } else {
        submitWrite(false);
      }
    });

    document.getElementById("btn-result-next").addEventListener("click", function () {
      var b = state.battle;
      if (b && b.type === "final" && state.finalCleared) { renderHome(); go("home"); }
      else { renderMap(); go("map"); }
    });

    canvas.addEventListener("pointerdown", startDraw);
    canvas.addEventListener("pointermove", moveDraw);
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);
    canvas.addEventListener("pointerleave", endDraw);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }

    renderHome();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
