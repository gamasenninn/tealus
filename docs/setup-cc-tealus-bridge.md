# Claude Code ↔ Tealus 双方向連携 — セットアップ手順

このドキュメントは、Claude Code session を **Tealus の一員として双方向に動かす**ための統合セットアップ手順です。

## 双方向の連携とは

| 方向 | 仕組み | 用途 |
|---|---|---|
| **Outbound** (Claude Code → Tealus) | [tealus-mcp](https://github.com/gamasenninn/tealus-mcp) 経由で Bot API を MCP ツール化 | session から `mcp__tealus__send_message` 等で Tealus に送信、検索、ルーム作成・削除など |
| **Inbound** (Tealus → Claude Code) | cc-tealus bridge ([#213](https://github.com/gamasenninn/tealus/issues/213) Phase A、file beacon + Monitor) | Tealus 上の `@cc-{project}` mention でミリ秒単位で session を起こす |

両方をセットアップすると、Claude Code session が **Tealus 上の能動的なメンバー**として振る舞えるようになります。「session が Tealus でメッセージを書く」「Tealus でユーザーが session を呼ぶ」が両方 1 つの操作 fabric として機能します。

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   Outbound (この文書 Part 1)                                      │
│     Claude Code session                                          │
│         ↓ tealus-mcp (MCP tool 11 個)                             │
│     Tealus Bot API                                               │
│         ↓                                                        │
│     Tealus DB / room broadcast                                   │
│                                                                  │
│   Inbound (この文書 Part 2、#213 Phase A)                          │
│     Tealus メッセージ送信                                          │
│         ↓ webhook                                                │
│     agent-server                                                 │
│         ↓ @cc-{project} mention を filter                        │
│     ~/.tealus/cc-queue/{project}.jsonl に append                 │
│         ↓                                                        │
│     Claude Code session の Monitor (`tail -F`)                   │
│         ↓ sub-second wake-up                                     │
│     auto_level (L1/L2/L3) に従って応答                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**所要時間**: 10-15 分 (前提セットアップが済んでいれば)

**前提**:
- Tealus 本体 + agent-server が起動中 (README クイックスタート + [`docs/setup-ai-agent.md`](./setup-ai-agent.md) 完了)
- Claude Code がインストール済 (`claude` CLI で起動できる)
- agent-server bot ユーザが Tealus に存在する (`/admin` で確認可)

---

# Part 1: Outbound — tealus-mcp で Claude Code から Tealus へ送信できるように

## ステップ 1A. Bot ユーザを準備する (~2 分)

tealus-mcp は Tealus 上の **bot ユーザのアカウントで API を呼ぶ**ため、専用 bot ユーザが必要です。

### 既存の AI_AGENT bot を流用する場合 (推奨)

setup-ai-agent.md で作った agent-server bot をそのまま使えます。`agent-server/.env` の `TEALUS_BOT_ID` と `TEALUS_BOT_PASS` を memo:

```bash
grep -E "TEALUS_(BOT_ID|BOT_PASS)" agent-server/.env
```

### Claude Code 専用 bot を別に作る場合

agent-server bot とは別の bot ユーザを Tealus 管理画面 (`/admin`) で作成し、login_id とパスワードを記録します。**Claude Code session を独立した「メンバー」として識別したい場合**はこちら。今日 (2026-05-02) 時点では同一 bot 流用で問題なし。

## ステップ 2A. Claude Code に tealus-mcp を登録する (~3 分)

Claude Code の MCP 設定ファイル (`~/.claude.json` または同等の場所) に以下を追加:

```json
{
  "mcpServers": {
    "tealus": {
      "command": "npx",
      "args": ["-y", "github:gamasenninn/tealus-mcp"],
      "env": {
        "TEALUS_API_URL": "http://localhost:3000",
        "TEALUS_USER_ID": "AI_AGENT",
        "TEALUS_PASSWORD": "your-bot-password"
      }
    }
  }
}
```

各環境変数:

| 変数 | 必須 | 説明 |
|---|---|---|
| `TEALUS_API_URL` | × | Tealus サーバの URL (default: `http://localhost:3000`) |
| `TEALUS_USER_ID` | ○ | bot ユーザの login_id (旧 `TEALUS_BOT_ID` も互換) |
| `TEALUS_PASSWORD` | ○ | bot ユーザのパスワード (旧 `TEALUS_BOT_PASS` も互換) |

> 💡 **`npx -y github:gamasenninn/tealus-mcp`** は GitHub repo から直接 pull する方式 (npm registry 非経由)。初回起動時に取得 → 以後は npm キャッシュから起動。最新版 (v0.7.0 時点) を強制 pull したい場合は `npx clear-npx-cache` 後に Claude Code 再起動。

> ⚠️ **`gamasenninn` 名義の GitHub repo を信頼する前提**で `-y` flag を付けています。社内運用で source を完全に固定したい場合は repo を fork → 自社 GitHub URL に書き換えてください。

## ステップ 3A. Claude Code を再起動 (~1 分)

設定ファイル変更後、MCP server を pickup させるため Claude Code を再起動:

```bash
# 現在の session を Ctrl+C で停止 → 再起動
claude
```

## ステップ 4A. 動作確認 — outbound (~1 分)

Claude Code session 内で:

```
@tealus list_rooms
```

または直接 tool 呼び出し:

```
mcp__tealus__list_rooms を実行
```

参加中の Tealus ルーム一覧が返ってきたら成功 ✅。

メッセージ送信もテスト:

```
mcp__tealus__send_message で room_id=<実際の room id>、content="hello from Claude Code" を送信
```

Tealus 上で当該ルームに bot からの「hello from Claude Code」が見えれば outbound 完了。

## ステップ 5A. (任意) HTTP transport で接続する — cross-machine 構成 (v0.12.0+) 🌟

採用者環境で **agent-server (Tealus 本体) と Claude Code が別マシン** に居る場合、stdio transport は使えない (child process spawn が成立しない)。代わりに **HTTP transport** を使う ([#264](https://github.com/gamasenninn/tealus/issues/264) Phase 1 alpha、tealus-mcp v0.12.0+)。

### 構成

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

JWT_SECRET は **Tealus 本体 server / agent-server / tealus-mcp の 3 process で完全同値** にする (proxy で pass-through、検証は tealus-mcp 側で fail-fast 401)。

### 5A-1. Tealus host で tealus-mcp HTTP server を起動

Tealus 本体と同マシンで tealus-mcp を **HTTP mode** で立ち上げる:

```bash
cd /path/to/tealus-mcp     # repo を clone してから
npm install

# .env を作成 (.env.example をコピー)
cp .env.example .env
# .env を編集して以下を埋める:
#   TEALUS_USER_ID=<bot user id>
#   TEALUS_PASSWORD=<bot password>
#   JWT_SECRET=<Tealus 本体と同値>
#   MCP_HTTP_PORT=3200

# HTTP mode で起動
node src/index.js --transport=http
```

期待出力:

```
[tealus-mcp] HTTP transport listening on :3200
[tealus-mcp] POST /mcp (JWT required), GET /health (no auth)
```

production 運用では systemd / docker compose / pm2 等で daemonize 推奨。

### 5A-2. Tealus 本体側で `/mcp` proxy が動いているか確認

Tealus 本体 server (port 3000) は `/mcp/*` を内部 port 3200 に転送する proxy を持つ ([#264](https://github.com/gamasenninn/tealus/issues/264))。reachability check:

```bash
curl http://<tealus-host>:3000/mcp/health
# 期待: {"status":"ok","transport":"http","server":"tealus-mcp"}
```

### 5A-3. JWT を発行 (Claude Code config 用)

Tealus 本体と同じ `JWT_SECRET` を使って、長寿命 JWT を発行 (例: 30 日 expiry):

```bash
cd /path/to/tealus-mcp
node -e "require('dotenv').config(); console.log(require('jsonwebtoken').sign({userId:'claude-code-mcp'}, process.env.JWT_SECRET, {expiresIn:'30d'}))"
```

出力された JWT (eyJ... の長い文字列) をコピー。

### 5A-4. `~/.claude.json` に url-based entry を追加

ステップ 2A の stdio entry **に加えて**、HTTP 用 entry を並列追加 (project 単位の `mcpServers` block):

```json
{
  "projects": {
    "C:/path/to/your/project": {
      "mcpServers": {
        "tealus": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "github:gamasenninn/tealus-mcp"],
          "env": { "TEALUS_API_URL": "...", "TEALUS_USER_ID": "...", "TEALUS_PASSWORD": "..." }
        },
        "tealus-http": {
          "type": "http",
          "url": "https://<your-tealus-host>/mcp",
          "headers": {
            "Authorization": "Bearer <ステップ 5A-3 で発行した JWT>"
          }
        }
      }
    }
  }
}
```

> 💡 既存 stdio entry を残したまま並列追加すれば、両 transport を比較しながら dogfood 可能。HTTP path に切り替え完了したら stdio entry を削除する流れ。

### 5A-5. Claude Code を再起動して動作確認

```bash
claude  # 既存 session を Ctrl+C → 再起動
```

session 内で:

```
/mcp
```

server 一覧に **`tealus-http · ✔ connected · 15 tools`** と表示されれば成功。実呼び出し:

```
@tealus-http list_rooms を使って参加 room を一覧して
```

stdio (`@tealus list_rooms`) と同じ結果が返れば transport 透明性が確認できる (Phase 1 alpha 動作確認の頂点)。

### 5A 注意事項

- **scope**: Phase 1 alpha は HTTP request/response (tools 呼び出し) のみ。Tealus → Claude Code への mention 通知 (cc-tealus bridge wake-up) は **stdio + file beacon 経路に依存** (Part 2 参照)。Phase 2 で SSE event broker (server-push wake-up) が乗るまで、**HTTP + cc-tealus 併用構成** が当面の現実解。
- **stdio との関係**: stdio は v0.12.0+ でも維持、既存採用者環境は無変更で動く。HTTP は **opt-in** (`--transport=http` flag、JWT_SECRET 設定)。
- **公開**: tealus host を public expose する場合は HTTPS / reverse proxy (nginx 等) で TLS 終端必須。`<JWT>` は適切な expiry で運用、漏洩時は `JWT_SECRET` rotate で全 token 失効。
- **詳細**: [tealus-mcp README v0.12.x](https://github.com/gamasenninn/tealus-mcp#http-transport-リモート利用-v0120) 参照。

## 提供される 11 個の MCP tool

[tealus-mcp v0.7.0 時点](https://github.com/gamasenninn/tealus-mcp):

| Tool | 用途 |
|---|---|
| `send_message` | ルームにテキストメッセージ送信 |
| `send_image` | ルームに画像送信 (base64) |
| `get_messages` | ルームのメッセージ履歴取得。voice transcription は default で `formatted_text` のみ inline (`include_raw=true` / `include_transcription=false` で verbosity 制御、v0.7.0〜) |
| `get_message_media` | メッセージのメディア取得 (画像は AI 直接視認可、音声は文字起こし優先) |
| `search_messages` | キーワード / タグ / 期間 / 発言者でメッセージ全文検索 |
| `mark_tag_done` | メッセージのタグ完了状態 (is_done) 更新 |
| `create_room` | 新しいグループルーム作成 (bot は admin で自動追加) |
| `delete_room` | グループルーム削除 (creator + solo member のみ) |
| `list_rooms` | 参加中ルーム一覧 |
| `join_room` | ルームに参加 |
| `mark_read` | 既読化 |

詳細は [tealus-mcp README](https://github.com/gamasenninn/tealus-mcp#readme) 参照。

---

# Part 2: Inbound — cc-tealus bridge で Tealus から Claude Code へ wake-up できるように

このパートは [#213](https://github.com/gamasenninn/tealus/issues/213) Phase A の実装。「Tealus 上で `@cc-{project}` mention されると、Claude Code session が **ミリ秒単位** で wake up する」仕組み。

## ステップ 1B. agent-server を最新に上げる (~1 分)

cc-queue 機能は **Tealus v0.2.x の agent-server 以降**で利用可能。

```bash
cd ~/tealus
git pull origin main
cd agent-server && npm install
```

すでに最新を pull していれば skip。

agent-server を再起動:

```bash
cd agent-server
npm run dev
```

起動ログに以下が出ていれば OK (`#213` related の error が無いこと):

```
Agent Server started on port 4000
[Bot Login] Logged in as AI_AGENT
```

### ステップ 1.5B: 自己ループ防止の env 設定 (任意、defense in depth)

> 💡 **#215 (2026-05-02) 以降**、cc-tealus は `@cc-{project}` を **メッセージの先頭** にある場合のみ match する仕様になりました。AI reply は本文中で mention を引用しても、先頭ではないため自然に skip されます。**この env 設定は基本不要**です。
>
> ただし「文中 mention まで含めて strict に防御したい」場合の defense in depth として、以下の env 設定が利用可能です。

`agent-server/.env` に **`CC_SKIP_SENDER_IDS`** (CSV) を設定すると、指定した sender bot user の UUID からの mention は先頭マッチング判定の前に skip されます。

#### 1.5B-1. Claude Code session の bot user UUID を確認

Part 1 で outbound 確認した時の `mcp__tealus__send_message` レスポンスから `sender_id` を取得:

```json
{
  "message": {
    "id": "...",
    "sender_id": "b3e292d6-1953-4389-9fba-7e56421a2aef",
    ...
  }
}
```

この `sender_id` の UUID をメモします。

#### 1.5B-2. agent-server/.env に追記

`agent-server/.env` の末尾に:

```bash
# cc-queue (Claude Code routing、#213 Phase A) — self-loop prevention
CC_SKIP_SENDER_IDS=b3e292d6-1953-4389-9fba-7e56421a2aef
```

複数 cc bot がある場合は CSV で:

```bash
CC_SKIP_SENDER_IDS=uuid-1,uuid-2,uuid-3
```

#### 1.5B-3. agent-server を再起動

env は process 起動時に読み込まれるため、再起動が必要:

```
Ctrl+C   ← 停止
npm run dev   ← 再起動
```

#### 1.5B-4. 動作確認

設定が効いているか確認するには:

1. Tealus に `@cc-{project} test` 投稿 (Claude Code session が wake up する想定)
2. session から reply を投稿 (本文に `@cc-{project}` を含めて test)
3. `tail ~/.tealus/cc-queue/{project}.jsonl` で確認 → **自分の reply が含まれていなければ skip 成功** ✅

---

## ステップ 2B. プロジェクト側に cc-tealus 設定を作る (~2 分)

Claude Code を使いたいプロジェクトのルートで:

```bash
cd ~/your-project
cp .claude/cc-tealus.json.example .claude/cc-tealus.json
```

> 💡 `.claude/cc-tealus.json.example` がプロジェクトに無い場合は手動作成。Tealus 本体 repo にあるサンプルをコピーしてください。

`.claude/cc-tealus.json` を編集:

```json
{
  "project_name": "tealus",
  "auto_level": "L2",
  "queue_path": "~/.tealus/cc-queue/tealus.jsonl",
  "catch_up_policy": "ask"
}
```

各フィールドの意味:

| field | 役割 | 値の選び方 |
|---|---|---|
| **project_name** | file beacon の suffix (`{project}.jsonl`) | プロジェクト識別子。**英小文字 / 数字 / ハイフン**のみ。例: `"tealus"`、`"life-line"` |
| **auto_level** | 応答の自動化度合い | **`"L2"` 推奨** (suggest reply、user が承認/編集)。`"L1"` = 通知のみ、`"L3"` = 自動 reply (信頼できる FAQ 等のみ) |
| **queue_path** | file beacon の path | default は `~/.tealus/cc-queue/{project_name}.jsonl`。明示しても OK |
| **catch_up_policy** | session 起動時の未処理メッセージ扱い | **`"ask"` 推奨** (interactive 提示)。`"all"` / `"skip"` / `"recent:4h"` 等も指定可 |

> ⚠️ `.claude/cc-tealus.json` は **gitignore 推奨**。プロジェクトごとに user が個別に作る (Tealus 本体 repo の `.gitignore` には追加済)。

---

## ステップ 3B. Tealus に Bot をルームに参加させる (~1 分)

cc routing したいルームに **agent-server の Bot ユーザー**を参加させてください。これは agent-server がそのルームの webhook を処理する条件です。

詳細は [`docs/setup-ai-agent.md`](./setup-ai-agent.md) ステップ 6 参照。

> 💡 Part 1 の tealus-mcp で `mcp__tealus__join_room` を Claude Code から実行することでも参加可能。

---

## ステップ 3.5B. listen-tealus skill ファイルを配置 (~1 分)

`/listen-tealus` を実行できるようにするには、skill 定義ファイル (`listen-tealus.md`) を Claude Code が読める場所に置く必要があります。

> 💡 **これは「インストール」ではなくただの**ファイルコピーです。Claude Code の skill は `npm install` 等のパッケージ管理ではなく、特定の場所にある markdown ファイルを起動時に scan する仕組み。

Claude Code は以下 2 つの場所を skill として scan:

| 場所 | scope |
|---|---|
| `~/.claude/skills/<name>.md` | **ユーザー単位** (どのプロジェクトでも有効、推奨) |
| `<project>/.claude/skills/<name>.md` | **プロジェクト単位** (そのディレクトリで `claude` 起動時のみ有効) |

### 案 A: ユーザー単位で配置 (推奨)

```bash
mkdir -p ~/.claude/skills/
cp ~/tealus/.claude/skills/listen-tealus.md ~/.claude/skills/
```

これで全プロジェクトの Claude Code session で `/listen-tealus` が使えるようになります。

### 案 B: プロジェクト単位で配置

特定プロジェクトでのみ使いたい場合:

```bash
mkdir -p ~/your-project/.claude/skills/
cp ~/tealus/.claude/skills/listen-tealus.md ~/your-project/.claude/skills/
```

> 💡 **Tealus repo 自身**で使う場合は `.claude/skills/listen-tealus.md` が既に commit 済 = **この step は skip**。`cd ~/tealus && claude` で起動するだけで `/listen-tealus` が使える状態です。

### 動作確認

```bash
cd ~/your-project   # or ~/tealus
claude
```

session 内で:

```
利用可能な skill 一覧
```

返ってきた一覧に `listen-tealus` があれば配置成功 ✅。

---

## ステップ 4B. Claude Code session を起動 + listen-tealus skill 実行 (~1 分)

```bash
cd ~/your-project
claude
```

session 内で以下のように頼む:

```
/listen-tealus
```

または skill を invoke しなくても:

```
listen-tealus skill を実行して、Tealus からの mention を待機して
```

私 (Claude) が:

1. `.claude/cc-tealus.json` を読む
2. catch-up 確認 (未処理あれば policy に従い対応)
3. `tail -n 0 -F ~/.tealus/cc-queue/tealus.jsonl` を Monitor で arm
4. 「🟢 Tealus listening (project: tealus, auto_level: L2)」と報告

これで session は **新着 mention で起こされる状態**に入ります。user は別の作業をしててもいいし、session を雑談に使ってもいい。

---

## ステップ 5B. 動作確認 — inbound (~1 分)

別の Tealus ユーザーから (or 自分の別 user で) どこかのルーム (Bot が参加してる room) で投稿:

```
@cc-tealus これ進捗教えて
```

> ⚠️ **重要**: `@cc-{project}` は **メッセージの先頭** に書いてください (#215 以降の仕様)。例えば `これ見て @cc-tealus` のような文中 mention は **無効** です (改行直後の `@cc-{project}` は OK、行頭扱い)。

数秒以内に Claude Code session に通知が出れば成功 ✅:

```
📨 新着 from 田中太郎 (room: 開発)
   "@cc-tealus これ進捗教えて"

[reply 案]
   v0.2.1 release 完了、#212 monitoring 中、#213 Phase A 実装中...

[OK] [編集] [スキップ]
```

session が L2 で reply 案を作り、`OK` で送信されるとき、内部的には Part 1 で setup した `mcp__tealus__send_message` が使われます。**Outbound と Inbound が 1 cycle で繋がる瞬間** です。

---

# Part 3: 統合動作確認 — 1 cycle 全部回す

両方向が動いている状態で、以下を試して 1 cycle 完走できれば setup 完了:

1. **Tealus 上で Bot 参加ルームに投稿**: `@cc-tealus 今日のテスト案件、AI 班連絡で軽く議論しといて`
2. **Claude Code session が wake up** (sub-second)
3. **session が文脈を理解** (現在の git 状態 / 開いた issue 等を踏まえて reply 案生成)
4. **L2 で user 確認** → OK
5. **session が `mcp__tealus__send_message` で AI 班連絡ルームに自動投稿**
6. Tealus 上で AI 班連絡に「[本体班] @ドキュメント班 ...」のような broadcast が現れる
7. session が必要に応じて `mcp__tealus__create_room` で新ルーム編成、`mcp__tealus__mark_tag_done` で TODO 完了マーク等を能動的に実行

これで **「Claude Code が Tealus 上の能動的なメンバー」** として動く状態が確立します。

# トラブルシュート

## Outbound 系 (tealus-mcp)

### Q. `@tealus list_rooms` で「tool が見つからない」と言われる

→ MCP server の登録ミス。確認順:

1. `~/.claude.json` (or 設定ファイル) の JSON が valid か (構文エラーで全 MCP が読まれない可能性)
2. `mcpServers.tealus.command` が `npx`、`args` が `["-y", "github:gamasenninn/tealus-mcp"]` か
3. Claude Code を再起動したか (設定変更は再起動必須)
4. `npx clear-npx-cache` 後に再起動 (古い tealus-mcp が cache されてる可能性)

### Q. `Bot login failed` のエラー

→ `TEALUS_USER_ID` / `TEALUS_PASSWORD` が間違っているか、Tealus server が起動してない。確認:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login_id":"AI_AGENT","password":"your-bot-password"}'
```

`token` が返れば credentials OK、404 / 401 なら password 確認。`Connection refused` なら Tealus server が起動してない。

### Q. v0.7.0 の新 flag (`include_raw` / `include_transcription`) が使えない

→ npx の cache が古い v0.6.0 を使っている可能性。`npx clear-npx-cache` 後に Claude Code 再起動。

## Inbound 系 (cc-tealus bridge)

### Q. `/listen-tealus` skill が見つからない / 認識されない

→ skill 定義ファイル (`listen-tealus.md`) が Claude Code の scan 対象パスに置かれていない。確認:

```bash
# ユーザー単位 (推奨)
ls ~/.claude/skills/listen-tealus.md

# プロジェクト単位
ls .claude/skills/listen-tealus.md
```

どちらも無ければステップ 3.5B を実施。配置後は **Claude Code を再起動**して下さい (起動時に scan するため)。

### Q. 自分の reply で自分が再 wake する (無限ループ前段)

→ #215 以降は **メッセージ先頭マッチング**で自然 skip されるはず。それでも起きる場合は **`CC_SKIP_SENDER_IDS` env 未設定**が原因。ステップ 1.5B を実施してください。

確認方法:

```bash
tail -n 5 ~/.tealus/cc-queue/{project}.jsonl
```

自分の bot UUID (sender_id) が末尾に append されてたら fix 必要。env 設定 + agent-server 再起動後、同じ操作で **自分の reply が file に append されない**ことを確認。

### Q. mention 投稿しても session が反応しない

確認順:

1. **agent-server のログに `[cc-queue] Routed @cc-...` が出ているか**
   - YES → file beacon は書けてる、問題は Claude Code 側
   - NO → agent-server が webhook を受信していないか、project 名が typo
2. **`~/.tealus/cc-queue/{project}.jsonl` に行が追加されているか**
   - `tail -n 5 ~/.tealus/cc-queue/tealus.jsonl`
3. **Monitor が armed か**: Claude Code session で TaskList を実行
4. **agent-server bot が当該ルームに参加しているか**: 参加してないと webhook が agent-server に届かない (ステップ 3B 参照)

### Q. 過去のメッセージが大量に再生される

`.last_processed-{project_name}` watermark file を `~/.tealus/cc-queue/` 以下に置いて msg.id を書き込んでください。session が catch-up 時に参照します。

または `catch_up_policy` を `"skip"` に変更で startup 時に全 skip。

### Q. project_name の規約は?

- 英小文字 / 数字 / ハイフン: `tealus`、`life-line`、`my-prototype-2`
- NG: 大文字、`_` (underscore)、空白、日本語

### Q. 別 PC で動かしている場合は?

file beacon は **agent-server と同じマシン**にあります。別 PC で Claude Code を動かす場合、共有ストレージ (NAS / SMB) で `~/.tealus/cc-queue/` を mount する必要あり (Phase A 想定外、Phase B で network-aware 化検討、[#214](https://github.com/gamasenninn/tealus/issues/214))。

### Q. `@cc-tealus` 以外の自然な mention 名で呼びたい (例: `@Claude`)

[#263](https://github.com/gamasenninn/tealus/issues/263) で追加した **alias 機能** を使う。`agent-server/config/cc-aliases.json` に entry を追加:

```json
{
  "aliases": [
    { "mention": "Claude", "project": "tealus" },
    { "mention": "AI", "project": "tealus" },
    { "mention": "Helper", "project": "proj1" }
  ]
}
```

各 entry:
- `mention`: chat で使う display name (例: "Claude")。case-insensitive、word boundary で誤 match 回避
- `project`: 書込先 cc-queue project (= jsonl ファイル名)

**特徴**:
- code 変更不要、config file 編集だけで alias 追加可能
- agent-server 再起動で反映 (or admin 経由で reload)
- 行頭 only、`@cc-{project}` と同 stance (#215 自己ループ防止と整合)
- bot user (`is_bot=true`) を Tealus 側に作成して mention picker に表示させる必要あり (alias は単に dispatcher の routing rule、bot user 自体は別途登録)

---

# 関連

## 設計 / 実装

- 設計議論 / Phase A 仕様: [#213](https://github.com/gamasenninn/tealus/issues/213)
- 先頭マッチング (#215) self-loop 防止: [#215](https://github.com/gamasenninn/tealus/issues/215)
- transcription verbosity 制御 (v0.7.0): [#219](https://github.com/gamasenninn/tealus/issues/219) / [tealus-mcp #1](https://github.com/gamasenninn/tealus-mcp/issues/1)
- Phase B 展望 (multi-session lock / network-aware 等): [#214](https://github.com/gamasenninn/tealus/issues/214)

## 内部実装

- agent-server cc-queue: `agent-server/src/webhook/ccQueue.js` + `handler.js`
- listen-tealus skill: `.claude/skills/listen-tealus.md`
- 設定 schema: `.claude/cc-tealus.json` (`.json.example` から copy)

## 外部 repo

- [tealus-mcp](https://github.com/gamasenninn/tealus-mcp) — MCP package
- [tealus-mcp v0.7.0 release](https://github.com/gamasenninn/tealus-mcp/releases/tag/v0.7.0)

問題が解決しない場合は [Issue を立ててください](https://github.com/gamasenninn/tealus/issues/new) — 同じ問題に当たる他のユーザーの参考になります 🌱
