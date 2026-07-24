/* ============================================================
   network.js — all PeerJS logic (create / join / send / receive)
   Room codes are 6 chars; the actual peer ID is "sduel-" + code.
   ============================================================ */
const Net = (() => {
  const PREFIX = "sduel-";
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusing 0/O/1/I/L

  /* ICE servers: STUN finds your public address; TURN relays traffic when a
     direct peer-to-peer connection is impossible (strict NAT, mobile data,
     some ISPs). Without TURN, cross-country connections often fail. */
  const PEER_OPTS = {
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    },
  };

  let peer = null;
  let conn = null;
  let handlers = { message: () => {}, connected: () => {}, disconnected: () => {}, error: () => {} };
  let isHost = false;

  function randomCode() {
    let c = "";
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return c;
  }

  function wireConnection(c) {
    conn = c;
    conn.on("data", (msg) => handlers.message(msg));
    conn.on("close", () => handlers.disconnected());
    conn.on("error", () => handlers.disconnected());
  }

  return {
    on(event, fn) { handlers[event] = fn; },
    get isHost() { return isHost; },
    get connected() { return !!(conn && conn.open); },

    /* Host: create a room. onCode(code) fires when the ID is registered. */
    createRoom(onCode) {
      isHost = true;
      const code = randomCode();
      peer = new Peer(PREFIX + code, PEER_OPTS);
      peer.on("open", () => onCode(code));
      peer.on("connection", (c) => {
        if (conn && conn.open) { c.close(); return; } // room is full (1v1 only)
        c.on("open", () => { wireConnection(c); handlers.connected(); });
      });
      peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          // rare code collision — try again with a fresh code
          peer.destroy();
          Net.createRoom(onCode);
        } else {
          handlers.error(err);
        }
      });
    },

    /* Joiner: connect to a host's code. */
    joinRoom(code) {
      isHost = false;
      peer = new Peer(PEER_OPTS);
      peer.on("open", () => {
        const c = peer.connect(PREFIX + code.toUpperCase().trim(), { reliable: true });
        let opened = false;
        c.on("open", () => { opened = true; wireConnection(c); handlers.connected(); });
        c.on("error", () => handlers.error({ type: "connect-failed" }));
        setTimeout(() => { if (!opened) handlers.error({ type: "timeout" }); }, 15000);
      });
      peer.on("error", (err) => {
        if (err.type === "peer-unavailable") handlers.error({ type: "not-found" });
        else handlers.error(err);
      });
    },

    send(msg) { if (conn && conn.open) conn.send(msg); },

    leave() {
      try { if (conn) conn.close(); } catch (e) {}
      try { if (peer) peer.destroy(); } catch (e) {}
      conn = null; peer = null; isHost = false;
    },
  };
})();
