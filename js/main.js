/* ============================================================
   main.js — screens, lobby, settings UI, wiring it all together
   ============================================================ */
const UI = (() => {
  const $ = (id) => document.getElementById(id);

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(id).classList.add("active");
  }

  function settingsLabel(s) {
    const trap = { "0.5": "Chill (50%)", "0.75": "Classic (75%)", "0.9": "Evil (90%)" }[String(s.trapRate)];
    return [
      ["Colors", s.colors],
      ["Round length", s.duration + "s"],
      ["First to", s.winsNeeded + (s.winsNeeded === 1 ? " win" : " wins")],
      ["Trap rate", trap],
      ["Scoring", "+10 / −5"],
    ];
  }

  function renderSettingsList(s) {
    $("settings-list").innerHTML = settingsLabel(s)
      .map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`)
      .join("");
  }

  /* room code shown as Stroop-style colored letters */
  function renderRoomCode(code) {
    const colorClasses = ["c-red", "c-blue", "c-green", "c-yellow", "c-purple", "c-cyan"];
    $("room-code-box").innerHTML = code
      .split("")
      .map((ch, i) => `<span class="${colorClasses[i % colorClasses.length]}">${ch}</span>`)
      .join("");
    $("room-code-box").dataset.code = code;
  }

  return {
    showScreen,
    renderSettingsList,
    renderRoomCode,
    showRoomAsJoiner(settings, hostName) {
      $("room-title").textContent = hostName ? `Joined ${hostName}'s room` : "Joined room";
      $("room-status").textContent = "Connected!";
      $("room-status").classList.add("ok");
      renderSettingsList(settings);
      $("btn-start").hidden = true;
      $("waiting-host").hidden = false;
      showScreen("screen-room");
    },
  };
})();

(() => {
  const $ = (id) => document.getElementById(id);

  /* ---------- settings segmented controls ---------- */
  const chosen = { colors: 4, duration: 30, winsNeeded: 3, trapRate: 0.75 };

  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      seg.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
      btn.classList.add("on");
      const key = seg.dataset.setting;
      chosen[key] = parseFloat(btn.dataset.val);
    });
  });

  function myName() {
    return ($("player-name").value.trim() || "Player").slice(0, 14);
  }

  /* ---------- network events ---------- */
  Net.on("message", (msg) => Match.onMessage(msg));

  Net.on("connected", () => {
    Match.setMyName(myName());
    if (Net.isHost) {
      $("room-status").textContent = "Friend connected!";
      $("room-status").classList.add("ok");
      $("btn-start").hidden = false;
      Match.hostHello({ ...chosen }, myName());
    }
  });

  Net.on("disconnected", () => {
    Match.abort();
    $("overlay-round").hidden = true;
    $("overlay-end").hidden = true;
    $("overlay-dc").hidden = false;
  });

  Net.on("error", (err) => {
    const el = $("join-error");
    el.hidden = false;
    if (err.type === "not-found") el.textContent = "Room not found — check the code.";
    else if (err.type === "timeout" || err.type === "connect-failed") el.textContent = "Couldn't connect. Both check your internet and try again.";
    else el.textContent = "Connection error. Refresh and try again.";
    $("btn-join").disabled = false;
    $("btn-create").disabled = false;
  });

  /* ---------- lobby buttons ---------- */
  $("btn-create").addEventListener("click", () => {
    $("btn-create").disabled = true;
    Net.createRoom((code) => {
      $("btn-create").disabled = false;
      $("room-title").textContent = "Room created";
      $("room-status").textContent = "Waiting for your friend to join…";
      $("room-status").classList.remove("ok");
      $("btn-start").hidden = true;
      $("waiting-host").hidden = true;
      UI.renderRoomCode(code);
      UI.renderSettingsList(chosen);
      UI.showScreen("screen-room");
    });
  });

  $("btn-join").addEventListener("click", () => {
    const code = $("join-code").value.trim().toUpperCase();
    $("join-error").hidden = true;
    if (code.length !== 6) {
      $("join-error").hidden = false;
      $("join-error").textContent = "Codes are 6 characters.";
      return;
    }
    $("btn-join").disabled = true;
    // show the code while connecting
    $("room-title").textContent = "Joining…";
    UI.renderRoomCode(code);
    Net.joinRoom(code);
  });

  $("join-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btn-join").click();
  });
  $("join-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  /* copy room code on click */
  $("room-code-box").addEventListener("click", () => {
    const code = $("room-code-box").dataset.code || "";
    if (navigator.clipboard && code) {
      navigator.clipboard.writeText(code);
      const s = $("room-status");
      const prev = s.textContent;
      s.textContent = "Code copied!";
      setTimeout(() => (s.textContent = prev), 1200);
    }
  });

  /* ---------- room buttons ---------- */
  $("btn-start").addEventListener("click", () => {
    Match.hostStart({ ...chosen });
  });

  $("btn-leave").addEventListener("click", () => {
    Net.leave();
    location.reload();
  });

  /* ---------- end / disconnect buttons ---------- */
  $("btn-rematch").addEventListener("click", () => Match.requestRematch());
  $("btn-exit").addEventListener("click", () => { Net.leave(); location.reload(); });
  $("btn-dc-exit").addEventListener("click", () => { Net.leave(); location.reload(); });
})();
