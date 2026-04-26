# Tealus — 人と AI のためのメッセンジャー

[![Test](https://github.com/gamasenninn/tealus/actions/workflows/test.yml/badge.svg)](https://github.com/gamasenninn/tealus/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> **AI が声で答える。NAS 1 台で動く。月額ゼロ円。**

Tealus は LINE ライクな直感 UI のオープンソース社内メッセンジャー。AI エージェントがチャットに参加して**自然言語で業務を手伝い、音声で応答**する。画像・動画はサーバ保存で端末容量を使わない。**完全オンプレミス、サブスクリプション費用なし**で 50 人規模の社内コミュニケーションを支えられる。

公式サイト: [tealus.dev](https://tealus.dev) — ロードマップ・思想・スクリーンショットあり。

## スクリーンショット

<p align="center">
  <img src="./screenshot/readme/chat-room.png" alt="グループチャット: リプライ・画像・リアクション・Markdown ToDo" width="720" />
</p>

<p align="center">
  <img src="./screenshot/readme/room-list.png" alt="ルーム一覧" width="320" />
  &nbsp;&nbsp;
  <img src="./screenshot/readme/ai-assistant.png" alt="AI アシスタント DM" width="320" />
</p>

## クイックスタート（5 分で動く最小構成）

```bash
git clone https://github.com/gamasenninn/tealus.git
cd tealus
docker-compose up -d
cd server && cp .env.example .env && npm install && npm run dev
# 別ターミナル
cd client && npm install && npm run dev
```

ブラウザで `http://localhost:5173` を開き、別ターミナルで初回管理者を登録（[Step 5](#5-初回ユーザー登録) 参照）。AI 連携や通話まで含めた全機能セットアップは [セットアップ](#セットアップ)、見た目を即体験したいなら [デモ環境](#7-仲間を追加--デモ環境でフル体験任意) を推奨。

## 背景

- 既存メッセンジャーの画像・動画が個人スマホの容量を圧迫
- 外部サービスのAPI連携コストが高額
- 誰でも使える直感的なUIが必要

## 機能

> ★ は Tealus を他のメッセンジャーから差別化するコア機能。

### チャット基本

- 1対1チャット / グループチャット（リアルタイム送受信、Socket.IO）
- 画像・動画・ファイルアップロード（サーバー保存、サムネイル自動生成）
- 既読表示（トーク一覧: 未読数、トーク画面: 既読数）
- リプライ（引用返信）
- メッセージ転送
- メッセージ編集 + 編集履歴保持
- メッセージ削除（論理削除）
- 絵文字リアクション（6 種類）
- メンション（@user / @all / @here）
- Markdown レンダリング（コード、見出し、テーブル、ToDo リスト等）
- 全ルーム横断のメッセージ全文検索
- メディアギャラリー（ルーム内の画像/動画一覧）
- リンクプレビュー（OG タグ取得）

### AI エージェント連携 ★

Tealus の核心機能。AI がチャットメンバーとして参加し、自然言語で対話・作業する。

- **3 層エージェント構造**: Router → Light（OpenAI）/ Deep（Claude Code CLI）
- **MCP プロトコル対応**: Tealus Bot API を MCP ツールとして公開、AI が自律的にメッセージ送受信
- **ルーム単位の MCP 接続**: ルームごとに異なる MCP server を構成可能
- **エージェント設定ダッシュボード**: ルーム別 / グローバル設定（応答モード、声、プロンプト）
- **Webhook 経由のメッセージ受信**: agent-server が独立プロセスとして稼働
- **エージェントメモリ**: ファイルベースのコンテキスト保持、会話の連続性

### 音声・通話 ★

- **音声メッセージ**: 録音 → アップロード → Whisper 自動文字起こし → AI 整形
- **AI 音声応答 (TTS)**: 2 つの provider を選択
  - Browser TTS（デフォルト）: Web Speech API、ゼロ設定、API キー不要
  - Aivis Cloud TTS: 高品質（凛音エル等）+ mediasoup でルーム配信
- **トランシーバー機能 (PTT)**: ルーム内のメンバー間でリアルタイム音声送受信（mediasoup SFU）
- **音声/ビデオ通話**: 1 対 1 通話、SFU (mediasoup)
- **CLI からの音声配信**: `scripts/tealus-cli.js --voice --watch` で無線機等の音声を自動取り込み

### オフィス機能

- **TODO タグ**: メッセージにタグを付けて状態管理（完了/未完了）、ルーム横断で TODO 一覧化
- **社内お知らせ (Announcements)**: 全社向けメッセージをホーム画面に表示
- **外部アプリ登録 (Portal Links)**: 既存の社内ツール / 外部サービスへのリンクをホーム画面に集約
- **メディアギャラリー**: ルーム内の写真・動画を整理

### 表現・体験

- **AI 生成スタンプ**: テーマを指定 → AI が 16 枚のスタンプパックを自動生成
- **タイピング表示**: 入力中インジケータ
- **オンライン状態**: メンバーの在席表示
- **直感的な吹き出し UI**: モバイル / PC 両対応
- **文字サイズ設定**: 個人プロフィールで調整
- **通知音設定**: 個別カスタマイズ
- **PWA**: スマホ / PC ブラウザから利用、ホーム画面に追加可能

### 通知・統合

- **Web Push 通知**（PWA Service Worker、VAPID）
- **Bot API**: 外部システムから Tealus にメッセージ投稿・取得（CLI、agent-server 等）
- **管理者 Webhook**: 任意の外部 URL にメッセージイベントを転送

### 認証・運用

- **ユーザー ID ログイン**（JWT 認証 + bcrypt）
- **管理者ダッシュボード** (`/system`): ユーザー管理、ポータル / お知らせ管理、Webhook 管理、エージェント実行ログ閲覧
- **オンプレミス完結**: NAS 1 台で動作、月額ゼロ円
- **PostgreSQL RLS**: ルームメンバーのみがメッセージにアクセス可能

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | React 19 + Vite + PWA (vite-plugin-pwa) |
| 状態管理 | Zustand |
| バックエンド | Node.js + Express + Socket.IO |
| DB | PostgreSQL 16 (RLS有効) |
| キャッシュ | Redis 7 |
| ファイルアップロード | multer + sharp (サムネイル生成) |
| 認証 | JWT + bcrypt |
| Push通知 | web-push (VAPID) |
| コンテナ | Docker Compose |

## セットアップ

### 前提条件

- **Node.js 20+**（`--env-file` を使うため）
- **Docker** + Docker Compose
  - Windows / macOS: **Docker Desktop を起動した状態にしておく**（起動前に `docker-compose` を叩くとデーモンエラー）
  - Linux: Docker daemon が起動していること
- **Git**
- **ffmpeg**（音声通話・TTS のみ必要。[公式サイト](https://ffmpeg.org/download.html) または Chocolatey / Homebrew）

### 1. リポジトリをクローン

```bash
git clone https://github.com/gamasenninn/tealus.git
cd tealus
```

### 2. Docker 起動（PostgreSQL + Redis）

```bash
docker-compose up -d
```

これにより以下が起動します:

| サービス | ポート | 用途 |
|----------|--------|------|
| PostgreSQL | 5432 | 開発用DB |
| PostgreSQL | 5433 | テスト用DB |
| Redis | 6379 | セッション・在席状態管理 |

> **トラブルシューティング**: `error during connect: ... docker daemon is not running` と出たら Docker Desktop が起動していない。起動してから再実行してください。

### 3. サーバーセットアップ

```bash
cd server
npm install
cp .env.example .env
```

#### 環境変数

`.env.example` をコピーして `.env` を作成し、以下を設定してください:

| 変数 | 説明 |
|------|------|
| `JWT_SECRET` | JWT署名キー。下のコマンドで生成。**本番では必須**（未設定で起動失敗） |
| `VAPID_PUBLIC_KEY` | Web Push公開鍵 |
| `VAPID_PRIVATE_KEY` | Web Push秘密鍵 |
| `OPENAI_API_KEY` | 音声文字起こし・AI整形用。**AI エージェント機能（Light agent）を使う場合は必須**。テキストチャットだけなら未設定でも動く |

JWT_SECRET の生成（クロスプラットフォーム）:
```bash
# macOS / Linux (openssl 必須)
openssl rand -hex 32

# Windows PowerShell / クロスプラットフォーム（Node.js で生成）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

VAPID鍵の生成:
```bash
npx web-push generate-vapid-keys
```

各変数の詳細は `server/.env.example` 参照。

#### TTS Provider（AI 応答の音声合成）

AI が音声で応答する仕組みは Provider 形式で選択可能です。

| Provider | API Key | 品質 | セットアップ |
|----------|---------|------|-----------|
| `browser` (デフォルト) | 不要 | OS 依存 | **ゼロ設定**、各端末ローカルで合成 |
| `aivis-cloud` | 必要 | 高品質（凛音エル等） | [Aivis Cloud](https://aivis-project.com) で API key 取得 |
| `none` | - | - | TTS 完全無効 |

**デフォルト判定**: `agent-server/.env` の `TTS_PROVIDER` を未設定の場合:
- `AIVIS_API_KEY` あり → `aivis-cloud` 自動選択（既存ユーザー保護）
- `AIVIS_API_KEY` なし → `browser` 自動選択（OSS 採用者向け）

**設定は `agent-server/.env` の 1 箇所のみ**:
```bash
# agent-server/.env
TTS_PROVIDER=browser    # browser | aivis-cloud | none
```

client は起動時に `GET /api/config` で resolved な provider を runtime 取得するため、設定変更後は **agent-server / server の再起動のみで反映**（client 再ビルド不要）。

ブラウザモードでは `SpeechSynthesisUtterance` (Web Speech API) を使うため、各端末の OS 音声で発声します。iOS / macOS は Siri 品質、Windows は SAPI、Android は Google TTS が使われます。

#### エージェント構成（Light / Deep）

Tealus は 3 層エージェント構造（Router / Light / Deep）を採用。利用可能なリソースに応じて自動で振り分けます。

| 構成 | 必要なもの | できること |
|------|----------|----------|
| **Tier 1** | `OPENAI_API_KEY` | Light agent — チャット応答、軽量タスク、コード補助、Markdown 生成 |
| **Tier 2** | + Claude Code CLI（[Claude MAX](https://www.anthropic.com/max) 契約） | + Deep agent — 長時間タスク、コード生成・実行、ファイル操作、Web 検索 |

Tier 1 だけでも Tealus は完全に使えます。Tier 2 は power-user 向けの opt-in 拡張です。

`claude` CLI の有無は agent-server 起動時に自動検出され、不在なら DEEP_KEYWORDS（"コード", "リファクタ" 等）にマッチしても **silent に Light へフォールバック**します。ユーザが `/deep` を明示指定した場合のみ「Deep は CLI が必要」と返答します。

> 注: Tealus 本体は MIT ライセンスの完全 OSS です。Tier 1/2 は **外部 API/契約の有無による機能差** を表しており、Tealus 自体に有料プランはありません。

#### DBマイグレーション

```bash
npm run migrate
```

> **初回 Docker 起動時は自動実行される**: `docker-compose.yml` が migrations ディレクトリを PostgreSQL の `/docker-entrypoint-initdb.d` にマウントしているため、**Postgres コンテナの初回起動時にすべての migration が自動適用** されます。したがって初回は `npm run migrate` を省略して直接サーバーを起動しても OK です。
>
> 2 回目以降（新しい migration が追加された時）は `npm run migrate` を手動実行してください。migrations は冪等に設計されているため、再実行しても問題は起きません。

#### サーバー起動

```bash
npm run dev    # 開発（nodemon）
npm start      # 本番
```

サーバーは `http://localhost:3000` で起動します。

### 4. クライアントセットアップ

```bash
cd client
npm install
npm run dev
```

> client/.env は不要です。VAPID 公開鍵 / TTS provider 等の設定は server / agent-server の `.env` のみで管理され、client は起動時に `GET /api/config` 経由で取得します。

クライアントは `http://localhost:5173` で起動します。
Viteのプロキシ設定により、`/api/*` と `/socket.io` はサーバーに自動転送されます。

### 5. 初回ユーザー登録

ブラウザで `http://localhost:5173` を開いても、まだユーザーがいません。
APIで初回ユーザーを登録します:

**macOS / Linux / Git Bash**:
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"login_id":"admin","display_name":"管理者","password":"password123"}'
```

**Windows CMD**（1 行 + 内側の " をエスケープ）:
```cmd
curl -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" -d "{\"login_id\":\"admin\",\"display_name\":\"管理者\",\"password\":\"password123\"}"
```

**Windows PowerShell**（Invoke-RestMethod のほうが素直）:
```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/auth/register -Method Post -ContentType "application/json" -Body (@{login_id="admin"; display_name="管理者"; password="password123"} | ConvertTo-Json)
```

以降はログイン画面からユーザーIDとパスワードでログインできます。

### 6. AI エージェント・通話機能を有効化（推奨）

server / client だけでも動きますが、Tealus のコア体験 (AI 連携、通話、トランシーバー、Aivis Cloud TTS) を使うには **agent-server** と **rtc-server** が必要です。

#### 6-1. Bot ユーザー作成

agent-server は Bot ユーザーとしてログインしてチャットに参加します。Step 5 で登録した管理者でログイン → ダッシュボード (`http://localhost:3000/system`) → ユーザー管理 で、もう 1 ユーザー（例: `login_id=AI_AGENT`）を **「Bot ユーザー」フラグ ON** で作成してください。Bot ユーザーはログイン画面に出ず、API/CLI から呼ぶ専用です。

#### 6-2. agent-server セットアップ

```bash
cd agent-server
npm install
cp .env.example .env
# .env を編集:
#   TEALUS_BOT_ID=AI_AGENT
#   TEALUS_BOT_PASS=<手順 6-1 で設定したパスワード>
#   JWT_SECRET=<server/.env と同じ値>
#   OPENAI_API_KEY=<Light agent 用、AI 機能を使うなら必須>
#   AIVIS_API_KEY=<任意、aivis-cloud TTS を使う場合のみ>
npm run dev
```

agent-server は `http://localhost:4000` で起動します。

> agent-server を起動した後、Bot ユーザーをルームに参加させると、`@AI_AGENT` で AI と会話できます。Light agent (OpenAI) のみで動作。Deep agent (Claude Code CLI) は Tier 2（Claude MAX 契約者）向けの opt-in。

#### 6-3. rtc-server セットアップ（通話 / トランシーバー / Aivis Cloud TTS）

```bash
cd rtc-server
npm install
cp .env.example .env
# .env を編集:
#   JWT_SECRET=<server/.env と同じ値>
#   ANNOUNCED_IP=127.0.0.1     # localhost 検証時、LAN 配布なら LAN IP
npm run dev
```

rtc-server は `http://localhost:3100` で起動します。**ブラウザでマイクを使うには HTTPS（または localhost）が必須** — 本番デプロイでは HTTPS リバースプロキシを通してください。

> **Browser TTS だけ使う場合は rtc-server は不要**。`AIVIS_API_KEY` を設定しないと自動で `TTS_PROVIDER=browser` が選ばれ、各端末ローカルで合成されます（mediasoup 経由しない）。
>
> mediasoup の本番運用では UDP ポート範囲（デフォルト 40000-49999）の開放と、NAT 越え用に `PUBLIC_IP` の指定が必要です。

### 7. 仲間を追加 / デモ環境でフル体験（任意）

管理者ユーザー 1 人だけでは UI が寂しいので、以下のいずれかで複数人のチャットを試せます。

**A. 追加ユーザーを登録**（現在の dev 環境で継続）

上の curl コマンドの `login_id` / `display_name` を変えて叩くだけ。別ブラウザのプライベートウィンドウで別ユーザーとしてログインすれば、DM・グループチャットをすぐ試せます。

**B. デモ環境でフル体験**（alice / bob / charlie / AI アシスタント + サンプルメッセージ入り）

dev 環境を停めずに並行で別 DB / 別ポートに立てます:

```bash
# 1. デモ用 DB 作成（1 回だけ）
docker exec -it tealus_postgres psql -U tealus -d postgres -c "CREATE DATABASE tealus_demo OWNER tealus;"

# 2. デモ DB にマイグレーション + シード投入
cd server
npm run migrate:demo
npm run seed:demo

# 3. デモサーバー起動（別ターミナル、port 3001）
npm run dev:demo

# 4. デモクライアント起動（別ターミナル、port 5174）
cd ../client
npm run dev:demo
```

ブラウザで `http://localhost:5174` → ユーザー ID: `alice` / パスワード: `demo1234` でログイン。
README 冒頭のスクリーンショットと同じ画面がそのまま再現されます。

詳細は [`server/scripts/seed-demo.js`](./server/scripts/seed-demo.js) のヘッダーコメントを参照。

## テスト

### サーバーテスト（Jest）

```bash
cd server

# テスト用DB起動済みであること（docker-compose up -d）
npm test           # 全テスト実行
npm run test:watch # ウォッチモード
```

### クライアントテスト（Vitest）

```bash
cd client
npm test           # 全テスト実行
npm run test:watch # ウォッチモード
```

## ディレクトリ構成

```
tealus/
├── client/                    # React PWA フロントエンド (Vite + Zustand)
│   ├── src/
│   │   ├── components/        # 機能別 UI（auth, chat, room-list, call, media,
│   │   │                      #   profile, search, admin, multi, stamp, tags, todo, ...）
│   │   ├── hooks/             # useTransceiver, useSocketSync, useAppPanel ...
│   │   ├── services/          # API クライアント、Socket.IO、browserTts、clientConfig
│   │   └── stores/            # Zustand 状態管理（authStore, roomStore, messageStore）
│   └── __tests__/
│
├── server/                    # Node.js バックエンド (Express + Socket.IO)
│   ├── src/
│   │   ├── routes/            # REST API エンドポイント（auth, rooms, messages, bot, ...）
│   │   ├── socket/            # Socket.IO ハンドラ
│   │   ├── middleware/        # JWT 認証・ファイルアップロード・room アクセス制御
│   │   ├── services/          # Push 通知、サムネイル生成、stamp 画像生成
│   │   ├── db/                # DB 接続・マイグレーション
│   │   ├── constants/, utils/ # エラーコード、ロガー
│   │   └── app.js             # Express app エントリ
│   └── __tests__/
│
├── agent-server/              # AI エージェント (Router / Light / Deep)
│   ├── src/
│   │   ├── router/            # 第1段ルール + 第2段 LLM 振り分け
│   │   ├── agents/            # Light (OpenAI Agents SDK), Deep (Claude Code CLI)
│   │   ├── webhook/           # server からの message webhook 受信 → dispatcher
│   │   ├── mcp/               # ルームごとの MCP 接続管理
│   │   ├── memory/, context/  # ファイルメモリ・セッション管理
│   │   ├── lib/               # tts-core, ttsSpeak, botApi
│   │   └── routes/            # /public-config, /tts, /logs, /settings (ダッシュボード用)
│   └── __tests__/
│
├── dashboard/                 # 管理者ダッシュボード (Vite, /system 配信)
│   └── src/                   # pages, components, services, stores
│
├── mcp-server/                # MCP サーバー (Tealus Bot API を MCP ツール化)
│   └── src/                   # tools.js, tealusClient.js
│
├── rtc-server/                # mediasoup SFU（音声/ビデオ通話、トランシーバー、TTS 配信）
│   ├── server.js              # signaling + PlainTransport
│   ├── src/                   # ルーム・transport・consumer 管理
│   └── tts-speak.js           # CLI: テキスト → Aivis Cloud → mediasoup 配信
│
├── scripts/                   # CLI ツール群
│   ├── tealus-cli.js          # メッセージ送信・音声ファイルアップロード（--watch 対応）
│   ├── watch.js               # ディレクトリ監視
│   └── seed-demo.js           # demo データ投入
│
├── media/                     # アップロードファイル保存先
├── docs/                      # 設計書
│   ├── 01_要件定義.md
│   ├── 02_DB設計.md
│   └── 03_アーキテクチャ設計.md
├── screenshot/                # README 用スクリーンショット
├── logo/                      # ロゴ素材
│
├── docker-compose.yml
├── README.md, CHANGELOG.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, LICENSE
└── CLAUDE.md                  # AI 開発ガイドライン
```

## API一覧

### 認証

| メソッド | パス | 説明 |
|----------|------|------|
| POST | /api/auth/register | ユーザー登録 |
| POST | /api/auth/login | ログイン（JWT発行） |
| GET | /api/auth/me | 現在ユーザー取得 |
| PUT | /api/auth/profile | プロフィール更新（表示名・ステータスメッセージ） |
| POST | /api/auth/avatar | プロフィール画像アップロード |
| PUT | /api/auth/password | パスワード変更 |

### 設定（公開）

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/config | TTS provider / VAPID 公開鍵を返す（client が起動時 fetch、認証不要） |

### ユーザー

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/users | ユーザー一覧 |
| GET | /api/users/online | オンラインユーザーID一覧 |

### ルーム

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/rooms | ルーム一覧（未読数・メンバー数付き） |
| POST | /api/rooms | グループ作成 |
| POST | /api/rooms/direct | 1対1ルーム作成 |
| GET | /api/rooms/:id | ルーム詳細 |
| PUT | /api/rooms/:id | グループ名変更 |
| POST | /api/rooms/:id/icon | グループアイコンアップロード |
| GET | /api/rooms/portal-links | ポータルリンク一覧（ホーム画面用） |
| GET | /api/rooms/announcements | お知らせメッセージ一覧 |

### メッセージ

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/rooms/:id/messages | メッセージ履歴（ページネーション） |
| POST | /api/rooms/:id/messages | メッセージ送信 |
| PUT | /api/rooms/:id/messages/:msgId | メッセージ編集（編集履歴を保存） |
| GET | /api/rooms/:id/messages/:msgId/edits | 編集履歴取得 |
| PATCH | /api/rooms/:id/messages/:msgId/publish | 下書き公開（is_published=true） |
| DELETE | /api/rooms/:id/messages/:msgId | メッセージ削除（論理削除） |
| POST | /api/rooms/:id/messages/:msgId/reactions | 絵文字リアクション（トグル） |

### メディア・音声

| メソッド | パス | 説明 |
|----------|------|------|
| POST | /api/rooms/:id/media | ファイルアップロード（画像・動画・ファイル） |
| GET | /api/rooms/:id/media/gallery | メディアギャラリー（ルーム内の画像/動画一覧） |
| POST | /api/rooms/:id/voice | 音声メッセージアップロード（自動文字起こし） |

### 文字起こし

| メソッド | パス | 説明 |
|----------|------|------|
| PUT | /api/messages/:id/transcription | 文字起こしテキスト編集 |
| GET | /api/messages/:id/transcription/history | 編集履歴取得 |

### メンバー管理

| メソッド | パス | 説明 |
|----------|------|------|
| POST | /api/rooms/:id/members | メンバー追加 |
| DELETE | /api/rooms/:id/members/me | 自分が退会 |
| DELETE | /api/rooms/:id/members/:userId | メンバー除外 |
| PUT | /api/rooms/:id/members/:userId/role | グループ管理者変更 |

### 検索

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/search | 全ルーム横断のメッセージ全文検索 |

### タグ（TODO 機能含む）

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/rooms/:id/tags | ルーム内タグ一覧 |
| POST | /api/rooms/:id/tags | タグ作成（既存ならそれを返す） |
| GET | /api/rooms/:id/tags/suggest | タグ候補（前方一致） |
| GET | /api/rooms/:id/tags/todo | TODO タグ付きメッセージ一覧 |
| GET | /api/messages/:id/tags | メッセージのタグ一覧 |
| POST | /api/messages/:id/tags | メッセージにタグを付与 |
| PATCH | /api/messages/:id/tags/:tagId | タグの完了状態を変更 |
| DELETE | /api/messages/:id/tags/:tagId | メッセージからタグを外す |
| GET | /api/tags/all | 全ルーム横断のタグ一覧 |

### スタンプ（AI 生成）

| メソッド | パス | 説明 |
|----------|------|------|
| POST | /api/stamps/generate | 新規スタンプパック生成（テーマ → 16 枚を AI が生成） |
| GET | /api/stamps/packs | 自分のスタンプパック一覧 |
| GET | /api/stamps/packs/:id | パック詳細 |
| PUT | /api/stamps/packs/:id | パックメタ情報更新 |
| DELETE | /api/stamps/packs/:id | パック削除 |
| DELETE | /api/stamps/:id | 個別スタンプ削除 |

### Bot API（外部 / agent-server からの呼び出し用）

Bot ユーザー JWT で認証。agent-server や外部 CLI（`scripts/tealus-cli.js`）が利用。

| メソッド | パス | 説明 |
|----------|------|------|
| POST | /api/bot/push | テキストメッセージ送信 |
| POST | /api/bot/push-image | 画像メッセージ送信（multipart） |
| POST | /api/bot/status | エージェントステータス通知（タイピング風） |
| POST | /api/bot/tts-speak | room メンバーに `tts:speak` Socket.IO イベントを emit |
| GET | /api/bot/messages | メッセージ取得 |
| GET | /api/bot/unread | 未読メッセージ取得 |
| POST | /api/bot/mark-read | 既読マーク |
| GET | /api/bot/rooms | 参加ルーム一覧 |
| POST | /api/bot/rooms/:id/join | ルームに参加 |

### その他

| メソッド | パス | 説明 |
|----------|------|------|
| POST | /api/rooms/:id/read | 既読マーク |
| POST | /api/rooms/:id/read/all | ルーム内の全メッセージを既読 |
| POST | /api/push/subscribe | Push通知購読登録 |
| DELETE | /api/push/subscribe | Push通知購読解除 |
| GET | /api/health | ヘルスチェック |

### 管理者API

すべて `is_admin` フラグが必要。

#### ユーザー管理

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/admin/users | ユーザー一覧 |
| POST | /api/admin/users | ユーザー作成 |
| PUT | /api/admin/users/:id | ユーザー編集 |
| PATCH | /api/admin/users/:id/status | ユーザー有効化/無効化 |

#### ポータルリンク（ホーム画面のリンク管理）

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/admin/portal-links | リンク一覧 |
| POST | /api/admin/portal-links | リンク追加 |
| PUT | /api/admin/portal-links/:id | リンク編集 |
| DELETE | /api/admin/portal-links/:id | リンク削除 |

#### Webhook 管理

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/admin/webhooks | Webhook 一覧（agent-server 連携用） |
| POST | /api/admin/webhooks | Webhook 登録 |
| PUT | /api/admin/webhooks/:id | Webhook 編集 |
| DELETE | /api/admin/webhooks/:id | Webhook 削除 |
| POST | /api/admin/webhooks/:id/test | Webhook 疎通テスト |

#### モニタリング

| メソッド | パス | 説明 |
|----------|------|------|
| GET | /api/admin/rooms | 全ルーム一覧（管理者俯瞰用） |
| GET | /api/admin/agent-stats | エージェント実行統計 |
| GET | /api/admin/agent-logs | エージェント実行ログ |
| GET | /api/admin/agent-logs/:id/context | 個別実行のコンテキスト |

## Tealus MCP

`mcp-server/` は **Tealus Bot API を Model Context Protocol (MCP) ツールとして公開** する独立プロセス。Claude Code / Cursor / その他 MCP 対応 AI クライアントが、Tealus を「会話できる業務 OS」として直接呼び出せる。

### 起動方法

stdio トランスポートで動作。MCP クライアント側の設定例（Claude Code の `mcp_config.json`）:

```json
{
  "mcpServers": {
    "tealus": {
      "command": "node",
      "args": ["/path/to/tealus/mcp-server/src/index.js"],
      "env": {
        "TEALUS_API_URL": "http://localhost:3000",
        "TEALUS_USER_ID": "AI_AGENT",
        "TEALUS_PASSWORD": "your_bot_password"
      }
    }
  }
}
```

Bot 用ユーザーアカウント（管理者で作成）の認証情報を渡す。AI クライアントはこれらのツールを通じて Tealus を読み書きする。

### ツール一覧

| ツール名 | 概要 | パラメータ |
|---------|------|----------|
| `send_message` | ルームにテキストメッセージを送信 | `room_id`, `content` |
| `send_image` | ルームに画像を送信（base64） | `room_id`, `image_base64`, `filename`, `caption?` |
| `get_messages` | ルームのメッセージ履歴を取得 | `room_id`, `limit?` (デフォルト 20、最大 100) |
| `list_rooms` | Bot が参加中のルーム一覧 | なし |
| `join_room` | ルームに参加 | `room_id` |
| `mark_read` | メッセージを既読化 | `message_ids[]` |

### ユースケース例

- **社外 Claude Code から Tealus にレポート投稿**: `send_message` + `send_image` でグラフ生成 → 社内 Tealus に直接投稿
- **AI が会話履歴を参照して応答**: `get_messages` で直近の文脈を取得 → コンテキストに加味して回答
- **複数 AI エージェントの相互通信**: 各 AI が `list_rooms` / `send_message` で連絡

### 拡張予定（v0.1.x）

[#185](https://github.com/gamasenninn/tealus/issues/185) で **read-only な検索・分析ツール群**（`search_messages`, `find_todo_messages`, `query_agent_context` 等）の追加を計画中。実装されると AI が「組織の記憶」として機能する。

## Socket.IO イベント

### ルーム / メッセージ

| イベント | 方向 | 説明 |
|----------|------|------|
| room:join | client → server | ルームに参加 |
| room:leave | client → server | ルームから退出 |
| message:send | client → server | メッセージ送信 |
| message:new | server → client | 新着メッセージ通知 |
| message:updated | server → client | メッセージ編集通知 |
| message:published | server → client | 下書き公開通知 |
| message:deleted | server → client | メッセージ削除通知 |
| message:read | 双方向 | 既読通知 |
| message:reaction | server → client | リアクション更新 |
| link:preview | server → client | リンクプレビュー結果 |

### 入力中・在席

| イベント | 方向 | 説明 |
|----------|------|------|
| typing:start | 双方向 | 入力中通知 |
| typing:stop | 双方向 | 入力停止通知 |
| user:online | server → client | ユーザーオンライン通知 |
| user:offline | server → client | ユーザーオフライン通知 |

### メンバー管理

| イベント | 方向 | 説明 |
|----------|------|------|
| member:added | server → client | メンバー追加通知 |
| member:removed | server → client | メンバー退会/除外通知 |

### 音声・TTS

| イベント | 方向 | 説明 |
|----------|------|------|
| voice:status | server → client | 文字起こしステータス更新 |
| voice:transcription | server → client | 文字起こし結果 |
| tts:speak | server → client | ブラウザ TTS 読み上げ依頼（TTS_PROVIDER=browser 時） |

### AI エージェント

| イベント | 方向 | 説明 |
|----------|------|------|
| agent:status | server → client | エージェント処理中ステータス（タイピング風表示） |

### スタンプ生成

| イベント | 方向 | 説明 |
|----------|------|------|
| stamp:generated | server → client | スタンプパック生成完了 |
| stamp:error | server → client | スタンプ生成失敗 |

### 通話（mediasoup シグナリングは別経路、これは着信通知）

| イベント | 方向 | 説明 |
|----------|------|------|
| call:start | client → server | 通話開始リクエスト |
| call:reject | client → server | 着信拒否 |
| call:end | client → server | 通話終了 |
| call:incoming | server → client | 着信通知 |
| call:rejected | server → client | 拒否通知 |
| call:ended | server → client | 終了通知 |
| call:status | server → client | 通話状態更新 |

## 本番デプロイ

### Nginx設定例

マイク使用 / Push 通知 / Service Worker のため **HTTPS 必須**。下記は HTTPS をリバースプロキシで終端した想定。`certbot` 等で証明書を別途用意してください。

```nginx
server {
    listen 443 ssl http2;
    server_name tealus.example.com;

    ssl_certificate     /etc/letsencrypt/live/tealus.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tealus.example.com/privkey.pem;

    # React PWA（client/dist を server が配信するので proxy で済ませる方が単純）
    # 直接 dist を配信する場合は下の location / を root にする
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # REST API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Socket.IO (WebSocket upgrade 必須)
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # agent-server (AI エージェント webhook / config)
    location /agent-api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # rtc-server (mediasoup signaling) — WebSocket upgrade 必須
    location /rtc/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # 管理者ダッシュボード
    location /system/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    # メディアファイル配信（server 経由でも、Nginx 直配信でも可）
    location /media/ {
        alias /var/tealus/media/;
        expires 30d;
    }
}

# HTTP → HTTPS リダイレクト
server {
    listen 80;
    server_name tealus.example.com;
    return 301 https://$host$request_uri;
}
```

**mediasoup の追加要件**: rtc-server は WebSocket signaling とは別に、**音声/映像 RTP のため UDP ポートを直接開放** する必要があります（デフォルト範囲 40000-49999）。クライアントからこの UDP 範囲がサーバに到達できるよう、ファイアウォール / NAT を設定してください。NAT 越え時は `rtc-server/.env` の `PUBLIC_IP` にグローバル IP を設定。

> server (`/api/`, `/agent-api/`, `/rtc/`, `/system/`) は内部で各サービスへ自動 proxy されるため、Nginx は **server (port 3000) に集約** すれば動きます。agent-server (4000) / rtc-server (3100) を直接外部公開する必要はありません。

### クライアントビルド

```bash
cd client
npm run build
# dist/ ディレクトリが生成される
```

## ロードマップ

実装済みの機能は上の [機能](#機能) セクション参照。今後の予定は GitHub Issues で管理しています。

### v0.1.x

- **内部 DB MCP** — AI に「組織の記憶」を持たせる（[#185](https://github.com/gamasenninn/tealus/issues/185)）
- **AI 間メッセージング** — Tealus を AI 組織の OS に（[#164](https://github.com/gamasenninn/tealus/issues/164)）
- **mcp-server を npm publish** — `npx tealus-mcp` で起動可能に（[#187](https://github.com/gamasenninn/tealus/issues/187)）
- バックグラウンド Push 通知の安定化（[#168](https://github.com/gamasenninn/tealus/issues/168)）
- UX 磨き込み（モバイル実機フィードバック反映）

### v0.2.0 候補

- **Anthropic API 経由の Deep agent** — Claude MAX 不要化
- **TypeScript 化** — コントリビュータ誘致
- LINE 連携ブリッジ（[#160](https://github.com/gamasenninn/tealus/issues/160)）
- ゲストルーム — 外部チャット連携 + AI 一次対応（[#124](https://github.com/gamasenninn/tealus/issues/124)）
- 通話品質の自動最適化（[#138](https://github.com/gamasenninn/tealus/issues/138)）

### 将来構想

- LDAP 認証
- NAS クラスター構成（[#120](https://github.com/gamasenninn/tealus/issues/120)）
- ブロックチェーントークン（感謝経済）設計（[#83](https://github.com/gamasenninn/tealus/issues/83)）

## ライセンス

MIT License - 詳細は [LICENSE](./LICENSE) を参照してください。

Copyright (c) 2026 Satoshi Ono and Tealus Project Contributors

---

## 関連ドキュメント

- [CHANGELOG.md](./CHANGELOG.md) — リリースノート / 変更履歴
- [CONTRIBUTING.md](./CONTRIBUTING.md) — 開発参加ガイド
- [SECURITY.md](./SECURITY.md) — 脆弱性報告 / セキュリティポリシー
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — 行動規範
- [docs/](./docs/) — 設計書（要件定義 / DB 設計 / アーキテクチャ）
