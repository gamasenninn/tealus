# AI エージェント連携 — セットアップ手順 (詳細版)

このドキュメントは、Tealus に **AI エージェント (agent-server)** を連携させて、チャット内で `@AI_AGENT` のように呼びかけて AI と対話できる状態にするまでの **完全な手順**です。README 第 6 章の概要を、初めて触る人向けに 1 ステップずつ展開しています。

---

## これから何をするか (全体像)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ① OpenAI API キー取得                                      │
│         ↓                                                   │
│   ② Tealus に Bot ユーザーを作成 (admin ダッシュボード)         │
│         ↓                                                   │
│   ③ agent-server を立ち上げる (Bot として login する process)   │
│         ↓                                                   │
│   ④ admin で webhook 登録 (server → agent-server URL の紐付け) │
│         ↓                                                   │
│   ⑤ Bot ユーザーをルームに招待                                 │
│         ↓                                                   │
│   ⑥ チャット内で @Bot に話しかけると AI が返答                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**所要時間**: 15-20 分 (OpenAI API キー発行待ち時間を除く)

**前提**:
- README のクイックスタート (Step 1-5) を完了している
- server / client が起動していて、admin ユーザーで login できている
- Node.js 20+ + Docker + Docker Compose が動いている

---

## ステップ 1. OpenAI API キーを取得 (~5 分)

agent-server は **OpenAI API** を使って AI 応答を生成します。Light agent (gpt-4o-mini) を使うので **コストはごく少額** (1 メッセージで 0.001 ドル前後)。

1. https://platform.openai.com/api-keys にアクセス → ログイン (アカウント未作成なら sign up)
2. **「+ Create new secret key」** をクリック
3. Name: 任意 (例: `tealus-dev`)
4. 表示された `sk-proj-...` で始まる文字列を **コピーして安全な場所に保存** (画面を閉じると二度と見られません)
5. **Billing 設定**: https://platform.openai.com/account/billing で支払い方法を登録 ($5 程度の prepay で十分)

> 💡 すでに OpenAI API キーを持っている場合はこのステップは skip。

---

## ステップ 2. Tealus に Bot ユーザーを作成 (~3 分)

agent-server は **Bot ユーザー** として Tealus にログインしてチャットに参加します。Bot ユーザーはログイン画面に表示されず、API/webhook から呼ばれる専用アカウントです。

### 2-1. admin ダッシュボードを開く

1. ブラウザで `http://localhost:5173` を開いて **admin ユーザーで login** (Step 5 で作成した最初のユーザー、role が自動で admin になっています)
2. 画面右上のメニュー → **「システム管理」** をクリック (または直接 `http://localhost:3000/system` にアクセス)
3. ダッシュボード画面 → 左サイドバーの **「ユーザー管理」** をクリック

### 2-2. Bot ユーザーを新規作成

1. **「+ 新規ユーザー」** ボタンをクリック
2. フォームを以下のように入力:

   | 項目 | 値 (例) | 備考 |
   |---|---|---|
   | login_id | `AI_AGENT` | agent-server の env で指定する ID |
   | display_name | `AI アシスタント` | チャットでの表示名、好きなものに |
   | password | `<強固なパスワード>` | 12 文字以上推奨、英数記号混在 |
   | role | `user` | (admin にしない、Bot は user 権限で十分) |
   | **Bot ユーザー** | ✅ **ON** | **重要** — このフラグを ON にしないと普通の人間ユーザー扱いになる |

3. **「作成」** をクリック → 一覧に追加されたことを確認

> 💡 password はあとで `agent-server/.env` に書くので **コピーして保存**しておいてください。

---

## ステップ 3. agent-server をセットアップ (~5 分)

### 3-1. 依存をインストール + env をコピー

```bash
cd agent-server
npm install
cp .env.example .env
```

> 💡 `npm install` で `EBADENGINE` エラーが出る場合は Node.js のバージョンが 20 未満。`node --version` を確認、20 未満なら [nvm](https://github.com/nvm-sh/nvm) で 22 を入れ直してください。

### 3-2. `.env` を編集

`agent-server/.env` を text editor で開いて、**以下の項目を必ず埋める**:

```bash
# ---- Tealus API ----
TEALUS_API_URL=http://localhost:3000
TEALUS_BOT_ID=AI_AGENT                    # ← ステップ 2-2 で設定した login_id
TEALUS_BOT_PASS=<ステップ 2-2 のパスワード>  # ← ステップ 2-2 で設定したパスワード

# ---- JWT (server/.env と同じ値) ----
JWT_SECRET=<server/.env の JWT_SECRET と完全一致させる>

# ---- Database (server と同じ Postgres を使う) ----
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tealus
DB_USER=tealus
DB_PASSWORD=<server/.env の DB_PASSWORD と同じ>

# ---- OpenAI ----
OPENAI_API_KEY=sk-proj-...                # ← ステップ 1 でコピーした API キー
```

> ⚠️ `JWT_SECRET` は **絶対に server/.env と一致**させてください。違うと「Bot login failed: invalid token」で起動しません。

> 💡 他の項目 (AGENT_PORT、AIVIS_API_KEY 等) は default のままで OK。Aivis Cloud TTS を使いたい場合のみ AIVIS_API_KEY を設定。

> 💡 **`AGENT_WORKSPACE_ROOT` (default `./agent-workspaces`) は事前作成不要**。session state / ルーム別設定 / エージェントメモリ / TTS キャッシュは agent-server が初回アクセス時に `mkdir -p` で自動生成します。default のまま放置で OK。

### 3-3. agent-server を起動

```bash
npm run dev
```

成功すると以下のログが出ます:

```
Agent Server started on port 4000
[Bot Login] Logged in as AI_AGENT (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
```

> ⚠️ `Bot login failed` で止まる場合は **TEALUS_BOT_PASS** または **JWT_SECRET** の不一致。.env を見直してください。

> 💡 ターミナルを閉じると停止します。常時起動したい場合は別ターミナルで起動するか、後述の本番運用 (systemd / docker compose) を使ってください。

---

## ステップ 4. Webhook を登録する (~3 分) ⚠️ **必須**

agent-server は server から **Webhook イベント** (POST `/webhook/tealus`) を受け取って AI 応答を生成します。**この登録をしないと Bot がチャットメッセージを認識できません** (= setup したのに反応しない、という新規ユーザーが詰まる定番ポイント)。

### 4-1. admin ダッシュボードで Webhook を登録

1. `http://localhost:5173` で admin login → 「システム管理」 → 左サイドバーの **「Webhook 管理」**
2. **「+ 新規 Webhook」** をクリック
3. フォームを以下のように入力:

   | 項目 | 値 | 備考 |
   |---|---|---|
   | URL | `http://localhost:4000/webhook/tealus` | agent-server の listen URL + `/webhook/tealus` path |
   | events | `message.created` (default) | これだけで対話 OK、後から `voice.transcription_completed` / `reaction.added` 等を追加可能 |
   | room_id | 空 | 全ルーム共通。特定ルームに限定したい場合のみ選択 |
   | secret | 空 (or 任意の文字列) | 本番では HMAC 検証用に設定推奨、dev では空でも動く |
   | is_active | ✅ ON | デフォルト ON |

4. **「作成」** をクリック → 一覧に追加されたことを確認

### 4-2. テスト送信で疎通確認

webhook 一覧の作成した行で **「テスト送信」** ボタンをクリック → status `200` が返れば agent-server 側で受信成功 ✅。

agent-server のターミナルログにも以下のような line が出るはず:

```
[Webhook] Received event: test
```

> 💡 events は配列で複数指定可能。`message.created` で対話、`voice.transcription_completed` で音声起こし完了通知、`member.joined` で Bot 参加検知、`reaction.added` でリアクション拾い、など。**まず `message.created` だけで動かしてから後で追加**するのが安全。

> ⚠️ **本番環境** (Docker compose.full / NAS デプロイ) では URL を `http://localhost:4000` ではなく **agent-server のコンテナ名** (例: `http://agent-server:4000/webhook/tealus`) にする必要があります。Docker network 内では `localhost` は各コンテナ自身を指すため。

> ⚠️ webhook を登録したのに「テスト送信」が `502` 等で失敗する場合は、ステップ 3 で agent-server がちゃんと起動しているか確認してください (`curl http://localhost:4000/health` で `200` が返るはず)。

---

## ステップ 5. 起動確認 (~2 分)

### 5-1. agent-server の health check

別ターミナルで:

```bash
curl http://localhost:4000/health
```

成功すると JSON が返ります (例: `{"status":"ok","version":"0.2.1"}`)。

### 5-2. ブラウザで Bot がオンラインなのを確認

1. `http://localhost:5173` で admin login
2. 左の友だちリスト (またはユーザー検索) に `AI アシスタント` (display_name) が出ていれば OK

---

## ステップ 6. Bot をルームに参加させる (~2 分)

Bot は **ルームに招待されないと反応しません**。1 対 1 DM か、グループルームに参加させる必要があります。

### 方法 A: 1 対 1 DM (一番簡単、お試し向け)

1. ブラウザの友だち一覧から **`AI アシスタント`** をクリック → DM ルームが自動で作成される
2. **以後はそのルームでメッセージを送るだけで AI が返答**

### 方法 B: グループルームに招待

1. 左サイドバー上部の **「+ 新規ルーム」** → グループ名を入力 (例: `AI 相談室`)
2. ルーム作成後、ルーム設定 (右上の歯車アイコン) → **「メンバー追加」**
3. `AI アシスタント` を選択 → 追加

> 💡 グループルームに人間 + Bot がいる場合、**`@AI アシスタント` で mention した時だけ Bot が反応**するようになっています (mention されないと黙っている)。

---

## ステップ 7. AI と対話する (~1 分)

### 7-1. テストメッセージ

DM ルームで以下のようなメッセージを送ってみる:

```
こんにちは。あなたについて教えて
```

数秒以内に Bot が返答すれば成功 ✅。

### 7-2. 返答が来ない場合のチェック

| 症状 | 確認ポイント |
|---|---|
| 「メッセージが既読にならない」 | agent-server のターミナルログを確認、エラー出てる? |
| Bot が黙っている | グループルーム = mention (`@AI`) してるか? DM では不要 |
| 「OpenAI rate limit」エラー | OpenAI dashboard で billing 残高を確認 |
| 「Bot login failed」 | server / agent-server の `JWT_SECRET` 一致確認 |
| 「ECONNREFUSED localhost:3000」 | server (port 3000) が起動しているか確認 |

---

## ステップ 8. (任意) ルームごとのカスタマイズ

### 8-1. system prompt をルームごとに設定

ダッシュボード → ルーム設定 → **「エージェント設定」** で、ルームごとに以下をカスタマイズできます:

- **応答モード**: Light / Deep / Auto (Router)
- **system prompt**: そのルームでの Bot の役割や口調 (例: 「経理の質問に答える」「日本語で短く答える」)
- **TTS 音声モデル**: ルームごとに別の声を割り当てる (Aivis Cloud TTS 利用時)

### 8-2. ルーム単位の MCP 接続

ルーム設定 → **「MCP 設定」** で、そのルームで有効にする MCP server (filesystem / web search / Tealus 自身など) を選べます。`agent-server/mcp_config.json` で利用可能な MCP を定義してから、UI でルームごとに ON/OFF します。

---

## 次のステップ (任意)

| やりたいこと | 必要なもの | 参照 |
|---|---|---|
| 通話 / トランシーバーを使いたい | `rtc-server` を起動 | README 第 6-3 章 |
| AI 応答を音声で読み上げてほしい (高品質) | Aivis Cloud API キー → `AIVIS_API_KEY` を agent-server/.env に設定 | README 第 6-3 章 |
| AI 応答を音声で読み上げてほしい (簡易) | Browser TTS は default で ON、設定不要 | — |
| コーディング系の long-running タスクを AI に任せたい (Deep agent) | `claude` CLI (Claude MAX 契約) を install | README 第 6-2 章 |
| Bot を別マシンで動かしたい (NAS 運用) | Docker compose `docker-compose.full.yml` を使う | README 「Docker デプロイ」章 |

---

## トラブルシュート (ステップ 7 以外の問題)

### Q. `Bot login failed: User not found`

→ Bot ユーザーの **login_id** と `.env` の `TEALUS_BOT_ID` が一致していない。ダッシュボードで login_id を確認、`.env` を修正、agent-server を再起動。

### Q. `Bot login failed: Invalid credentials`

→ Bot ユーザーの **password** と `.env` の `TEALUS_BOT_PASS` が一致していない。ダッシュボードで password reset → `.env` を修正、agent-server を再起動。

### Q. `JsonWebTokenError: invalid signature`

→ server と agent-server の `JWT_SECRET` が違う。両方の `.env` で完全一致させる、両プロセスを再起動。

### Q. agent-server は起動するが Bot がメッセージに反応しない

頻度順に確認:

1. **Webhook が登録されていない** (← 一番多い原因) → admin ダッシュボード → Webhook 管理 で `http://localhost:4000/webhook/tealus` の行が **is_active=ON** で存在するか確認。無ければステップ 4 を実施
2. **Webhook の URL が間違っている** → 「テスト送信」で 200 が返るか確認 (502 や接続エラーなら URL or agent-server 起動状態を見直す)
3. **Bot がそのルームに参加していない** → ルーム設定 → メンバー一覧で確認
4. **グループルームで mention していない** → `@AI アシスタント` のように `@` でメンションする (DM では mention 不要)
5. **OPENAI_API_KEY が未設定 or 不正** → agent-server のログに「OpenAI ...」というエラー、または「OPENAI_API_KEY is not set」の diagnostic が出ているはず
6. **events に `message.created` が含まれていない** → Webhook 編集で events を確認

### Q. 「Bot ユーザー」フラグを ON にし忘れた

→ ダッシュボード → ユーザー管理 → 該当ユーザー → 編集 で **「Bot ユーザー」を ON** に変更 → 保存。

---

## 参考

- [agent-server/.env.example](../agent-server/.env.example) — env 変数の完全な list と説明
- [README 第 6 章](../README.md#6-ai-エージェント通話機能を有効化推奨) — 概要と Tier 1/2 の説明
- [docs.tealus.dev](https://docs.tealus.dev) — 公式ドキュメントサイト (より深い architecture / API リファレンス)

問題が解決しない場合は [Issue を立ててください](https://github.com/gamasenninn/tealus/issues/new) — 同じ問題の他のユーザーの参考になります 🌱
