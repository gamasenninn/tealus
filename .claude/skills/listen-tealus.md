---
name: listen-tealus
description: Tealus からのリアルタイム mention を Monitor で待機する。`@cc-{project}` 宛のメッセージが届いたら即起こされ、auto_level に従って応答する。
---

# listen-tealus

agent-server (#213 Phase A) が file beacon に append する `~/.tealus/cc-queue/{project}.jsonl` を Monitor で監視し、新着 `@cc-{project}` mention に対して設定された auto_level で応答する skill。

## 前提

- **agent-server** が起動済み (webhook 受信 + `src/webhook/ccQueue.js` 経由の routing が有効)
- このプロジェクトに **`.claude/cc-tealus.json`** が存在する (`.claude/cc-tealus.json.example` から copy + 編集)

## 手順

### 1. 設定読み込み

`.claude/cc-tealus.json` を Read。schema:

| field | 必須 | 例 / default |
|---|---|---|
| `project_name` | ✅ | `"tealus"` (file beacon の suffix) |
| `queue_path` | 任意 | `"~/.tealus/cc-queue/tealus.jsonl"` (default は project_name から計算) |
| `auto_level` | 任意 | `"L2"` (default) — `L1` / `L2` / `L3` |
| `catch_up_policy` | 任意 | `"ask"` (default) — `ask` / `all` / `skip` / `recent:4h` |

### 2. catch-up 処理

queue file の dirname にある `.last_processed-{project_name}` を Read:

- **未処理 0 件**: skip して step 3 へ
- **未処理 ≥1 件**: `catch_up_policy` に従う
  - `"ask"` (default): user に提示し option (A: 全部 / B: 直近 / C: 古いものは自動応答 / D: skip) を選ばせる
  - `"all"`: 確認なしで全件処理
  - `"skip"`: watermark を最新に更新して skip
  - `"recent:Nh"`: 過去 N 時間以内のみ処理

### 3. Monitor を arm

`tail -n 0 -F` で **新着のみ** を監視 (過去再生を回避):

```
Monitor (
  command: "tail -n 0 -F {queue_path} 2>/dev/null",
  description: "Tealus cc-queue: @cc-{project_name} 待機",
  persistent: true,
  timeout_ms: 300000
)
```

### 4. 状態通知

user に以下のように報告:

```
🟢 Tealus listening
   project: {project_name}
   auto_level: {auto_level}
   queue: {queue_path}
```

### 5. event 到着時の振る舞い

`<task-notification>` で 1 行 jsonl payload が届く。各 payload に対して:

#### L1 (notify only)
```
📨 新着 from {sender.display_name} (room: {room_name})
   "{content}"
```
を表示するのみ。reply は user が手動指示。

#### L2 (default、suggest reply)
1. 上記の通知 + 「reply 案」を session の context (commit log / open issue / 過去の会話 etc.) を踏まえて生成
2. user に提示し `OK` / 編集 / `スキップ` を待つ
3. user 確認後、`tealus-mcp` の `send_message` で投稿

#### L3 (auto reply)
1. reply 案を即 `send_message` 投稿
2. user に「✅ 自動応答送信: <reply 要約>」と通知 (事後監査ログ)

### 6. watermark 更新

reply 完了時 (L2 の OK 後 / L3 投稿成功時) に msg.id を `.last_processed-{project_name}` に書き込む。**reply 失敗時は更新しない** (再起動で再提示)。

## 停止

- session 内: `/stop-listen-tealus` (TaskStop で Monitor 終了)
- session 終了: 自動 cleanup

## 関連

- 設計議論: [#213](https://github.com/gamasenninn/tealus/issues/213)
- agent-server 側実装: `agent-server/src/webhook/ccQueue.js` + `handler.js`
- 採用者向け walkthrough: `docs/setup-cc-tealus-bridge.md`
