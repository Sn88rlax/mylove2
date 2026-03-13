const MAX_DAYS = 10;

const STORAGE_KEY = "escapeForLove:v2";

let viewingDay = 1;
let revealTimeout = null;
let revealCancelled = false;
let revealDone = false;
let activeRevealToken = 0;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { unlockedDay: 1, choices: {}, stats: { trust: 0, courage: 0, surrender: 0 } };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { unlockedDay: 1, choices: {}, stats: { trust: 0, courage: 0, surrender: 0 } };
    if (typeof parsed.unlockedDay !== "number") parsed.unlockedDay = 1;
    if (!parsed.choices || typeof parsed.choices !== "object") parsed.choices = {};
    return parsed;
  } catch {
    return { unlockedDay: 1, choices: {}, stats: { trust: 0, courage: 0, surrender: 0 } };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function recomputeStats(state) {
  const stats = { trust: 0, courage: 0, surrender: 0 };
  for (let d = 1; d <= MAX_DAYS; d++) {
    const c = state.choices?.[String(d)];
    if (c === "A") {
      stats.trust += 1;
      stats.courage += 1;
    } else if (c === "B") {
      stats.surrender += 1;
      stats.trust += 1;
    }
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
const prevBtn = document.getElementById("prevDay");
const nextBtn = document.getElementById("nextDay");
const timeline = document.getElementById("timeline");
const filmBurn = document.querySelector(".film-burn");

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
  const choices = when.choices;
  if (choices && typeof choices === "object") {
    for (const [k, v] of Object.entries(choices)) {
      if (state.choices?.[String(k)] !== v) return false;
    }
  }
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

function selectVariantText(dayData, state) {
  const variants = Array.isArray(dayData?.variants) ? dayData.variants : [];
  for (const v of variants) {
    if (matchesWhen(v.when, state) && typeof v.text === "string") return v.text;
  }
  if (typeof dayData?.text === "string") return dayData.text;
  return "";
}

function setNavDisabled() {
  const state = recomputeStats(loadState());
  const unlocked = Math.min(Math.max(state.unlockedDay || 1, 1), MAX_DAYS);
  prevBtn.disabled = viewingDay <= 1;
  nextBtn.disabled = viewingDay >= unlocked;
}

function kickFrameJump() {
  document.body.classList.add("jump");
  filmBurn?.classList.remove("pulse");
  void filmBurn?.offsetHeight;
  filmBurn?.classList.add("pulse");
  setTimeout(() => document.body.classList.remove("jump"), 90);
}

function renderTimeline(unlocked, state) {
  timeline.innerHTML = "";
  for (let d = 1; d <= MAX_DAYS; d++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dayPill";
    btn.textContent = `Д${d}`;
    btn.disabled = d > unlocked;
    btn.setAttribute("aria-current", d === viewingDay ? "true" : "false");
    const chosen = state.choices?.[String(d)];
    if (chosen) btn.title = `Выбор: ${chosen}`;
    btn.addEventListener("click", () => {
      if (d <= unlocked) {
        viewingDay = d;
        playDay(viewingDay);
      }
    });
    timeline.appendChild(btn);
  }
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
    btn.disabled = locked;
    btn.setAttribute("aria-pressed", chosen === key ? "true" : "false");
    btn.addEventListener("click", () => {
      if (locked || !revealDone) return;

      // визуальная реакция на выбор
      btn.classList.add("burning");
      const other = row.querySelectorAll(".choiceBtn");
      other.forEach((b) => { if (b !== btn) b.disabled = true; });

      const st = recomputeStats(loadState());
      st.choices[String(day)] = key;
      st.unlockedDay = Math.min(Math.max(st.unlockedDay || 1, 1), MAX_DAYS);
      if (day === st.unlockedDay && day < MAX_DAYS) st.unlockedDay = day + 1;
      recomputeStats(st);
      saveState(st);

      kickFrameJump();

      setTimeout(() => {
        // после выбора автоматически открываем следующий день (если он открылся)
        const unlockedNow = Math.min(Math.max(st.unlockedDay || 1, 1), MAX_DAYS);
        viewingDay = Math.min(Math.max(viewingDay, 1), unlockedNow);
        if (day < unlockedNow) viewingDay = day + 1;
        playDay(viewingDay);
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
  if (locked) {
    hint.textContent = "Этот день ещё не наступил.";
  } else if (chosen) {
    hint.textContent = "Выбор сохранён. Он повлияет на следующий день и финал.";
  } else {
    hint.textContent = "Выберите, как поступить (2 варианта).";
  }

  choiceBox.appendChild(row);
  choiceBox.appendChild(hint);
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

  const state = recomputeStats(loadState());
  const unlocked = Math.min(Math.max(state.unlockedDay || 1, 1), MAX_DAYS);
  if (day > unlocked) day = unlocked;
  viewingDay = day;

  const dayData = await loadDayData(day).catch(() => ({
    day,
    variants: [{ text: "Не удалось загрузить текст дня. На Vercel всё будет ок — локально это работает только через сервер (не file://)." }],
    choices: null
  }));
  const text = selectVariantText(dayData, state);

  title.textContent = `День ${day}`;
  meta.textContent = day > unlocked ? "закрыто" : (state.choices?.[String(day)] ? "выбор сделан" : "в ожидании выбора");
  textEl.textContent = "";
  storyScroll.scrollTop = 0;
  hideChoices();
  renderTimeline(unlocked, state);
  setNavDisabled();

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

// стартуем с последнего открытого дня, чтобы можно было "вспоминать"
{
  const st = recomputeStats(loadState());
  st.unlockedDay = Math.min(Math.max(st.unlockedDay || 1, 1), MAX_DAYS);
  saveState(st);
  viewingDay = st.unlockedDay;
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
    playDay(viewingDay);
  }
  if (diff < -60) {
    const state = recomputeStats(loadState());
    const unlocked = Math.min(Math.max(state.unlockedDay || 1, 1), MAX_DAYS);
    if (viewingDay < unlocked) {
      viewingDay++;
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
    playDay(viewingDay);
  }

  if (diff < -80) {
    const state = recomputeStats(loadState());
    const unlocked = Math.min(Math.max(state.unlockedDay || 1, 1), MAX_DAYS);
    if (viewingDay < unlocked) {
      viewingDay++;
      playDay(viewingDay);
    }
  }
});
