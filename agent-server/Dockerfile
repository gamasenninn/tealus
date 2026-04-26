# Tealus agent-server (#188 Phase A)
#
# Single-stage build。client / dashboard のような静的 build はないので
# 軽量な構成。webhook 受信と AI エージェント (Light / Deep) を担う。
#
# 起動: src/index.js (config.js 内の load 時 logging で起動構成を確認可)
#
# 注: claude CLI (Deep agent 用) は Docker image に含めない。
# Tier 2 (Claude MAX 契約者) は claude CLI を host 側 or 別途 install する想定。
# 検出ロジックは config.js (#186) で graceful disable 対応済み。
#
# build 方法 (project root から):
#   docker build -f agent-server/Dockerfile -t tealus-agent-server .

FROM node:20-alpine AS runtime
WORKDIR /app

# agent-server deps (production only)
COPY agent-server/package*.json ./agent-server/
RUN cd agent-server && npm ci --omit=dev

# agent-server source
COPY agent-server/ ./agent-server/

WORKDIR /app/agent-server
EXPOSE 4000

CMD ["node", "src/index.js"]
