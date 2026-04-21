import { Device } from "mediasoup-client";

// --- URL params ---
const params = new URLSearchParams(location.search);
const paramRoom = params.get("room");
const paramToken = params.get("token");
const paramVideo = params.get("video") !== "false";
const paramAudio = params.get("audio") !== "false";
const autoConnect = !!(paramRoom && paramToken);

// --- State ---
let ws;
let device;
let sendTransport;
let recvTransport;
let localStream;
const peerId = "peer-" + Math.random().toString(36).slice(2, 8);

// リモートピア管理: peerId -> { stream, element, video, producers: Set }
const remotePeers = new Map();

// --- DOM ---
const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connectBtn");
const callControls = document.getElementById("callControls");
const muteBtn = document.getElementById("muteBtn");
const videoMuteBtn = document.getElementById("videoMuteBtn");
const endCallBtn = document.getElementById("endCallBtn");
const videoGrid = document.getElementById("videoGrid");
const localBox = document.getElementById("localBox");
const localVideo = document.getElementById("localVideo");
let isMuted = false;
let isVideoOff = false;
let expandedPeerId = null; // タップ拡大中のピア
let isLocalSwapped = false; // PiP スワップ中

function setStatus(text) {
  statusEl.textContent = text;
  console.log("[status]", text);
}

// --- Remote peer video management ---
function getOrCreatePeerElement(peerIdRemote) {
  if (remotePeers.has(peerIdRemote)) return remotePeers.get(peerIdRemote);

  const item = document.createElement("div");
  item.className = "video-grid-item";
  item.setAttribute("data-peer-id", peerIdRemote);

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  item.appendChild(video);

  const label = document.createElement("div");
  label.className = "video-grid-label";
  label.textContent = peerIdRemote.slice(0, 8);
  item.appendChild(label);

  // タップで拡大/縮小
  item.addEventListener("click", () => {
    if (expandedPeerId === peerIdRemote) {
      // 拡大中 → 元に戻す
      item.classList.remove("expanded");
      expandedPeerId = null;
    } else {
      // 他を縮小して自分を拡大
      if (expandedPeerId) {
        const prev = videoGrid.querySelector(".expanded");
        if (prev) prev.classList.remove("expanded");
      }
      item.classList.add("expanded");
      expandedPeerId = peerIdRemote;
    }
  });

  videoGrid.appendChild(item);

  const stream = new MediaStream();
  video.srcObject = stream;

  const peerData = { stream, element: item, video, producers: new Set() };
  remotePeers.set(peerIdRemote, peerData);

  updateGridLayout();
  return peerData;
}

function removePeerElement(peerIdRemote) {
  const peer = remotePeers.get(peerIdRemote);
  if (!peer) return;
  if (expandedPeerId === peerIdRemote) expandedPeerId = null;
  peer.element.remove();
  remotePeers.delete(peerIdRemote);
  updateGridLayout();
}

function removeAllPeerElements() {
  for (const [, peer] of remotePeers) {
    peer.element.remove();
  }
  remotePeers.clear();
  expandedPeerId = null;
  updateGridLayout();
}

function updateGridLayout() {
  const count = remotePeers.size;
  videoGrid.classList.remove("cols-2", "cols-3");
  if (count >= 5) {
    videoGrid.classList.add("cols-3");
  } else if (count >= 2) {
    videoGrid.classList.add("cols-2");
  }
  // count 0-1: 1列（1人が全面表示 or 空）
}

// --- WebSocket with request/response support ---
const messageHandlers = [];

function onServerMessage(handler) {
  messageHandlers.push(handler);
}

function waitForMessage(predicate) {
  return new Promise((resolve) => {
    const handler = (msg) => {
      if (predicate(msg)) {
        const idx = messageHandlers.indexOf(handler);
        if (idx >= 0) messageHandlers.splice(idx, 1);
        resolve(msg);
        return true;
      }
      return false;
    };
    messageHandlers.push(handler);
  });
}

let intentionalClose = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

function getWsUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsPath = location.pathname.startsWith("/rtc") ? "/rtc/ws" : "/ws";
  const tokenQuery = paramToken ? `?token=${encodeURIComponent(paramToken)}` : "";
  return `${protocol}//${location.host}${wsPath}${tokenQuery}`;
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    intentionalClose = false;
    ws = new WebSocket(getWsUrl());
    ws.onopen = () => {
      reconnectAttempts = 0;
      resolve();
    };
    ws.onerror = (e) => reject(e);
    ws.onclose = () => {
      if (intentionalClose || !connected) {
        setStatus("切断されました");
        return;
      }
      attemptReconnect();
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      console.log("[recv]", msg.type, msg);
      for (let i = messageHandlers.length - 1; i >= 0; i--) {
        if (messageHandlers[i](msg)) return;
      }
      console.warn("[unhandled]", msg.type);
    };
  });
}

function attemptReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    setStatus("再接続に失敗しました");
    connected = false;
    disconnect();
    return;
  }
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 8000);
  setStatus(`再接続中... (${reconnectAttempts}/${MAX_RECONNECT})`);
  console.log(`[reconnect] attempt ${reconnectAttempts} in ${delay}ms`);

  setTimeout(() => {
    if (!connected || intentionalClose) return;
    const newWs = new WebSocket(getWsUrl());
    newWs.onopen = () => {
      console.log("[reconnect] connected, rejoining...");
      ws = newWs;
      reconnectAttempts = 0;
      ws.onclose = () => {
        if (intentionalClose || !connected) return;
        attemptReconnect();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        console.log("[recv]", msg.type, msg);
        for (let i = messageHandlers.length - 1; i >= 0; i--) {
          if (messageHandlers[i](msg)) return;
        }
      };
      send({ type: "join", peerId, roomId: paramRoom || "default" });
      waitForMessage((m) => m.type === "joined").then(() => {
        setStatus("再接続しました");
        send({ type: "getProducers" });
        waitForMessage((m) => m.type === "producers").then((resp) => {
          for (const p of resp.producers) {
            enqueueConsume(p.producerId, p.producerPeerId);
          }
          setStatus("通話中");
        });
      });
    };
    newWs.onerror = () => {
      console.log("[reconnect] failed");
      attemptReconnect();
    };
  }, delay);
}

function send(msg) {
  console.log("[send]", msg.type);
  ws.send(JSON.stringify(msg));
}

// --- Consume queue (serialize concurrent newProducer events) ---
const consumeQueue = [];
let consuming = false;

async function enqueueConsume(producerId, producerPeerId) {
  consumeQueue.push({ producerId, producerPeerId });
  if (consuming) return;
  consuming = true;
  while (consumeQueue.length > 0) {
    const { producerId: pid, producerPeerId: ppid } = consumeQueue.shift();
    await consumeProducer(pid, ppid);
  }
  consuming = false;
}

// --- Disconnect ---
function disconnect() {
  intentionalClose = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { send({ type: "leave" }); } catch (e) {}
  }
  if (sendTransport) { sendTransport.close(); sendTransport = null; }
  if (recvTransport) { recvTransport.close(); recvTransport = null; }
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  ws = null;
  device = null;
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  removeAllPeerElements();
  messageHandlers.length = 0;
  if (connectBtn) {
    connectBtn.textContent = "接続する";
    connectBtn.classList.remove("connected");
  }
  if (callControls) callControls.classList.remove("visible");
  isMuted = false;
  isVideoOff = false;
  isLocalSwapped = false;
  if (muteBtn) { muteBtn.textContent = "🎤"; muteBtn.classList.remove("active"); }
  if (videoMuteBtn) { videoMuteBtn.textContent = "📷"; videoMuteBtn.classList.remove("active"); }
  if (localBox) localBox.classList.remove("swapped");
  setStatus("切断しました");
  if (autoConnect && window.opener) {
    window.opener.postMessage({ type: "call:ended" }, "*");
  }
}

// --- Main flow ---
let connected = false;

connectBtn.addEventListener("click", async () => {
  if (connected) {
    connected = false;
    disconnect();
    return;
  }

  connectBtn.disabled = true;
  try {
    setStatus("カメラ・マイクを取得中...");
    // video/audio は URL パラメータで制御（確認ダイアログで選択）
    localStream = await navigator.mediaDevices.getUserMedia({ video: paramVideo, audio: paramAudio });
    localVideo.srcObject = localStream;

    setStatus("サーバーに接続中...");
    await connectWebSocket();

    // Register persistent message handlers
    onServerMessage((msg) => {
      if (msg.type === "newProducer") {
        enqueueConsume(msg.producerId, msg.producerPeerId);
        return true;
      }
      if (msg.type === "peerLeft") {
        removePeerElement(msg.peerId);
        if (remotePeers.size === 0) {
          setStatus("接続完了 — 相手の参加を待っています...");
        } else {
          setStatus(`通話中（${remotePeers.size + 1}人）`);
        }
        return true;
      }
      return false;
    });

    // Join room
    send({ type: "join", peerId, roomId: paramRoom || "default" });
    const joinResp = await waitForMessage((m) => m.type === "joined");

    // Init device
    setStatus("デバイスを初期化中...");
    device = new Device();
    await device.load({ routerRtpCapabilities: joinResp.routerRtpCapabilities });

    await createSendTransport();
    await createRecvTransport();
    await startProducing();

    // Consume existing producers from other peers
    send({ type: "getProducers" });
    const prodResp = await waitForMessage((m) => m.type === "producers");
    for (const p of prodResp.producers) {
      await consumeProducer(p.producerId, p.producerPeerId);
    }

    connected = true;
    connectBtn.textContent = "切断する";
    connectBtn.classList.add("connected");
    connectBtn.disabled = false;
    callControls.classList.add("visible");

    if (prodResp.producers.length === 0) {
      setStatus("接続完了 — 相手の参加を待っています...");
    }
  } catch (err) {
    console.error(err);
    setStatus("エラー: " + err.message);
    connected = false;
    disconnect();
  }
});

// --- Transport setup ---
async function createSendTransport() {
  setStatus("送信トランスポートを作成中...");
  send({ type: "createTransport", direction: "send" });
  const resp = await waitForMessage((m) => m.type === "transportCreated" && m.direction === "send");

  sendTransport = device.createSendTransport(resp.params);

  sendTransport.on("connectionstatechange", (state) => {
    console.log("[sendTransport] connectionState:", state);
  });

  sendTransport.on("icegatheringstatechange", (state) => {
    console.log("[sendTransport] iceGatheringState:", state);
  });

  sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    send({ type: "connectTransport", transportId: sendTransport.id, dtlsParameters });
    waitForMessage((m) => m.type === "transportConnected" && m.transportId === sendTransport.id)
      .then(() => callback())
      .catch(errback);
  });

  sendTransport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
    send({ type: "produce", transportId: sendTransport.id, kind, rtpParameters });
    waitForMessage((m) => m.type === "produced")
      .then((m) => callback({ id: m.producerId }))
      .catch(errback);
  });
}

async function createRecvTransport() {
  setStatus("受信トランスポートを作成中...");
  send({ type: "createTransport", direction: "recv" });
  const resp = await waitForMessage((m) => m.type === "transportCreated" && m.direction === "recv");

  recvTransport = device.createRecvTransport(resp.params);

  recvTransport.on("connectionstatechange", (state) => {
    console.log("[recvTransport] connectionState:", state);
  });

  recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    send({ type: "connectTransport", transportId: recvTransport.id, dtlsParameters });
    waitForMessage((m) => m.type === "transportConnected" && m.transportId === recvTransport.id)
      .then(() => callback())
      .catch(errback);
  });
}

// --- Producing ---
async function startProducing() {
  setStatus("メディアを送信中...");
  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];

  if (audioTrack) await sendTransport.produce({ track: audioTrack });
  if (videoTrack) await sendTransport.produce({ track: videoTrack });
}

// --- Consuming (per-peer) ---
async function consumeProducer(producerId, producerPeerId) {
  setStatus("メディアを受信中...");
  send({
    type: "consume",
    producerId,
    transportId: recvTransport.id,
    rtpCapabilities: device.rtpCapabilities,
  });

  const resp = await waitForMessage((m) => m.type === "consumed" && m.producerId === producerId);

  const consumer = await recvTransport.consume({
    id: resp.consumerId,
    producerId: resp.producerId,
    kind: resp.kind,
    rtpParameters: resp.rtpParameters,
  });

  const { track } = consumer;
  console.log("[consume] peer=%s kind=%s", producerPeerId, resp.kind);

  const peerData = getOrCreatePeerElement(producerPeerId);
  peerData.stream.addTrack(track);
  peerData.producers.add(producerId);

  send({ type: "resumeConsumer", consumerId: resp.consumerId });
  await consumer.resume();

  try {
    await peerData.video.play();
  } catch (e) {
    console.warn("[play] autoplay blocked:", e.message);
  }

  setStatus(`通話中（${remotePeers.size + 1}人）`);
}

// --- Call control buttons ---

// 音声ミュート
muteBtn?.addEventListener("click", () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  muteBtn.textContent = isMuted ? "🔇" : "🎤";
  muteBtn.classList.toggle("active", isMuted);
});

// ビデオミュート
videoMuteBtn?.addEventListener("click", () => {
  if (!localStream) return;
  isVideoOff = !isVideoOff;
  localStream.getVideoTracks().forEach((t) => (t.enabled = !isVideoOff));
  videoMuteBtn.textContent = isVideoOff ? "🚫" : "📷";
  videoMuteBtn.classList.toggle("active", isVideoOff);
});

// PiP タップでスワップ（自分を全面表示、グリッドを非表示）
localBox?.addEventListener("click", () => {
  if (!connected || remotePeers.size === 0) return;
  isLocalSwapped = !isLocalSwapped;
  localBox.classList.toggle("swapped", isLocalSwapped);
  videoGrid.classList.toggle("hidden", isLocalSwapped);
});

// 切断
endCallBtn?.addEventListener("click", () => {
  connected = false;
  disconnect();
  if (autoConnect) window.close();
});

// --- Auto-connect mode (from Tealus) ---
if (autoConnect) {
  if (connectBtn) connectBtn.style.display = "none";
  connectBtn?.click();
}
