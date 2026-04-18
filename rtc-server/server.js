require("dotenv").config({ path: require("path").join(__dirname, "../server/.env") });

const mediasoup = require("mediasoup");
const express = require("express");
const { WebSocketServer } = require("ws");
const logger = require("./logger");
const http = require("http");
const https = require("https");
const path = require("path");
const os = require("os");
const dns = require("dns");
const jwt = require("jsonwebtoken");
const url = require("url");

const JWT_SECRET = process.env.JWT_SECRET;

// --- Public IP auto-detection ---
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data.trim()));
    }).on("error", reject);
  });
}

function dnsLookup() {
  return new Promise((resolve, reject) => {
    const resolver = new dns.Resolver();
    resolver.setServers(["208.67.222.222"]); // OpenDNS
    resolver.resolve4("myip.opendns.com", (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses[0]);
    });
  });
}

async function detectPublicIp() {
  // 環境変数が明示されていればそれを使う
  const envIp = process.env.ANNOUNCED_IP || process.env.PUBLIC_IP;
  if (envIp) {
    logger.info(`Public IP (env): ${envIp}`);
    return envIp;
  }

  // 1. DNS で取得（最速・外部HTTP不要）
  try {
    const ip = await dnsLookup();
    logger.info(`Public IP (DNS): ${ip}`);
    return ip;
  } catch (e) {
    logger.warn("DNS lookup failed:", e.message);
  }

  // 2. HTTP API フォールバック
  const apis = [
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
  ];
  for (const url of apis) {
    try {
      const ip = await httpGet(url);
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        logger.info(`Public IP (${url}): ${ip}`);
        return ip;
      }
    } catch (e) {
      logger.warn(`${url} failed:`, e.message);
    }
  }

  logger.warn("Could not detect public IP — external connections may fail");
  return null;
}

// --- Auto-detect network interfaces ---
function getListenInfos(publicIp) {
  const listenInfos = [];
  const ifaces = os.networkInterfaces();

  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family !== "IPv4") continue;
      listenInfos.push({ protocol: "udp", ip: "0.0.0.0", announcedAddress: addr.address });
    }
  }

  // グローバル IP（自動検出 or 環境変数）
  if (publicIp) {
    listenInfos.push({ protocol: "udp", ip: "0.0.0.0", announcedAddress: publicIp });
    listenInfos.push({ protocol: "tcp", ip: "0.0.0.0", announcedAddress: publicIp });
  }

  // TCP fallback on loopback
  listenInfos.push({ protocol: "tcp", ip: "0.0.0.0", announcedAddress: "127.0.0.1" });

  console.log("Listen infos (auto-detected):");
  listenInfos.forEach((l) => logger.info(`  ${l.protocol.toUpperCase()} -> ${l.announcedAddress}`));

  return listenInfos;
}

// --- Config (listenInfos is set in main() after public IP detection) ---
const config = {
  listenPort: process.env.RTC_PORT || 3100,
  mediasoup: {
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: "warn",
    },
    router: {
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: { "x-google-start-bitrate": 1000 },
        },
      ],
    },
    webRtcTransport: {
      listenInfos: [], // populated in main()
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    },
  },
};

// --- State ---
let worker;
let router;
// rooms: roomId -> Map<peerId, { ws, transports, producers, consumers }>
const rooms = new Map();

// --- Mediasoup setup ---
async function startMediasoup() {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  worker.on("died", () => {
    logger.error("mediasoup Worker died, exiting...");
    process.exit(1);
  });
  router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs });
  console.log("mediasoup Router created");
}

// --- Transport helpers ---
async function createWebRtcTransport() {
  const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);

  transport.on("icestatechange", (iceState) => {
    logger.info(`  [transport ${transport.id.slice(0, 8)}] ICE: ${iceState}`);
  });
  transport.on("dtlsstatechange", (dtlsState) => {
    logger.info(`  [transport ${transport.id.slice(0, 8)}] DTLS: ${dtlsState}`);
  });
  transport.on("iceselectedtuplechange", (tuple) => {
    logger.info(`  [transport ${transport.id.slice(0, 8)}] selected: ${tuple.protocol.toUpperCase()} ${tuple.localAddress}:${tuple.localPort} <-> ${tuple.remoteIp}:${tuple.remotePort}`);
  });

  return transport;
}

// --- Room / Peer management ---
function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function createPeer(roomId, peerId, ws) {
  const room = getRoom(roomId);
  room.set(peerId, { ws, transports: {}, producers: {}, consumers: {} });
}

function removePeer(roomId, peerId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const peer = room.get(peerId);
  if (!peer) return;
  for (const transport of Object.values(peer.transports)) transport.close();
  room.delete(peerId);
  if (room.size === 0) rooms.delete(roomId);
}

function getRoomPeers(roomId) {
  return rooms.get(roomId) || new Map();
}

// --- JWT authentication for WebSocket ---
function authenticateWs(req) {
  const parsed = url.parse(req.url, true);
  const token = parsed.query.token;
  if (!token || !JWT_SECRET) {
    // 認証なし — クライアント側の peerId を使う
    return null;
  }
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    logger.warn("JWT verification failed:", e.message);
    return null;
  }
}

// --- WebSocket signaling ---
function handleWebSocket(ws, req) {
  // JWT 認証（token がなければ匿名モード — テスト用）
  const user = authenticateWs(req);
  let peerId = user?.id || null;
  let roomId = null;

  // keepalive
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("error", (err) => {
    logger.error(`[WS error] ${err.message}`);
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    logger.info(`[${peerId || "?"}] <- ${msg.type}`);
    try {
      switch (msg.type) {
        case "join": {
          peerId = peerId || msg.peerId;
          roomId = msg.roomId || "default";
          const existingRoom = getRoomPeers(roomId);
          const existingPeer = existingRoom.get(peerId);

          if (existingPeer) {
            // 再接続: 既存ピアの WebSocket を差し替え、タイマーをキャンセル
            logger.info(`Peer rejoined: ${peerId} -> room ${roomId}`);
            if (existingPeer.reconnectTimer) {
              clearTimeout(existingPeer.reconnectTimer);
              existingPeer.reconnectTimer = null;
            }
            existingPeer.ws = ws;
            send(ws, { type: "joined", routerRtpCapabilities: router.rtpCapabilities, rejoined: true });
          } else {
            // 新規参加
            createPeer(roomId, peerId, ws);
            logger.info(`Peer joined: ${peerId} -> room ${roomId}`);
            send(ws, { type: "joined", routerRtpCapabilities: router.rtpCapabilities });
          }
          break;
        }

        case "createTransport": {
          const transport = await createWebRtcTransport();
          const room = getRoomPeers(roomId);
          const peer = room.get(peerId);
          peer.transports[transport.id] = transport;

          send(ws, {
            type: "transportCreated",
            direction: msg.direction,
            params: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            },
          });
          break;
        }

        case "connectTransport": {
          const room = getRoomPeers(roomId);
          const peer = room.get(peerId);
          const transport = peer.transports[msg.transportId];
          await transport.connect({ dtlsParameters: msg.dtlsParameters });
          send(ws, { type: "transportConnected", transportId: msg.transportId });
          break;
        }

        case "produce": {
          const room = getRoomPeers(roomId);
          const peer = room.get(peerId);
          const transport = peer.transports[msg.transportId];
          const producer = await transport.produce({
            kind: msg.kind,
            rtpParameters: msg.rtpParameters,
          });
          peer.producers[producer.id] = producer;

          send(ws, { type: "produced", producerId: producer.id, kind: msg.kind });

          // Notify other peers in the same room
          for (const [otherId, otherPeer] of room) {
            if (otherId === peerId) continue;
            if (otherPeer.ws) {
              send(otherPeer.ws, {
                type: "newProducer",
                producerId: producer.id,
                producerPeerId: peerId,
                kind: producer.kind,
              });
            }
          }
          break;
        }

        case "consume": {
          const room = getRoomPeers(roomId);
          const peer = room.get(peerId);
          if (!router.canConsume({ producerId: msg.producerId, rtpCapabilities: msg.rtpCapabilities })) {
            send(ws, { type: "consumeFailed", producerId: msg.producerId });
            return;
          }

          const transport = peer.transports[msg.transportId];
          if (!transport) {
            send(ws, { type: "consumeFailed", producerId: msg.producerId });
            return;
          }

          const consumer = await transport.consume({
            producerId: msg.producerId,
            rtpCapabilities: msg.rtpCapabilities,
            paused: true,
          });
          peer.consumers[consumer.id] = consumer;

          send(ws, {
            type: "consumed",
            consumerId: consumer.id,
            producerId: msg.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });
          break;
        }

        case "resumeConsumer": {
          const room = getRoomPeers(roomId);
          const peer = room.get(peerId);
          const consumer = peer.consumers[msg.consumerId];
          if (consumer) await consumer.resume();
          break;
        }

        case "leave": {
          // 意図的な退出 — 即座にクリーンアップ（再接続待ちなし）
          logger.info(`Peer leaving: ${peerId} from room ${roomId}`);
          const room = getRoomPeers(roomId);
          for (const [otherId, otherPeer] of room) {
            if (otherId === peerId) continue;
            if (otherPeer.ws) send(otherPeer.ws, { type: "peerLeft", peerId });
          }
          removePeer(roomId, peerId);
          peerId = null;
          roomId = null;
          break;
        }

        case "getProducers": {
          const room = getRoomPeers(roomId);
          const producers = [];
          for (const [otherId, otherPeer] of room) {
            if (otherId === peerId) continue;
            for (const producer of Object.values(otherPeer.producers)) {
              producers.push({
                producerId: producer.id,
                producerPeerId: otherId,
                kind: producer.kind,
              });
            }
          }
          send(ws, { type: "producers", producers });
          break;
        }
      }
    } catch (err) {
      logger.error(`Error handling message type=${msg.type}:`, err);
    }
  });

  ws.on("close", () => {
    if (peerId && roomId) {
      const room = getRoomPeers(roomId);
      const peer = room.get(peerId);
      if (!peer) return;

      logger.info(`Peer disconnected: ${peerId} from room ${roomId} (waiting 15s for reconnect)`);
      // 15秒間は再接続を待つ（トランスポートは維持）
      peer.ws = null;
      peer.reconnectTimer = setTimeout(() => {
        logger.info(`Peer timeout: ${peerId} from room ${roomId} — removing`);
        for (const [otherId, otherPeer] of getRoomPeers(roomId)) {
          if (otherId === peerId) continue;
          if (otherPeer.ws) send(otherPeer.ws, { type: "peerLeft", peerId });
        }
        removePeer(roomId, peerId);
      }, 15000);
    }
  });

}

function send(ws, msg) {
  logger.info(`  -> ${msg.type}`);
  ws.send(JSON.stringify(msg));
}

// --- HTTP + WS Server ---
async function main() {
  // Public IP を自動検出してから mediasoup を起動
  const publicIp = await detectPublicIp();
  config.mediasoup.webRtcTransport.listenInfos = getListenInfos(publicIp);

  await startMediasoup();

  const app = express();
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.static(path.join(__dirname, "public")));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", handleWebSocket);

  // WebSocket keepalive — プロキシのアイドルタイムアウトを防ぐ
  const PING_INTERVAL = 30000; // 30秒
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log("[keepalive] terminating dead connection");
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, PING_INTERVAL);

  server.listen(config.listenPort, () => {
    logger.info(`Server running at http://localhost:${config.listenPort}`);
  });
}

main();
