/* ============================================================
   stroop.js — the Stroop round itself, fully seeded so both
   players see the identical sequence of words and ink colors.
   ============================================================ */
const Stroop = (() => {
  const PALETTE = [
    { name: "RED",    css: "var(--c-red)" },
    { name: "BLUE",   css: "var(--c-blue)" },
    { name: "GREEN",  css: "var(--c-green)" },
    { name: "YELLOW", css: "var(--c-yellow)" },
    { name: "PURPLE", css: "var(--c-purple)" },
    { name: "ORANGE", css: "var(--c-orange)" },
    { name: "PINK",   css: "var(--c-pink)" },
    { name: "CYAN",   css: "var(--c-cyan)" },
  ];

  /* mulberry32 — tiny seeded PRNG so both players share randomness */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let rng = null;
  let colors = [];          // active subset of PALETTE
  let trapRate = 0.75;
  let order = [];            // shuffled color indices → button positions
  let current = null;        // { word, inkIndex }
  let score = 0;
  let running = false;
  let timerId = null;
  let endTime = 0;
  let cb = {};               // { onScore, onEnd }

  const el = {};

  function cacheEls() {
    el.word = document.getElementById("stroop-word");
    el.buttons = document.getElementById("color-buttons");
    el.timer = document.getElementById("timer");
    el.fill = document.getElementById("timer-fill");
    el.myScore = document.getElementById("my-score");
    el.keysHint = document.getElementById("keys-hint");
  }

  /* seeded Fisher–Yates — both players shuffle identically */
  function shuffleOrder() {
    order = colors.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  function nextPrompt() {
    // new random button layout every prompt
    shuffleOrder();
    buildButtons();
    // pick ink color
    const inkIndex = Math.floor(rng() * colors.length);
    // trap: word meaning differs from ink; otherwise they match
    let wordIndex;
    if (rng() < trapRate && colors.length > 1) {
      do { wordIndex = Math.floor(rng() * colors.length); } while (wordIndex === inkIndex);
    } else {
      wordIndex = inkIndex;
    }
    current = { word: colors[wordIndex].name, inkIndex };
    el.word.textContent = current.word;
    el.word.style.color = colors[inkIndex].css;
    el.word.classList.remove("pop");
    void el.word.offsetWidth; // restart animation
    el.word.classList.add("pop");
  }

  /* pos = position of the clicked button; order[pos] = actual color index */
  function answer(pos) {
    if (!running || current === null) return;
    if (pos >= order.length) return;
    if (order[pos] === current.inkIndex) {
      score += 10;
    } else {
      score -= 5;
      const btn = el.buttons.children[pos];
      if (btn) {
        btn.classList.remove("flash-wrong");
        void btn.offsetWidth;
        btn.classList.add("flash-wrong");
      }
    }
    el.myScore.textContent = score;
    cb.onScore(score);
    nextPrompt();
  }

  function buildButtons() {
    el.buttons.innerHTML = "";
    // symmetric rows: 4 → 4 · 6 → 3+3 · 8 → 4+4
    const perRow = colors.length === 6 ? 3 : Math.min(colors.length, 4);
    el.buttons.style.setProperty("--btn-w", perRow === 3 ? "31%" : "23%");
    order.forEach((colorIdx, pos) => {
      const c = colors[colorIdx];
      const b = document.createElement("button");
      b.className = "color-btn";
      b.style.background = c.css;
      b.innerHTML = `<span class="key">${pos + 1}</span>`;
      b.setAttribute("aria-label", c.name);
      b.addEventListener("click", () => answer(pos));
      el.buttons.appendChild(b);
    });
    el.keysHint.textContent = `Press 1–${colors.length} or click`;
  }

  function onKey(e) {
    const n = parseInt(e.key, 10);
    if (!isNaN(n) && n >= 1 && n <= colors.length) answer(n - 1);
  }

  function tick() {
    const left = Math.max(0, endTime - performance.now());
    el.timer.textContent = (left / 1000).toFixed(1);
    el.timer.classList.toggle("low", left < 5000);
    const total = endTime - startTimeMs;
    el.fill.style.width = `${(left / total) * 100}%`;
    if (left <= 0) {
      stop();
      cb.onEnd(score);
    }
  }

  let startTimeMs = 0;

  function stop() {
    running = false;
    clearInterval(timerId);
    document.removeEventListener("keydown", onKey);
  }

  return {
    /* start a round: settings = {colors, duration, trapRate}, seed = int */
    start(settings, seed, onScore, onEnd) {
      cacheEls();
      rng = mulberry32(seed);
      colors = PALETTE.slice(0, settings.colors);
      trapRate = settings.trapRate;
      score = 0;
      cb = { onScore, onEnd };

      el.myScore.textContent = "0";
      el.word.hidden = false;

      running = true;
      startTimeMs = performance.now();
      endTime = startTimeMs + settings.duration * 1000;
      document.addEventListener("keydown", onKey);
      timerId = setInterval(tick, 100);
      nextPrompt();
    },

    abort() { stop(); },
  };
})();
