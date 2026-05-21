# Tealus — 人と AI のためのメッセンジャー

[![Test](https://github.com/gamasenninn/tealus/actions/workflows/test.yml/badge.svg)](https://github.com/gamasenninn/tealus/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> **AI が組織の記憶を声で運ぶ。NAS 1 台で動く。月額ゼロ円。**

Tealus は **LINE ライクな直感 UI のオープンソース社内メッセンジャー**、かつ **AI が時間とともに organic に成長する組織記憶基盤**。AI エージェントがチャットに参加して**自然言語で業務を手伝い、音声で応答**するだけでなく、業務メモ・トランシーバー音声・編集履歴がそのまま AI の文脈と辞書になり、**使うほど組織の語彙が育つ** — voice で育てた辞書が video や DB query でも同じ精度で効く。画像・動画はサーバ保存で端末容量を使わない。**完全オンプレミス、サブスクリプション費用なし**で 50 人規模の社内コミュニケーションを支える。

設計姿勢の詳細: [philosophy.md](docs/presentation/philosophy.md) (organic ontology / 4 柱 / 5 必要条件) — 物語化: [walkthrough-script-v1.md](docs/presentation/walkthrough-script-v1.md) (5/11-5/14 dogfood 5 act script) — elevator pitch: [elevator-pitches.md](docs/presentation/elevator-pitches.md)。

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

> **前提**: **Node.js 20 以上** (推奨: 22 LTS) + **Docker** + **Docker Compose**。Node 18 以下では `undici` が `ReferenceError: File is not defined` で crash します ([#210](https://github.com/gamasenninn/tealus/issues/210))。`.npmrc` で `engine-strict=true` を有効化しているため、Node 18 では `npm install` 自体が `EBADENGINE` で fail します。Ubuntu 等の apt 標準が Node 18 系の場合は [nvm](https://github.com/nvm-sh/nvm) や [NodeSource](https://github.com/nodesource/distributions) で 22 LTS を入れてください。

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
- メンション（@ユーザー名）
- Markdown レンダリング（コード、見出し、テーブル、ToDo リスト等）
- 全ルーム横断のメッセージ全文検索
- メディアギャラリー（ルーム内の画像/動画一覧）
- リンクプレビュー（OG タグ取得）

### AI エージェント連携 ★

Tealus の核心機能。AI がチャットメンバーとして参加し、自然言語で対話・作業する。

- **3 層エージェント構造**: Router → Light v1 (`/light`、OpenAI Agents SDK) / Light v2 (`/light2`、codex SDK backed、cross-room 探索強化) / Deep (`/deep`、Claude Code CLI)
- **MCP プロトコル対応**: Tealus Bot API を MCP ツールとして公開、AI が自律的にメッセージ送受信。stdio / HTTP の 2 transport 対応 (HTTP は cross-machine 用、tealus-mcp v0.12.0+、[#264](https://github.com/gamasenninn/tealus/issues/264))
- **ルーム単位の MCP 接続**: ルームごとに異なる MCP server を構成可能
- **`@Claude` mention で Claude Code 連携**: `cc-aliases.json` 設定ファイルで `@<別名>` も登録可能、code 変更不要で alias 追加 ([#263](https://github.com/gamasenninn/tealus/issues/263))
- **エージェント設定ダッシュボード**: ルーム別 / グローバル設定（応答モード、声、プロンプト）
- **Webhook 経由のメッセージ受信**: agent-server が独立プロセスとして稼働
- **エージェントメモリ**: ファイルベースのコンテキスト保持、会話の連続性
- **PDF / DOCX / XLSX 解析**: 添付文書を agent が text 化して読める（scan PDF も Gemini Vision で対応、opt-in）

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

### AI 生成スタンプ ★

他のメッセンジャーにない Tealus 独自機能。テーマを言葉で指示するだけで、自分だけのオリジナルスタンプパックが完成する。

- **テーマ指示 → 16 枚自動生成**: 「ねこの感情表現」「業務リアクション」等を入力 → AI 画像生成 → 1 パック 16 枚に自動セット
- **既存メッセンジャーのスタンプ文化を OSS / オンプレで再現**: LINE / Slack に依存しない
- **チームでパックを共有**: 作ったパックをルーム内で送り合える
- **生成は非同期**: バックグラウンドで進行、Socket.IO で `stamp:generated` イベント通知

### 表現・体験

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
| `GOOGLE_API_KEY` | （任意）`agent-server/.env` 側、scan PDF を Gemini Vision で text 化する fallback 用 ([#233](https://github.com/gamasenninn/tealus/issues/233))。詳細は下記「PDF / 文書解析」section |

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

#### エージェント構成（Light v1 / Light v2 / Deep）

Tealus は **Router + 3 つの応答 tier** を採用。利用可能なリソースに応じて自動で振り分けます。user は `/light` `/light2` `/deep` prefix で明示指定も可。

| 構成 | 必要なもの | できること |
|------|----------|----------|
| **Tier 1 (Light v1)** | `OPENAI_API_KEY` | OpenAI Agents SDK、チャット応答 / 軽量タスク / コード補助 / 単 room 要約 (cost 効率) |
| **Tier 1 (Light v2)** | `OPENAI_API_KEY` (default) or `LIGHTV2_AUTH=subscription` (ChatGPT Plus 持ち、API cost 0) | codex SDK backed、cross-room 探索 / 多角 tool 操作で v1 より完結率高い ([#258](https://github.com/gamasenninn/tealus/issues/258)) |
| **Tier 2 (Deep)** | + Claude Code CLI（[Claude MAX](https://www.anthropic.com/max) 契約） | + Deep agent — 長時間タスク、コード生成・実行、ファイル操作、Web 検索、user の `Cancel` button で中断可 ([#250-#252](https://github.com/gamasenninn/tealus/issues/250)) |

Tier 1 だけでも Tealus は完全に使えます。Tier 2 は power-user 向けの opt-in 拡張です。

`claude` CLI の有無は agent-server 起動時に自動検出され、不在なら DEEP_KEYWORDS（"コード", "リファクタ" 等）にマッチしても **silent に Light へフォールバック**します。ユーザが `/deep` を明示指定した場合のみ「Deep は CLI が必要」と返答します。

**Light v1 / v2 の選び分け**:

| 用途 | 推奨 tier |
|---|---|
| 単純会話 / 単 room 要約 | **v1** (cost 効率) |
| cross-room 探索 / 多角 tool 操作 (複数 room のメッセージを跨いで分析等) | **v2** (完結率明確に勝る) |
| ChatGPT Plus / Pro / Team を持っている | **v2 + `LIGHTV2_AUTH=subscription`** (API cost 0 + Fast Mode access) |

詳細セットアップ手順は [`docs/setup-ai-agent.md`](docs/setup-ai-agent.md) (ステップ 9: Light v2 を使う) 参照。

> 注: Tealus 本体は MIT ライセンスの完全 OSS です。Tier 1/2 は **外部 API/契約の有無による機能差** を表しており、Tealus 自体に有料プランはありません。

#### PDF / 文書解析（Light agent オプション拡張）

Light agent は tealus-mcp 経由で **PDF / DOCX / XLSX を text 化** して読めます ([#232](https://github.com/gamasenninn/tealus/issues/232))。さらに **scan PDF / image-only PDF** も Gemini API multimodal で text 化できます ([#233](https://github.com/gamasenninn/tealus/issues/233))。

| 段階 | 必要なもの | できること |
|------|----------|----------|
| **Phase 1**（自動） | 不要（library bundled） | digital PDF / DOCX / XLSX を text 抽出 |
| **Phase 2**（opt-in） | `GOOGLE_API_KEY` | scan PDF / image-only PDF を Gemini で text 化 |

`agent-server/.env` に `GOOGLE_API_KEY` を設定すれば自動で Phase 2 有効化、unset で Phase 1 のみ動作。

```bash
# agent-server/.env
GOOGLE_API_KEY=AIzaSy...                   # Google AI Studio で取得（無料枠あり）
DOCUMENT_VISION_PROVIDER=gemini            # default、unset で同じ挙動
DOCUMENT_VISION_MODEL=gemini-2.5-flash-lite
DOCUMENT_VISION_MAX_PAGES=20               # cost 保護、超過は vision skip
```

**⚠️ Privacy 注意**: Gemini free tier は Google が製品改善のため input/output を利用、human reviewer が処理する可能性あり ([Gemini API terms](https://ai.google.dev/gemini-api/terms))。社内文書を扱う場合は **paid billing account に紐付けた API key の使用を推奨**、もしくは `DOCUMENT_VISION_PROVIDER=none` で disable してください。

#### DBマイグレーション

```bash
npm run migrate
```

> **初回 Docker 起動時は自動実行される**: `docker-compose.yml` が migrations ディレクトリを PostgreSQL の `/docker-entrypoint-initdb.d` にマウントしているため、**Postgres コンテナの初回起動時にすべての migration が自動適用** されます。したがって初回は `npm run migrate` を省略して直接サーバーを起動しても OK です。
>
> 2 回目以降（新しい migration が追加された時）は `npm run migrate` を手動実行してください。migrations は冪等に設計されているため、再実行しても問題は起きません。

> **PostgreSQL extension 要件 (v0.2.0 以降)**: migration 021 (`pg_trgm` GIN index、メッセージ全文検索の高速化に使用) が `pg_trgm` extension を有効化します。Tealus 同梱の Docker Postgres image (`docker-compose.yml`) では自動有効化されるため追加作業不要です。**managed PostgreSQL** (Supabase / RDS / Heroku Postgres / Cloud SQL 等) を使う場合は事前に `CREATE EXTENSION pg_trgm` 実行可能な権限 (SUPERUSER 相当) を確認してください。

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
APIで初回ユーザーを登録します。

> 💡 **最初に登録した非 Bot ユーザーは自動的に admin role になります** ([#211](https://github.com/gamasenninn/tealus/issues/211))。以降の登録は通常の user role で作成され、admin がダッシュボード経由で昇格管理できます。

> ⚠️ **下記の `password123` は localhost 検証用のサンプル**。本番運用では必ず強固なパスワード（12 文字以上、英数記号混在）に置き換えてください。

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

> 📖 **初めて触る方向けの詳細手順**: [`docs/setup-ai-agent.md`](./docs/setup-ai-agent.md) に「OpenAI API キー取得 → Bot ユーザー作成 → agent-server 起動 → ルーム招待 → 対話確認」までの完全な walkthrough があります (15-20 分)。下記 6-1 / 6-2 はそのサマリです。

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

#### rtc-server の有無で何が動くか

server は rtc-server の `/health` を 30 秒ごとに poll し、状態変化を Socket.IO で client に通知します。**rtc-server を後から起動 / 停止 / 別ホストに移動しても 30 秒以内に UI が自動追従**します。

| 機能 | rtc-server あり | rtc-server なし |
|------|---------------|---------------|
| テキストチャット / 画像 / 動画 / ファイル | ✅ | ✅ |
| AI エージェント連携 (Light / Deep) | ✅ | ✅ |
| 音声メッセージ (録音 → 文字起こし) | ✅ | ✅ |
| Browser TTS (Web Speech API) | ✅ | ✅ |
| 個人 TTS ボタン (aivis-cloud mode) | ✅ | ✅ |
| **Aivis Cloud TTS auto 読み上げ** | ✅ | ✅ (Socket.IO 経由、品質劣化なし) |
| AI 生成スタンプ / TODO / 検索 / メンション / リアクション | ✅ | ✅ |
| 通話 / ビデオ通話 | ✅ | ❌ ボタン非表示 |
| トランシーバー (PTT) | ✅ | ❌ ボタン非表示 |
| トランシーバーゲート受信機 (専用 hardware、mediasoup PlainTransport listen) | ✅ (TTS_BROADCAST_MEDIASOUP=true) | ❌ |

**Plan B-1 (rtc 抜き) で起動した場合**: 通話 / トランシーバーボタンは非表示、それ以外は **品質劣化なしで全機能動作**。Aivis 高品質音声も agent-server で合成された WAV を Socket.IO 経由で配信するため聞こえます。テキスト + AI 中心の運用ではゼロ妥協で動きます。

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
├── mcp-server/                # 移転先案内のみ (実装は独立 repo gamasenninn/tealus-mcp へ)
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

stdio (default、ゼロ設定) と HTTP (cross-machine 用、v0.12.0+) の 2 transport をサポート。**通常は stdio**、agent-server と Claude Code が **別マシン** に居る場合のみ HTTP を opt-in 利用 ([#264](https://github.com/gamasenninn/tealus/issues/264) Phase 1 alpha)。

#### stdio (default、推奨)

**GitHub 直接 install（clone 不要・ゼロセットアップ）**:

```json
{
  "mcpServers": {
    "tealus": {
      "command": "npx",
      "args": ["-y", "github:gamasenninn/tealus-mcp"],
      "env": {
        "TEALUS_API_URL": "http://localhost:3000",
        "TEALUS_USER_ID": "AI_AGENT",
        "TEALUS_PASSWORD": "your_bot_password"
      }
    }
  }
}
```

ローカル開発で clone 済の場合は `node /path/to/tealus-mcp/src/index.js` を直接呼ぶことも可能。

Bot 用ユーザーアカウント（管理者で作成）の認証情報を渡す。AI クライアントはこれらのツールを通じて Tealus を読み書きする。

> 本パッケージは npm registry ではなく **独立 repo [gamasenninn/tealus-mcp](https://github.com/gamasenninn/tealus-mcp)** から GitHub 直接 install で配布される。`npx` が初回に GitHub からアーカイブを取得し、以後は npm のローカルキャッシュから起動。

#### HTTP (cross-machine 用、v0.12.0+、opt-in)

agent-server と Claude Code が **別マシン** に居る構成では stdio (child process spawn 前提) は使えない。代わりに tealus-mcp を HTTP server として起動、tealus 本体 (port 3000) の `/mcp/*` proxy 経由でリモートからも MCP tools を呼べる:

```
[Claude Code (マシン A)]              [Tealus サーバ (マシン B)]
  ~/.claude.json                          port 3000 (Tealus 本体)
  mcpServers:                             ┌──────────────────┐
    tealus:                               │ /mcp proxy       │
      url: https://<host>/mcp             │   ↓              │
      headers:                            │ port 3200        │
        Authorization: Bearer <JWT> ────► │ tealus-mcp HTTP  │
                                          └──────────────────┘
```

詳細セットアップは [`docs/setup-cc-tealus-bridge.md` ステップ 5A](docs/setup-cc-tealus-bridge.md#%E3%82%B9%E3%83%86%E3%83%83%E3%83%97-5a-%E4%BB%BB%E6%84%8F-http-transport-%E3%81%A7%E6%8E%A5%E7%B6%9A%E3%81%99%E3%82%8B--cross-machine-%E6%A7%8B%E6%88%90-v0120-) 参照。Phase 2 (SSE event broker、server → client wake-up) は [#270](https://github.com/gamasenninn/tealus/issues/270) で議論先行中。

### ツール一覧

| ツール名 | 概要 | パラメータ |
|---------|------|----------|
| `send_message` | ルームにテキストメッセージを送信 | `room_id`, `content` |
| `send_image` | ルームに画像を送信（base64） | `room_id`, `image_base64`, `filename`, `caption?` |
| `get_messages` | ルームのメッセージ履歴を取得 | `room_id`, `limit?` (デフォルト 20、最大 100) |
| `get_message_media` | メッセージのメディア取得 (画像は AI が直接視認、音声は文字起こし優先) | `message_id` |
| `search_messages` | メッセージ全文検索 (キーワード / タグ / 期間 / 発言者、snippet ハイライト付) | `q?`, `room_id?`, `sender_id?`, `type?`, `tag_names?`, `is_done?`, `since?`, `until?`, `limit?`, `offset?` |
| `mark_tag_done` | メッセージのタグ完了状態 (is_done) を更新 | `message_id`, `tag_name`, `is_done` |
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

### Docker デプロイ（推奨）

OSS 採用者向けに、`docker-compose.full.yml` 一発で **postgres + redis + server + agent-server** が起動する構成を用意しています。Mac / Windows / Linux いずれでも動作。NAS の Container UI (Synology / QNAP / UGREEN) からも `docker-compose.full.yml` の中身を貼り付けるだけで起動できます。

#### 構成 1: 通話なし（推奨デフォルト、すべての OS で動作）

```bash
git clone https://github.com/gamasenninn/tealus.git
cd tealus

# 必要な .env ファイルを作成
cp server/.env.example server/.env          # JWT_SECRET / VAPID_PUBLIC_KEY 等を設定
cp agent-server/.env.example agent-server/.env  # OPENAI_API_KEY / TEALUS_BOT_PASS 等を設定

# 起動
docker compose -f docker-compose.full.yml up -d
```

ブラウザで `http://localhost:3000` にアクセス。

**この構成で動くもの**:
- テキストチャット / 画像 / 動画 / ファイルアップロード
- AI エージェント連携 (Light / Deep)
- **Aivis Cloud 高品質 TTS auto 読み上げ** (rtc-server 不要、Socket.IO blob 経由)
- Browser TTS / 個人 TTS ボタン
- AI 生成スタンプ / TODO タグ / 検索 / メンション / リアクション
- Push 通知 / Bot API / 管理者ダッシュボード

**この構成で動かないもの**:
- 音声 / ビデオ通話
- トランシーバー (PTT)

#### 構成 2: 通話も使う - rtc-server をホスト native install（クロスプラットフォーム）

通話 / トランシーバーを使いたい場合、rtc-server を host 側で別途起動するのが推奨。Mac / Windows でも動作:

```bash
# 構成 1 で起動済みの上で
cd rtc-server
cp .env.example .env  # JWT_SECRET は server/.env と同じ値に
npm install
npm run start          # 別ターミナルで起動 (or systemd / launchd で daemon 化)
```

#### 構成 3: rtc-server も Docker（Linux ホスト限定）

```bash
docker compose -f docker-compose.full.yml -f docker-compose.rtc.yml up -d
```

**重要**:
- **Linux ホスト限定** (mediasoup の host network 制約)
- UDP ポート範囲 (default 40000-49999) を host のファイアウォールで開放
- NAT 越え時は `rtc-server/.env` で `ANNOUNCED_IP` / `PUBLIC_IP` を設定

#### 永続データとアップデート

| データ | 保存先 |
|--------|-------|
| PostgreSQL | named volume `pgdata-prod` |
| Redis | named volume `redisdata-prod` |
| アップロード媒体 | `./media` (host bind mount) |
| エージェント workspace | named volume `agent-workspaces-prod` |

アップデート時は:

```bash
git pull
docker compose -f docker-compose.full.yml build
docker compose -f docker-compose.full.yml up -d
# 起動時にマイグレーション (冪等) が自動実行される
```

#### 開発者向け補足

`docker-compose.yml`（version 管理されている既存ファイル）は **開発用** で、postgres / postgres_test / redis のみを起動する設計を維持しています。Node サービス (server / agent-server / rtc-server) は引き続き `npm run dev` でホスト直接起動、ホットリロード / nodemon が機能します。

`docker-compose.full.yml` は **デプロイ用** で別ファイルなので、開発者フローと衝突しません。

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
| AI エージェント | OpenAI Agents SDK / Claude Code CLI |
| MCP | @modelcontextprotocol/sdk |
| TTS | Web Speech API / Aivis Cloud API |
| 通話・SFU | mediasoup |
| コンテナ | Docker Compose |

## ロードマップ

実装済みの機能は上の [機能](#機能) セクション参照。リリース履歴は [CHANGELOG.md](./CHANGELOG.md) を参照 (現在 **v0.2.4**、2026-05-12 release)。今後の予定は GitHub Issues で管理しています。

### v0.1.x — v0.2.x で消化済 ✅

- ~~**内部 DB MCP** — AI に「組織の記憶」を持たせる~~ ✅ ([#185](https://github.com/gamasenninn/tealus/issues/185)、v0.2.x 系で実装、5/11 社内 DB dogfood 成功)
- ~~**AI 間メッセージング** — Tealus を AI 組織の OS に~~ ✅ ([#164](https://github.com/gamasenninn/tealus/issues/164))
- ~~**mcp-server を npm publish** — `npx tealus-mcp` で起動可能に~~ ✅ ([#187](https://github.com/gamasenninn/tealus/issues/187))

### v0.2.x ハイライト (リリース済み)

- **PWA App Badge** (Android ドット / iOS 数字、二経路 defense in depth) — v0.2.4
- **動画文字起こし** (`transcribe_media`、cross-modality dividend の起点) — v0.2.x
- **vocab inject 拡張** (model-aware 上限 2000 char、新世代 transcribe 2 model に default 適用) — v0.2.x
- **tealus-mcp HTTP transport** (cross-machine 用、[#264](https://github.com/gamasenninn/tealus/issues/264)) — v0.2.x
- 詳細は [CHANGELOG.md](./CHANGELOG.md) 参照

### v0.3.x 候補

- **Docker による全サービスデプロイ化** — Synology / QNAP / UGREEN / Linux / Mac で 1 コマンド起動 ([#188](https://github.com/gamasenninn/tealus/issues/188) Phase A)
- **Anthropic API 経由の Deep agent** — Claude MAX 不要化
- **TypeScript 化** — コントリビュータ誘致
- **ローカルエージェント** (Light agent provider abstraction、データ主権 driven、[#272](https://github.com/gamasenninn/tealus/issues/272)) — 議論先行、採用者 voice surface 待ち
- **バックグラウンド Push 通知** 残 sub-task ([#168](https://github.com/gamasenninn/tealus/issues/168)) — core path は v0.2.4 完了、SW 永続化 / 死活監視は trigger 待ち
- **multi-agent dock vision** — Tealus = Role を持った主体 (AI / 人間) が dock する context 空間 ([#275](https://github.com/gamasenninn/tealus/issues/275) umbrella、[#276](https://github.com/gamasenninn/tealus/issues/276) codex spike) — 議論先行、Anthropic 6/15 制度との整合 + Codex 自律 / Claude N dock 棲み分け
- **iOS PWA 他アプリ転送** — Apple Shortcuts 経由 ([#277](https://github.com/gamasenninn/tealus/issues/277) Phase 2 手動 setup MVP / [#278](https://github.com/gamasenninn/tealus/issues/278) Phase 3 profile 画面から自動 setup) — 議論先行、Web Share Target が iOS 非対応のため別 path
- LINE 連携ブリッジ ([#160](https://github.com/gamasenninn/tealus/issues/160))
- ゲストルーム — 外部チャット連携 + AI 一次対応 ([#124](https://github.com/gamasenninn/tealus/issues/124))
- 通話品質の自動最適化 ([#138](https://github.com/gamasenninn/tealus/issues/138))

### Phase 4 物語化 (進行中、中盤の優先 lever)

`docs/presentation/` に narrative 3 doc が同 vocabulary で連動:

- **プレゼン資料 umbrella** ([#209](https://github.com/gamasenninn/tealus/issues/209)) — philosophy.md v2 / elevator-pitches.md v2 / walkthrough-script-v1.md (5/14 sub-1 着地)
- **採用者 case study** (sub-4、許諾後)
- **tealus 関連ブログ立ち上げ** ([#265](https://github.com/gamasenninn/tealus/issues/265))

**docs disclosure 階段** (5/18 物理化完成、CHANGELOG `[Unreleased]` 参照):

- **LP** (`tealus.dev`) — concrete hook (NAS / ゼロ円 / AI 音声 / LINE ライク) + 組織記憶 signal (5/17 PR 1/2 で確立)
- **`docs/00_what-is-tealus.md`** — 入り口 doc (新規 5/18)、Tealus とは何か / なぜ / 何が起こるか / どう違うか / 本質
- **`docs/04_オーガニックオントロジー構造.md`** — full disclosure (5/17 初版 + 5/18 v0.5 update)、4 層 emergence architecture + 6 段階 feedback loop
- **`tealus-organon` repo** (private) — Layer 3 data 担体、5+1 原則の運用 manual

audience の認知負荷を段階的に管理する 4 段階構造、SVG 3 枚 + PNG 3 枚で visual 統一感も `docs/images/` で確立。

**Organic ontology の運用 phase 到達** (5/18 → 5/19 update):

- **organon v0.5 → v0.5.1 release**: entries 12 → 20 → **26 (+30%)**、hazard 軸 family 8 → 11 → **12 軸目 candidate (observer-architect-duality)**、organization kind 正式追加、cover 27.3% → **57% (倍以上)**
- **第 6 feedback layer = upstream pipeline rectification 正典化**: 観測 → 上流 data source 修正 → 量的訂正効果 で因果 loop を外向きに開く戦略確立、internal pragmatic 閉じ + 外部因果 loop 開きの二段戦略で organic に解消
- **第 1 例 feedback loop 量的成功 4/4 ✅ confirmed** (5/19 Day 3 trace、27 時間 round-trip closure): organon hazard 発見 → 本体 `transcription_guideline.json` vocabulary 38 → 42 → Day 3 朝礼 STT で「上山/アンプリ/中田/クラッチー」全て 0 件 + 「神山/三瓶/舟太/山崎整備長」正発火、distributed AI lane coordination の経験的根拠 ([Issue #279](https://github.com/gamasenninn/tealus/issues/279) (b) 一般理論)
- **第 7 layer 候補 framing 訂正 (architect-mediated organon ingestion)** + **★★ 14 軸目 candidate (observer-architect-duality)**: universality 主張 = methodology + architect role prerequisite (= adoption barrier) 二重 thesis、Phase 5 narrative の qualifier
- **maturation curve 4 日連続 layer surface** (5/17 layer 5 / 5/18 layer 6 / 5/19 朝 layer 7 候補 / 5/19 夕 14 軸目 candidate): steepness 自体が architect の active co-evolution の structural evidence

**Phase 5 narrative core 候補 — ゲストユーザ role 拡張 Phase 1 MVP 完成** (5/19 [#282](https://github.com/gamasenninn/tealus/issues/282)):

- `users.role IN ('admin', 'user', 'guest')` 1 軸追加で **schema (Phase A) + permission helper (Phase B) + route guards (Phase C)** 3 層が 1 day 完成、+33 tests、production deploy 済
- Tealus 根幹原則 (= AI と人間を区別する仕組みが最小限) を外部 user にも適用、`users.is_bot` flag と同型の対称的拡張
- 採用者 voice trigger 解除候補: 「外部問い合わせ機能?」と聞かれた瞬間に dep ゼロで提示可能

### 将来構想

- LDAP 認証
- NAS クラスター構成 ([#120](https://github.com/gamasenninn/tealus/issues/120))
- ブロックチェーントークン（感謝経済）設計 ([#83](https://github.com/gamasenninn/tealus/issues/83))

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
