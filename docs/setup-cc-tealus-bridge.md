# Claude Code ↔ Tealus リアルタイム連携 — セットアップ手順 ([#213](https://github.com/gamasenninn/tealus/issues/213) Phase A)

このドキュメントは、Claude Code session が Tealus 上の `@cc-{project}` mention に **ミリ秒単位**で反応する仕組み (file beacon + Monitor パターン) のセットアップ手順です。

## これから何をするか

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ① agent-server 経由で webhook 受信 (前提: setup-ai-agent.md 済) │
│         ↓                                                       │
│   ② @cc-{project} mention を agent-server が filter             │
│         ↓                                                       │
│   ③ ~/.tealus/cc-queue/{project}.jsonl に append                │
│         ↓                                                       │
│   ④ Claude Code session が Monitor で監視                        │
│         ↓                                                       │
│   ⑤ ファイル変化 = sub-second で session が起こされる             │
│         ↓                                                       │
│   ⑥ auto_level (L1/L2/L3) に従って応答                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**所要時間**: 5-10 分 (前提セットアップが済んでいれば)

**前提**:
- README クイックスタート + AI エージェント連携 ([`docs/setup-ai-agent.md`](./setup-ai-agent.md)) を完了している
- agent-server が起動中で webhook 受信できる状態
- Claude Code がインストール済 (`claude` CLI で起動できる)

---

## ステップ 1. agent-server を最新に上げる (~1 分)

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

### ステップ 1.5: 自己ループ防止の env 設定 (任意、defense in depth)

> 💡 **#215 (2026-05-02) 以降**、cc-tealus は `@cc-{project}` を **メッセージの先頭** にある場合のみ match する仕様になりました。AI reply は本文中で mention を引用しても、先頭ではないため自然に skip されます。**この env 設定は基本不要**です。
>
> ただし「文中 mention まで含めて strict に防御したい」場合の defense in depth として、以下の env 設定が利用可能です。

`agent-server/.env` に **`CC_SKIP_SENDER_IDS`** (CSV) を設定すると、指定した sender bot user の UUID からの mention は先頭マッチング判定の前に skip されます。

#### 1.5-1. Claude Code session の bot user UUID を確認

最初に 1 度、Claude Code session で適当に Tealus に message を送信 (例: `mcp__tealus__send_message` で hello 送信) し、レスポンスから `sender_id` を取得:

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

#### 1.5-2. agent-server/.env に追記

`agent-server/.env` の末尾に:

```bash
# cc-queue (Claude Code routing、#213 Phase A) — self-loop prevention
CC_SKIP_SENDER_IDS=b3e292d6-1953-4389-9fba-7e56421a2aef
```

複数 cc bot がある場合は CSV で:

```bash
CC_SKIP_SENDER_IDS=uuid-1,uuid-2,uuid-3
```

#### 1.5-3. agent-server を再起動

env は process 起動時に読み込まれるため、再起動が必要:

```
Ctrl+C   ← 停止
npm run dev   ← 再起動
```

#### 1.5-4. 動作確認

設定が効いているか確認するには:

1. Tealus に `@cc-{project} test` 投稿 (Claude Code session が wake up する想定)
2. session から reply を投稿 (本文に `@cc-{project}` を含めて test)
3. `tail ~/.tealus/cc-queue/{project}.jsonl` で確認 → **自分の reply が含まれていなければ skip 成功** ✅

---

## ステップ 2. プロジェクト側に cc-tealus 設定を作る (~2 分)

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

## ステップ 3. Tealus に Bot をルームに参加させる (~1 分)

cc routing したいルームに **agent-server の Bot ユーザー**を参加させてください。これは agent-server がそのルームの webhook を処理する条件です。

詳細は [`docs/setup-ai-agent.md`](./setup-ai-agent.md) ステップ 6 参照。

---

## ステップ 4. Claude Code session を起動 + listen-tealus skill 実行 (~1 分)

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

## ステップ 5. 動作確認 (~1 分)

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

---

## トラブルシュート

### Q. 自分の reply で自分が再 wake する (無限ループ前段)

→ **`CC_SKIP_SENDER_IDS` env 未設定**が原因。ステップ 1.5 を実施してください。

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
4. **agent-server bot が当該ルームに参加しているか**: 参加してないと webhook が agent-server に届かない (ステップ 3 参照)

### Q. 過去のメッセージが大量に再生される

`.last_processed-{project_name}` watermark file を `~/.tealus/cc-queue/` 以下に置いて msg.id を書き込んでください。session が catch-up 時に参照します。

または `catch_up_policy` を `"skip"` に変更で startup 時に全 skip。

### Q. project_name の規約は?

- 英小文字 / 数字 / ハイフン: `tealus`、`life-line`、`my-prototype-2`
- NG: 大文字、`_` (underscore)、空白、日本語

### Q. 別 PC で動かしている場合は?

file beacon は **agent-server と同じマシン**にあります。別 PC で Claude Code を動かす場合、共有ストレージ (NAS / SMB) で `~/.tealus/cc-queue/` を mount する必要あり (Phase A 想定外、Phase B で network-aware 化検討)。

---

## 関連

- 設計議論 / Phase A 仕様: [#213](https://github.com/gamasenninn/tealus/issues/213)
- agent-server 実装: `agent-server/src/webhook/ccQueue.js` + `handler.js`
- skill 定義: `.claude/skills/listen-tealus.md`
- 設定 schema: `.claude/cc-tealus.json` (`.json.example` から copy)

問題が解決しない場合は [Issue を立ててください](https://github.com/gamasenninn/tealus/issues/new) — 同じ問題に当たる他のユーザーの参考になります 🌱
