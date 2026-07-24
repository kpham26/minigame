/* ============================================================
   match.js — the 1v1 protocol: rounds, seeds, live status,
   round results, first-to-N, rematch.

   Message types over the wire:
     hello        {settings}                      host → joiner on connect
     round_start  {round, seed}                   host → joiner
     status       {score}                         both, throttled
     finished     {round, score}                  both
     rematch_req  {}                              either
     rematch_go   {baseSeed}                      host → joiner
   ============================================================ */
const Match = (() => {
  let settings = null;
  let myName = "Player";
  let oppName = "Opponent";
  let baseSeed = 0;
  let round = 0;
  let myWins = 0, oppWins = 0;
  let myFinal = null, oppFinal = null;
  let iFinished = false, oppFinished = false;
  let lastStatusSent = 0;
  let rematchMe = false, rematchOpp = false;
  let active = false;

  const $ = (id) => document.getElementById(id);

  function roundSeed(r) {
    // derive per-round seed deterministically from the base seed
    return (baseSeed + r * 7919) >>> 0;
  }

  function updateMatchScoreUI() {
    $("match-score").textContent = `${myWins} – ${oppWins}`;
  }

  function resetRoundFlags() {
    myFinal = null; oppFinal = null;
    iFinished = false; oppFinished = false;
  }

  function startRound(r) {
    round = r;
    resetRoundFlags();
    active = true;

    UI.showScreen("screen-game");
    $("overlay-round").hidden = true;
    $("overlay-end").hidden = true;
    $("round-label").textContent = `ROUND ${round}`;
    $("opp-name").textContent = oppName;
    $("opp-score").textContent = "0";
    $("opp-status").innerHTML = `<span class="dot live"></span> playing`;
    $("my-score").textContent = "0";
    const scareBtn = $("btn-scare");
    scareBtn.hidden = !(window.AppState && window.AppState.admin);
    scareBtn.disabled = false;
    scareBtn.textContent = "👻 Scare them";
    $("timer").textContent = settings.duration.toFixed(1);
    $("timer-fill").style.width = "100%";
    updateMatchScoreUI();

    // 3-2-1 countdown, then play
    const cd = $("countdown");
    const word = $("stroop-word");
    word.hidden = true;
    $("round-msg").hidden = true;
    cd.hidden = false;
    let n = 3;
    cd.textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n > 0) { cd.textContent = n; return; }
      clearInterval(iv);
      cd.hidden = true;
      Stroop.start(settings, roundSeed(round), onMyScore, onMyRoundEnd);
    }, 800);
  }

  function onMyScore(score) {
    const now = performance.now();
    if (now - lastStatusSent > 250) {
      lastStatusSent = now;
      Net.send({ type: "status", score });
    }
  }

  function onMyRoundEnd(finalScore) {
    myFinal = finalScore;
    iFinished = true;
    Net.send({ type: "status", score: finalScore }); // final flush
    Net.send({ type: "finished", round, score: finalScore });
    $("stroop-word").hidden = true;
    const msg = $("round-msg");
    msg.hidden = false;
    msg.textContent = oppFinished ? "" : "Time! Waiting for opponent…";
    maybeResolveRound();
  }

  function maybeResolveRound() {
    if (!iFinished || !oppFinished || myFinal === null || oppFinal === null) return;

    let title;
    if (myFinal > oppFinal) { myWins++; title = "You take the round! 🎉"; }
    else if (oppFinal > myFinal) { oppWins++; title = `${oppName} takes the round`; }
    else { title = "Round tied — no point"; }

    updateMatchScoreUI();

    // match over?
    if (myWins >= settings.winsNeeded || oppWins >= settings.winsNeeded) {
      showMatchEnd();
      return;
    }

    // round result overlay, then next round
    $("round-result-title").textContent = title;
    $("rr-me").textContent = myFinal;
    $("rr-opp").textContent = oppFinal;
    $("rr-opp-name").textContent = oppName;
    $("rr-match").textContent = `Match: ${myWins} – ${oppWins} (first to ${settings.winsNeeded})`;
    $("overlay-round").hidden = false;

    setTimeout(() => {
      $("overlay-round").hidden = true;
      startRound(round + 1);
    }, 3000);
  }

  function showMatchEnd() {
    active = false;
    rematchMe = false; rematchOpp = false;
    const won = myWins > oppWins;
    const t = $("end-title");
    t.textContent = won ? "You win! 🏆" : "You lose";
    t.className = "end-title " + (won ? "win" : "lose");
    $("end-detail").textContent = `Final: ${myWins} – ${oppWins}`;
    $("rematch-status").hidden = true;
    $("btn-rematch").disabled = false;
    $("overlay-end").hidden = false;
  }

  function beginMatch() {
    myWins = 0; oppWins = 0;
    updateMatchScoreUI();
    startRound(1);
  }

  /* ---------- incoming messages ---------- */
  function onMessage(msg) {
    switch (msg.type) {
      case "hello": // joiner receives settings + host name
        settings = msg.settings;
        if (msg.name) oppName = msg.name;
        Net.send({ type: "hi", name: myName }); // introduce ourselves back
        UI.showRoomAsJoiner(settings, oppName);
        break;

      case "hi": // host receives joiner's name
        if (msg.name) oppName = msg.name;
        break;

      case "round_start": // joiner starts the round
        if (!settings) return;
        baseSeed = msg.baseSeed;
        startRound(msg.round);
        break;

      case "status":
        $("opp-score").textContent = msg.score;
        break;

      case "finished":
        if (msg.round !== round) return;
        oppFinal = msg.score;
        oppFinished = true;
        $("opp-status").innerHTML = `<span class="dot done"></span> finished`;
        $("opp-score").textContent = msg.score;
        maybeResolveRound();
        break;

      case "rematch_req":
        rematchOpp = true;
        tryRematch();
        break;

      case "rematch_go": // joiner side
        baseSeed = msg.baseSeed;
        beginMatch();
        break;

      case "scare":
        playScare();
        break;
    }
  }

  /* ---------- jumpscare (received from opponent) ---------- */
  /* Uses ONLY your files in assets/: scare.png (or .gif/.jpg/.webp)
     + scare.mp3. No built-in fallback. Cache-busted on every load. */
  const SCARE_IMAGES = ["assets/scare.png", "assets/scare.gif", "assets/scare.jpg", "assets/scare.webp"];
  const SCARE_SOUND = "assets/scare.mp3";
  const BUST = "?v=" + Date.now();
  let customImgSrc = null;
  let scareAudio = null;

  (function preloadScareAssets() {
    SCARE_IMAGES.forEach((src) => {
      const img = new Image();
      img.onload = () => { if (!customImgSrc) customImgSrc = src + BUST; };
      img.src = src + BUST;
    });
    scareAudio = new Audio(SCARE_SOUND + BUST);
    scareAudio.preload = "auto";
    scareAudio.onerror = () => {
      console.warn("Stroop Duel: assets/scare.mp3 not found or failed to load.");
      scareAudio = null;
    };
  })();

  let scareEndTimer = null;

  function endScare() {
    clearTimeout(scareEndTimer);
    $("scare-overlay").hidden = true;
    document.body.classList.remove("shaking");
    if (scareAudio) scareAudio.pause();
  }

  function playScare() {
    const ov = $("scare-overlay");
    const face = ov.querySelector(".scare-face");

    // fullscreen frozen frame (blank black screen if the image file is missing)
    face.innerHTML = customImgSrc ? `<img src="${customImgSrc}" alt="">` : "";
    if (!customImgSrc) console.warn("Stroop Duel: no scare image found in assets/ (scare.png/.gif/.jpg/.webp).");

    ov.hidden = false;
    document.body.classList.remove("shaking");
    void document.body.offsetWidth;
    document.body.classList.add("shaking");

    clearTimeout(scareEndTimer);

    if (scareAudio) {
      scareAudio.currentTime = 0;
      scareAudio.volume = 0.8;
      scareAudio.onended = endScare; // overlay lasts exactly as long as the mp3
      scareAudio.play().then(() => {
        scareEndTimer = setTimeout(endScare, 30000); // safety net (30s max)
      }).catch(() => {
        scareEndTimer = setTimeout(endScare, 2500); // playback blocked — image only
      });
    } else {
      scareEndTimer = setTimeout(endScare, 2500); // no sound file — image only
    }
  }

  function tryRematch() {
    if (!Net.isHost) return; // host coordinates
    if (rematchMe && rematchOpp) {
      baseSeed = (Math.random() * 2 ** 31) >>> 0;
      Net.send({ type: "rematch_go", baseSeed });
      beginMatch();
    }
  }

  return {
    onMessage,

    /* host presses Start match */
    hostStart(chosenSettings) {
      settings = chosenSettings;
      baseSeed = (Math.random() * 2 ** 31) >>> 0;
      Net.send({ type: "round_start", round: 1, baseSeed });
      beginMatch();
    },

    /* host sends settings + name right after the joiner connects */
    hostHello(chosenSettings, name) {
      settings = chosenSettings;
      myName = name || "Player";
      Net.send({ type: "hello", settings, name: myName });
    },

    setMyName(name) { myName = name || "Player"; },

    requestRematch() {
      rematchMe = true;
      $("btn-rematch").disabled = true;
      $("rematch-status").hidden = false;
      Net.send({ type: "rematch_req" });
      tryRematch();
    },

    sendScare() {
      const btn = $("btn-scare");
      if (!active) return;
      Net.send({ type: "scare" });
      // brief flash so you know it fired — but unlimited uses
      btn.textContent = "👻 Sent!";
      setTimeout(() => { btn.textContent = "👻 Scare them"; }, 700);
    },


    abort() { Stroop.abort(); active = false; },
    get isActive() { return active; },
  };
})();
