# Tealus server (#188 Phase A)
#
# Multi-stage build:
#   Stage 1: client (Vite + React PWA) build → client/dist
#   Stage 2: dashboard (Vite) build → dashboard/dist
#   Stage 3: runtime — Node.js + server code + 同梱した dist 配信
#
# 起動時の挙動:
#   - migrate (idempotent) を実行してから src/app.js を起動
#   - server/src/app.js は ../../client/dist と ../../dashboard/dist を
#     express.static で配信する設計なので、stage 3 で同じレイアウトに揃える
#
# build 方法 (project root から):
#   docker build -f server/Dockerfile -t tealus-server .

# --- Stage 1: client build ---
FROM node:24-alpine AS client-builder
WORKDIR /build
COPY client/package*.json ./client/
# ★ #558 client も "postinstall": "vite build" を持つ (dashboard と同じ理由で、ここでは走らせない)
RUN cd client && npm ci --ignore-scripts
COPY client/ ./client/
# ★ #558 client/tsconfig.json が ../tsconfig.base.json を extends している (無いとビルドが落ちる)
COPY tsconfig.base.json ./
RUN cd client && npm run build

# --- Stage 2: dashboard build ---
FROM node:24-alpine AS dashboard-builder
WORKDIR /build
COPY dashboard/package*.json ./dashboard/
# ★ #558 dashboard の package.json には "postinstall": "vite build" がある (手元の npm install で管理画面を作るため)。
#   ここではまだソースをコピーしていないので、そのまま npm ci すると vite build が失敗してイメージが作れなかった。
#   作るのは下の npm run build で行う
RUN cd dashboard && npm ci --ignore-scripts
COPY dashboard/ ./dashboard/
# ★ #558 dashboard/tsconfig.json が ../tsconfig.base.json を extends している (無いとビルドが落ちる)
COPY tsconfig.base.json ./
RUN cd dashboard && npm run build

# --- Stage 3: runtime ---
FROM node:24-alpine AS runtime
WORKDIR /app

# server deps (production only)
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# server source
COPY server/ ./server/

# 同梱: client/dist と dashboard/dist
# server/src/app.js が __dirname/../../client/dist を参照するので
# /app/client/dist と /app/dashboard/dist に配置する必要がある
COPY --from=client-builder /build/client/dist ./client/dist
COPY --from=dashboard-builder /build/dashboard/dist ./dashboard/dist

# server で実行
WORKDIR /app/server
EXPOSE 3000

# 起動時にマイグレーションを実行 (冪等、#172 で対応済み)
CMD ["sh", "-c", "node src/db/migrate.mts && node src/app.mts"]
