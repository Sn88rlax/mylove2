const MAX_DAYS = 10;

const STORAGE_KEY = "escapeForLove:v3";
const DAY_MS = 24 * 60 * 60 * 1000;

let viewingDay = 1;
let revealTimeout = null;
let revealCancelled = false;
let revealDone = false;
let activeRevealToken = 0;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { choices: {}, completedAt: {}, deltas: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { choices: {}, completedAt: {}, deltas: {} };
    if (!parsed.choices || typeof parsed.choices !== "object") parsed.choices = {};
    if (!parsed.completedAt || typeof parsed.completedAt !== "object") parsed.completedAt = {};
    if (!parsed.deltas || typeof parsed.deltas !== "object") parsed.deltas = {};
    return parsed;
  } catch {
    return { choices: {}, completedAt: {}, deltas: {} };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function recomputeStatsAB(state) {
  const stats = { A: 0, B: 0 };
  for (let d = 1; d <= MAX_DAYS; d++) {
    const delta = state.deltas?.[String(d)];
    if (!delta) continue;
    stats.A += Number(delta.A || 0);
    stats.B += Number(delta.B || 0);
  }
  state.stats = stats;
  return state;
}

const projector = document.getElementById("projector");
const fade = document.querySelector(".fade");
const title = document.getElementById("dayTitle");
const meta = document.getElementById("dayMeta");
const textEl = document.getElementById("storyText");
const choiceBox = document.getElementById("choiceBox");
const storyScroll = document.getElementById("storyScroll");
const filmBurn = document.querySelector(".film-burn");
const flip = document.getElementById("flip");

function clearReveal() {
  if (revealTimeout) {
    clearTimeout(revealTimeout);
    revealTimeout = null;
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function loadDayData(day) {
  const url = `days/day${pad2(day)}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return await res.json();
}

function matchesWhen(when, state) {
  if (!when) return true;
  const minStats = when.minStats;
  if (minStats && typeof minStats === "object") {
    for (const [k, v] of Object.entries(minStats)) {
      if ((state.stats?.[k] ?? 0) < Number(v)) return false;
    }
  }
  const maxStats = when.maxStats;
  if (maxStats && typeof maxStats === "object") {
    for (const [k, v] of Object.entries(maxStats)) {
      if ((state.stats?.[k] ?? 0) > Number(v)) return false;
    }
  }
  return true;
}

function selectFinalVariantText(dayData, state) {
  const variants = Array.isArray(dayData?.variants) ? dayData.variants : [];
  for (const v of variants) {
    if (matchesWhen(v.when, state) && typeof v.text === "string") return v.text;
  }
  return typeof dayData?.text === "string" ? dayData.text : "";
}

function getUnlockedDay(state, nowMs = Date.now()) {
  // День 1 всегда доступен. Следующий открывается строго через 24ч после выбора в текущем.
  let unlocked = 1;
  for (let d = 1; d < MAX_DAYS; d++) {
    const key = String(d);
    const choice = state.choices?.[key];
    const t = Number(state.completedAt?.[key] || 0);
    if (!choice || !t) break;
    if (nowMs - t >= DAY_MS) unlocked = d + 1;
    else break;
  }
  return Math.min(Math.max(unlocked, 1), MAX_DAYS);
}

function msToUnlockNext(state, nowMs = Date.now()) {
  const unlocked = getUnlockedDay(state, nowMs);
  const key = String(unlocked);
  // если текущий (unlocked) еще не выбран — до следующего дня таймер не идёт
  if (state.choices?.[key]) {
    const t = Number(state.completedAt?.[key] || 0);
    if (!t) return null;
    return Math.max(0, DAY_MS - (nowMs - t));
  }
  return null;
}

function kickFrameJump() {
  document.body.classList.add("jump");
  filmBurn?.classList.remove("pulse");
  void filmBurn?.offsetHeight;
  filmBurn?.classList.add("pulse");
  setTimeout(() => document.body.classList.remove("jump"), 90);
}

function showChoices() {
  choiceBox.classList.remove("isHidden");
  choiceBox.classList.add("isShown");
}

function hideChoices() {
  choiceBox.classList.remove("isShown");
  choiceBox.classList.add("isHidden");
}

function renderChoices(day, dayData, state, unlocked) {
  choiceBox.innerHTML = "";

  const locked = day > unlocked;
  const hasChoices = dayData?.choices && (dayData.choices.A || dayData.choices.B);

  if (!hasChoices) return;

  const chosen = state.choices?.[String(day)] || null;

  const row = document.createElement("div");
  row.className = "choiceRow";

  const makeBtn = (key) => {
    const cfg = dayData.choices?.[key];
    if (!cfg || typeof cfg.label !== "string") return null;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choiceBtn";
    btn.textContent = cfg.label;
    btn.disabled = locked || Boolean(chosen);
    btn.setAttribute("aria-pressed", chosen === key ? "true" : "false");
    btn.addEventListener("click", () => {
      if (locked || !revealDone) return;
      if (state.choices?.[String(day)]) return; // фиксируем выбор навсегда

      // визуальная реакция на выбор
      btn.classList.add("burning");
      const other = row.querySelectorAll(".choiceBtn");
      other.forEach((b) => { if (b !== btn) b.disabled = true; });

      const st = recomputeStatsAB(loadState());
      st.choices[String(day)] = key;
      st.completedAt[String(day)] = Date.now();
      const eff = cfg.effects && typeof cfg.effects === "object" ? cfg.effects : { A: 0, B: 0 };
      st.deltas[String(day)] = { A: Number(eff.A || 0), B: Number(eff.B || 0) };
      recomputeStatsAB(st);
      saveState(st);

      kickFrameJump();

      setTimeout(() => {
        // остаёмся на этом дне — ниже покажем "последствие выбора"
        playDay(day);
      }, 520);
    });
    return btn;
  };

  const a = makeBtn("A");
  const b = makeBtn("B");
  if (a) row.appendChild(a);
  if (b) row.appendChild(b);

  const hint = document.createElement("div");
  hint.className = "choiceHint";
  choiceBox.appendChild(row);

  if (locked) {
    const st = recomputeStatsAB(loadState());
    const unlockedNow = getUnlockedDay(st);
    const ms = msToUnlockNext(st);
    hint.textContent = unlockedNow >= day ? "" : (ms == null ? "" : `Следующий день откроется через ${Math.ceil(ms / 3600000)} ч.`);
    if (hint.textContent) choiceBox.appendChild(hint);
  }

  // текст последствий выбора
  if (chosen) {
    const after = dayData?.choices?.[chosen]?.afterText;
    if (typeof after === "string" && after.trim().length) {
      const afterEl = document.createElement("div");
      afterEl.className = "afterText";
      afterEl.textContent = after;
      choiceBox.appendChild(afterEl);
    }
  }
}

async function playDay(day) {
  clearReveal();
  revealCancelled = false;
  revealDone = false;
  activeRevealToken += 1;
  const token = activeRevealToken;

  fade.style.animation = "none";
  fade.offsetHeight;
  fade.style.animation = "fadeOut 2s forwards";

  projector.currentTime = 0;
  projector.play().catch(()=>{});

  const state = recomputeStatsAB(loadState());
  const unlocked = getUnlockedDay(state);
  if (day > unlocked) day = unlocked;
  viewingDay = day;

  const dayData = await loadDayData(day).catch(() => ({
    day,
    text: "Не удалось загрузить текст дня.\n\nЕсли ты открыл страницу двойным кликом (file://), браузер блокирует fetch к JSON.\nНа Vercel всё будет работать.\nЛокально открой через любой сервер.",
    variants: [
      {
        text: "Не удалось загрузить текст дня.\n\nЕсли ты открыл страницу двойным кликом (file://), браузер блокирует fetch к JSON.\nНа Vercel всё будет работать.\nЛокально открой через любой сервер."
      }
    ],
    choices: null
  }));
  const preText = typeof dayData?.text === "string" ? dayData.text : "";
  const finalText = day === 10 ? selectFinalVariantText(dayData, state) : "";
  const text = day === 10 ? finalText : preText;

  title.textContent = `День ${day}`;
  meta.textContent = ""; // без надписей
  textEl.textContent = "";
  storyScroll.scrollTop = 0;
  hideChoices();

  let i = 0;

  function reveal() {
    if (token !== activeRevealToken) return;
    if (revealCancelled) {
      textEl.textContent = text;
      revealDone = true;
      renderChoices(day, dayData, state, unlocked);
      showChoices();
      return;
    }
    if (i < text.length) {
      textEl.textContent += text[i];
      let delay = 28;

      if (text[i] === "." || text[i] === "—") delay = 320;
      if (text[i] === "\n") delay = 520;

      i++;
      revealTimeout = setTimeout(reveal, delay);
    } else {
      revealDone = true;
      renderChoices(day, dayData, state, unlocked);
      showChoices();
    }
  }

  revealTimeout = setTimeout(reveal, 700);
}

textEl.addEventListener("click", () => {
  revealCancelled = true;
  clearReveal();
});

prevBtn.addEventListener("click", () => {
  if (viewingDay > 1) {
    viewingDay -= 1;
    playDay(viewingDay);
  }
});

nextBtn.addEventListener("click", () => {
  const state = recomputeStats(loadState());
  const unlocked = Math.min(Math.max(state.unlockedDay || 1, 1), MAX_DAYS);
  if (viewingDay < unlocked) {
    viewingDay += 1;
    playDay(viewingDay);
  }
});

function playFlip(direction) {
  if (!flip) return;
  flip.classList.remove("flipLeft", "flipRight");
  void flip.offsetHeight;
  flip.classList.add(direction === "left" ? "flipLeft" : "flipRight");
}

// стартуем с последнего ДОСТУПНОГО дня, чтобы можно было "вспоминать"
{
  const st = recomputeStatsAB(loadState());
  saveState(st);
  viewingDay = getUnlockedDay(st);
  playDay(viewingDay);
}

/* TOUCH */
let startX = 0;
let startY = 0;
let swiping = false;

document.addEventListener("touchstart", e => {
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
  swiping = false;
}, { passive: true });

document.addEventListener("touchmove", e => {
  const dx = e.touches[0].clientX - startX;
  const dy = e.touches[0].clientY - startY;
  if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.2) {
    swiping = true;
  }
}, { passive: true });

document.addEventListener("touchend", e => {
  if (!swiping) return;
  const diff = e.changedTouches[0].clientX - startX;
  if (diff > 60 && viewingDay > 1) {
    viewingDay--;
    playFlip("right");
    playDay(viewingDay);
  }
  if (diff < -60) {
    const state = recomputeStatsAB(loadState());
    const unlocked = getUnlockedDay(state);
    if (viewingDay < unlocked) {
      viewingDay++;
      playFlip("left");
      playDay(viewingDay);
    }
  }
});

/* MOUSE (ПК) */
let mouseStartX = 0;
let mouseDown = false;

document.addEventListener("mousedown", e => {
  mouseDown = true;
  mouseStartX = e.clientX;
});

document.addEventListener("mouseup", e => {
  if (!mouseDown) return;
  mouseDown = false;

  const diff = e.clientX - mouseStartX;

  if (diff > 80 && viewingDay > 1) {
    viewingDay--;
    playFlip("right");
    playDay(viewingDay);
  }

  if (diff < -80) {
    const state = recomputeStatsAB(loadState());
    const unlocked = getUnlockedDay(state);
    if (viewingDay < unlocked) {
      viewingDay++;
      playFlip("left");
      playDay(viewingDay);
    }
  }
});
