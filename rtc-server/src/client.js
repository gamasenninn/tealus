import { Device } from "mediasoup-client";

// --- URL params ---
const params = new URLSearchParams(location.search);
const paramRoom = params.get("room");
const paramToken = params.get("token");
const autoConnect = !!(paramRoom && paramToken);

// --- State ---
let ws;
let device;
let sendTransport;
let recvTransport;
let localStream;
const peerId = "peer-" + Math.random().toString(36).slice(2, 8);

// --- DOM ---
const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connectBtn");
const callControls = document.getElementById("callControls");
const muteBtn = document.getElementById("muteBtn");
const endCallBtn = document.getElementById("endCallBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
let isMuted = false;

function setStatus(text) {
  statusEl.textContent = text;
  console.log("[status]", text);
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

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsPath = location.pathname.startsWith("/rtc") ? "/rtc/ws" : "/ws";
    const tokenQuery = paramToken ? `?token=${encodeURIComponent(paramToken)}` : "";
    ws = new WebSocket(`${protocol}//${location.host}${wsPath}${tokenQuery}`);
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
    ws.onclose = () => setStatus("切断されました");
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

function send(msg) {
  console.log("[send]", msg.type);
  ws.send(JSON.stringify(msg));
}

// --- Consume queue (serialize concurrent newProducer events) ---
const consumeQueue = [];
let consuming = false;

async function enqueueConsume(producerId) {
  consumeQueue.push(producerId);
  if (consuming) return;
  consuming = true;
  while (consumeQueue.length > 0) {
    const id = consumeQueue.shift();
    await consumeProducer(id);
  }
  consuming = false;
}

// --- Disconnect ---
function disconnect() {
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
  remoteVideo.srcObject = null;
  messageHandlers.length = 0;
  if (connectBtn) {
    connectBtn.textContent = "接続する";
    connectBtn.classList.remove("connected");
  }
  if (callControls) callControls.classList.remove("visible");
  isMuted = false;
  if (muteBtn) { muteBtn.textContent = "🎤"; muteBtn.classList.remove("active"); }
  setStatus("切断しました");
  // 自動接続モードでは切断時に開いた元ウィンドウに通知
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
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    setStatus("サーバーに接続中...");
    await connectWebSocket();

    // Register persistent message handlers (never removed)
    onServerMessage((msg) => {
      if (msg.type === "newProducer") {
        enqueueConsume(msg.producerId);
        return true;
      }
      if (msg.type === "peerLeft") {
        remoteVideo.srcObject = null;
        setStatus("相手が退出しました");
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

    // Create send transport
    await createSendTransport();

    // Create recv transport
    await createRecvTransport();

    // Produce audio & video
    await startProducing();

    // Consume existing producers from other peers
    send({ type: "getProducers" });
    const prodResp = await waitForMessage((m) => m.type === "producers");
    for (const p of prodResp.producers) {
      await consumeProducer(p.producerId);
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

// --- Consuming ---
async function consumeProducer(producerId) {
  setStatus("相手のメディアを受信中...");
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
  console.log("[consume] kind=%s track.readyState=%s track.muted=%s track.enabled=%s",
    resp.kind, track.readyState, track.muted, track.enabled);
  console.log("[consume] recvTransport.connectionState=%s", recvTransport.connectionState);

  if (!remoteVideo.srcObject) {
    remoteVideo.srcObject = new MediaStream();
  }
  remoteVideo.srcObject.addTrack(track);

  // Resume on both server and client side
  send({ type: "resumeConsumer", consumerId: resp.consumerId });
  await consumer.resume();

  // Ensure playback starts
  try {
    await remoteVideo.play();
  } catch (e) {
    console.warn("[play] autoplay blocked:", e.message);
  }

  console.log("[consume] remoteVideo tracks:", remoteVideo.srcObject.getTracks().map(
    t => `${t.kind}:${t.readyState}:muted=${t.muted}`
  ));
  setStatus("通話中");
}

// --- Call control buttons ---
muteBtn?.addEventListener("click", () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  muteBtn.textContent = isMuted ? "🔇" : "🎤";
  muteBtn.classList.toggle("active", isMuted);
});

const fullscreenBtn = document.getElementById("fullscreenBtn");
fullscreenBtn?.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

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
