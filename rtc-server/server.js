const mediasoup = require("mediasoup");
const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const path = require("path");
const os = require("os");

// --- Auto-detect network interfaces ---
function getListenInfos() {
  const listenInfos = [];
  const ifaces = os.networkInterfaces();

  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family !== "IPv4") continue;
      // UDP for all IPv4 addresses (loopback + real interfaces)
      listenInfos.push({ protocol: "udp", ip: "0.0.0.0", announcedAddress: addr.address });
    }
  }
  // グローバル IP（環境変数で指定、外部接続に必要）
  const publicIp = process.env.ANNOUNCED_IP || process.env.PUBLIC_IP;
  if (publicIp) {
    listenInfos.push({ protocol: "udp", ip: "0.0.0.0", announcedAddress: publicIp });
    listenInfos.push({ protocol: "tcp", ip: "0.0.0.0", announcedAddress: publicIp });
  }

  // TCP fallback on loopback
  listenInfos.push({ protocol: "tcp", ip: "0.0.0.0", announcedAddress: "127.0.0.1" });

  console.log("Listen infos (auto-detected):");
  listenInfos.forEach((l) => console.log(`  ${l.protocol.toUpperCase()} -> ${l.announcedAddress}`));

  return listenInfos;
}

// --- Config ---
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
      listenInfos: getListenInfos(),
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    },
  },
};

// --- State ---
let worker;
let router;
const peers = new Map(); // peerId -> { transports: {}, producers: {}, consumers: {} }

// --- Mediasoup setup ---
async function startMediasoup() {
  worker = await mediasoup.createWorker(config.mediasoup.worker);
  worker.on("died", () => {
    console.error("mediasoup Worker died, exiting...");
    process.exit(1);
  });
  router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs });
  console.log("mediasoup Router created");
}

// --- Transport helpers ---
async function createWebRtcTransport() {
  const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);

  transport.on("icestatechange", (iceState) => {
    console.log(`  [transport ${transport.id.slice(0, 8)}] ICE: ${iceState}`);
  });
  transport.on("dtlsstatechange", (dtlsState) => {
    console.log(`  [transport ${transport.id.slice(0, 8)}] DTLS: ${dtlsState}`);
  });
  transport.on("iceselectedtuplechange", (tuple) => {
    console.log(`  [transport ${transport.id.slice(0, 8)}] selected: ${tuple.protocol.toUpperCase()} ${tuple.localAddress}:${tuple.localPort} <-> ${tuple.remoteIp}:${tuple.remotePort}`);
  });

  return transport;
}

// --- Peer management ---
function createPeer(peerId, ws) {
  peers.set(peerId, { ws, transports: {}, producers: {}, consumers: {} });
}

function removePeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer) return;
  for (const transport of Object.values(peer.transports)) transport.close();
  peers.delete(peerId);
}

function getOtherPeers(peerId) {
  return [...peers.keys()].filter((id) => id !== peerId);
}

// --- WebSocket signaling ---
function handleWebSocket(ws) {
  let peerId = null;

  ws.on("error", (err) => {
    console.error(`[WS error] ${err.message}`);
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    console.log(`[${peerId || "?"}] <- ${msg.type}`);
    try {
      switch (msg.type) {
        case "join": {
          peerId = msg.peerId;
          createPeer(peerId, ws);
          console.log(`Peer joined: ${peerId}`);
          send(ws, { type: "joined", routerRtpCapabilities: router.rtpCapabilities });
          break;
        }

        case "createTransport": {
          const transport = await createWebRtcTransport();
          const peer = peers.get(peerId);
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
          const peer = peers.get(peerId);
          const transport = peer.transports[msg.transportId];
          await transport.connect({ dtlsParameters: msg.dtlsParameters });
          send(ws, { type: "transportConnected", transportId: msg.transportId });
          break;
        }

        case "produce": {
          const peer = peers.get(peerId);
          const transport = peer.transports[msg.transportId];
          const producer = await transport.produce({
            kind: msg.kind,
            rtpParameters: msg.rtpParameters,
          });
          peer.producers[producer.id] = producer;

          send(ws, { type: "produced", producerId: producer.id, kind: msg.kind });

          // Notify other peers that a new producer is available
          for (const [otherId, otherPeer] of peers) {
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
          const peer = peers.get(peerId);
          if (!router.canConsume({ producerId: msg.producerId, rtpCapabilities: msg.rtpCapabilities })) {
            send(ws, { type: "consumeFailed", producerId: msg.producerId });
            return;
          }

          const recvTransport = Object.values(peer.transports).find(
            (t) => t.appData?.direction === "recv" || t.direction === "recv"
          );
          // Use the transportId sent by client, or find a recv transport
          const transport = peer.transports[msg.transportId] || recvTransport;
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
          const peer = peers.get(peerId);
          const consumer = peer.consumers[msg.consumerId];
          if (consumer) await consumer.resume();
          break;
        }

        case "getProducers": {
          // Return all producers from other peers
          const producers = [];
          for (const [otherId, otherPeer] of peers) {
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
      console.error(`Error handling message type=${msg.type}:`, err);
    }
  });

  ws.on("close", () => {
    if (peerId) {
      console.log(`Peer left: ${peerId}`);
      // Notify others
      for (const [otherId, otherPeer] of peers) {
        if (otherId === peerId) continue;
        if (otherPeer.ws) {
          send(otherPeer.ws, { type: "peerLeft", peerId });
        }
      }
      removePeer(peerId);
    }
  });

}

function send(ws, msg) {
  console.log(`  -> ${msg.type}`);
  ws.send(JSON.stringify(msg));
}

// --- HTTP + WS Server ---
async function main() {
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

  server.listen(config.listenPort, () => {
    console.log(`Server running at http://localhost:${config.listenPort}`);
  });
}

main();
