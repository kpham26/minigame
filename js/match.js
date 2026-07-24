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
  /* Plays ONE video: assets/scare.mp4 — its own audio, its own duration.
     Cache-busted on every load so replaced files show up immediately. */
  const SCARE_VIDEO = "assets/scare.mp4";
  const BUST = "?v=" + Date.now();
  let scareReady = false;

  (function preloadScareVideo() {
    const v = document.getElementById("scare-video");
    if (!v) return;
    v.src = SCARE_VIDEO + BUST;
    v.load();
    v.oncanplaythrough = () => { scareReady = true; };
    v.onerror = () => {
      scareReady = false;
      console.warn("Stroop Duel: assets/scare.mp4 not found or failed to load.");
    };
  })();

  let scareEndTimer = null;

  function endScare() {
    clearTimeout(scareEndTimer);
    const v = $("scare-video");
    $("scare-overlay").hidden = true;
    document.body.classList.remove("shaking");
    if (v) { v.pause(); v.currentTime = 0; }
  }

  function playScare() {
    const ov = $("scare-overlay");
    const v = $("scare-video");
    if (!v) return;

    ov.hidden = false;
    document.body.classList.remove("shaking");
    void document.body.offsetWidth;
    document.body.classList.add("shaking");

    clearTimeout(scareEndTimer);

    v.currentTime = 0;
    v.muted = false;
    v.volume = 1.0;
    v.onended = endScare; // overlay lasts exactly as long as the video

    v.play().then(() => {
      // safety net in case 'ended' never fires
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 + 500 : 30000;
      scareEndTimer = setTimeout(endScare, dur);
    }).catch(() => {
      // sound blocked by the browser — replay muted so the visual still lands
      v.muted = true;
      v.play().catch(() => {});
      scareEndTimer = setTimeout(endScare, 3000);
    });
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
