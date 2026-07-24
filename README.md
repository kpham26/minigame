# Stroop Duel

1v1 Stroop test over the internet. No server, no accounts — just a room code.

Built with vanilla HTML/CSS/JS + [PeerJS](https://peerjs.com) (WebRTC peer-to-peer).

## How to play

1. Player 1 opens the site, picks settings, clicks **Create room**, and gets a 6-character code.
2. Player 2 opens the same site, clicks **Join room**, enters the code.
3. Host clicks **Start match**. Both players get the **identical** sequence of words and colors (seeded randomness), so it's a fair race.
4. Click the **ink color**, not the word. Correct **+10**, wrong **−5**.
5. Higher score takes the round. First to N rounds wins. Rematch anytime.

## Deploy to GitHub Pages

1. Create a **public** repo and upload these files (`index.html` must be at the repo root).
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
3. Wait 1–5 minutes. Your game is live at `https://<username>.github.io/<repo>/`.
4. After future updates, hard-refresh with **Ctrl+Shift+R** (both players!).

## Run locally

```
python -m http.server 8000
```

Open http://localhost:8000 in a normal tab (create) and an incognito tab (join) to play against yourself.

## Notes

- Multiplayer is browser-to-browser (WebRTC). GitHub Pages only serves the files; PeerJS's free public server handles the initial handshake.
- Rooms are 1v1 only — a third person trying to join is rejected.
- Very strict firewalls (some corporate networks) can block WebRTC; home wifi is fine.
