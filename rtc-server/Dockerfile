# Tealus rtc-server (#188 Phase A optional)
#
# mediasoup SFU を Docker 化。通話 / PTT / aivis-cloud TTS の transceiver
# gateway broadcast (TTS_BROADCAST_MEDIASOUP=true 時) を担う。
#
# 注意:
#   - **Linux ホスト限定** (network_mode: host が必要、docker-compose.rtc.yml 参照)
#   - alpine ではなく bookworm-slim (glibc) を使用
#     mediasoup の prebuilt native worker は musl で動かないため
#   - UDP ポート範囲 (default 40000-49999) を host で開放する必要あり
#   - NAT 越え時は ANNOUNCED_IP / PUBLIC_IP の設定要 (rtc-server/.env.example 参照)
#
# build 方法 (project root から):
#   docker build -f rtc-server/Dockerfile -t tealus-rtc-server .

# --- Stage 1: builder ---
# mediasoup-worker (C++) を local build するため build-essential 等が必要。
# prebuilt が落ちてくれば軽いが、buildkit の kernel 検出がミスマッチで
# 多くは local build に fallback する。
FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
    build-essential \
    && ln -s /usr/bin/python3 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/*

COPY rtc-server/package*.json ./rtc-server/
RUN cd rtc-server && npm ci --omit=dev

COPY rtc-server/ ./rtc-server/

# Client bundle を build (esbuild)
RUN cd rtc-server && npx esbuild src/client.js \
    --bundle \
    --outfile=public/bundle.js \
    --format=iife \
    --platform=browser

# --- Stage 2: runtime ---
# build-essential / python 等は不要、軽量化
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# builder から node_modules + source 一式を持ってくる
COPY --from=builder /app/rtc-server /app/rtc-server

WORKDIR /app/rtc-server
EXPOSE 3100

CMD ["node", "server.js"]
