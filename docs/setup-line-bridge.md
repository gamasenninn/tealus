# LINE Bridge セットアップ手順 (Phase 1 — Inbound 受信のみ)

[#288](https://github.com/gamasenninn/tealus/issues/288) で実装した LINE Bridge Phase 1 (= LINE グループ → Tealus 投影、text + 画像 + 音声) の **dogfood 準備手順**。

## 前提

- Tealus サーバが稼働している (`server/` プロセス、port 3000)
- インターネット経由でアクセスできる webhook URL を用意できる (= ngrok / cloudflare tunnel / 公開 HTTPS)
- LINE 公式アカウント (Official Account) を作成できる権限
- 対象の LINE グループに bot を招待できる

★ scope 確認: 本手順は **受信のみ** (= LINE → Tealus)。Tealus から LINE への送信は API 高額のため Phase 1 では実装していない。

## Step 1. LINE Official Account を作成

1. [LINE Official Account Manager](https://manager.line.biz/) にアクセス
2. 「アカウント作成」→ 名前 / カテゴリ / アイコン / カバー入力
3. 作成完了

★ 2024年9月以降、LINE Developers Console から直接 Messaging API channel を作成することはできなくなり、Official Account Manager 経由で作成する手順に変更されています。

## Step 2. Messaging API を有効化 + 認証情報取得

1. Official Account Manager の「設定」→「Messaging API」→「Messaging API を利用する」
2. 自動的に LINE Developers Console に Messaging API channel が作成される
3. [LINE Developers Console](https://developers.line.biz/console/) を開く → 作成された channel を選択
4. **Basic settings** タブで:
   - ★ **Channel secret** をコピー (= 後で `LINE_CHANNEL_SECRET` に設定)
5. **Messaging API** タブで:
   - **Channel access token (long-lived)** の「Issue」をクリック → トークン生成
   - ★ コピー (= 後で `LINE_CHANNEL_ACCESS_TOKEN` に設定)

★ Channel secret + access token は ★ ★ ★ **絶対に公開しない** (= リポジトリにコミット禁止、`.env` で管理し `.gitignore` 済み確認)。

## Step 3. LINE 公式設定 (= グループ参加 + auto-reply OFF)

LINE Developers Console の Messaging API タブで:

- **Use webhook** = ★ ON
- **Auto-reply messages** = ★ OFF (= bot が勝手に「定型応答」を送らない設定)
- **Greeting messages** = OFF 推奨
- **Allow bot to join group chats** = ★ ON (= グループ招待を受け付ける)

webhook URL は Step 8 で設定するので、今は空でも OK。

## Step 4. Tealus 内 LINE bot user を作成

Tealus 内に LINE 投稿用の bot user account を作成 (= LINE message の sender として表示される):

```sql
-- psql で接続: psql -U tealus -d tealus
INSERT INTO users (login_id, display_name, password_hash, is_bot)
VALUES (
  'LINE_BRIDGE_BOT',                -- 任意の login_id
  'LINE Bridge',                     -- 表示名 (= 投稿時の sender 表示)
  'unused-bot-account-disabled',     -- 通常ログイン不可、password hash は dummy
  true                               -- is_bot=true 必須
)
RETURNING id;
```

★ ★ 返却された `id` (UUID) をメモ → Step 7 の `LINE_BOT_USER_ID` に設定。

## Step 5. 対象 Tealus ルームに LINE bot user を追加

LINE グループ の投稿先となる Tealus ルームに、bot user を member として追加 (= INSERT INTO messages の room_member 制約を満たすため):

```sql
-- 対象 room の id (UUID) を確認 (Tealus 内で予め作成しておく)
SELECT id, name FROM rooms WHERE name LIKE '%LINE%' OR name = '対象ルーム名';

-- 上記の room_id と Step 4 の bot user_id を使って add
INSERT INTO room_members (room_id, user_id, role)
VALUES (
  '<room-uuid>',                    -- 対象 Tealus ルーム
  '<bot-user-uuid>',                -- Step 4 の id
  'member'
);
```

★ 複数 LINE グループを別 Tealus ルームに投影する場合、各 room に同じ bot user を add。

## Step 6. webhook URL の公開準備

LINE 公式の webhook は **HTTPS** が必要。開発時 / 本番別:

### 開発時 (= ngrok 等)

```bash
ngrok http 3000
# → https://xxxx.ngrok-free.app の URL を取得
```

webhook URL は `https://xxxx.ngrok-free.app/api/line/webhook/<LINE_WEBHOOK_SECRET_PATH>` の形式 (= Step 7 で path を決める)。

### 本番

通常の公開ドメイン (= cloudflare tunnel / nginx + Let's Encrypt 等) を使用。

## Step 7. `.env` 設定 + server 再起動

`server/.env` に以下 5 件を追加 (= 既存 `.env.example` 参照):

```bash
# LINE Developers console から取得 (Step 2)
LINE_CHANNEL_SECRET=<コピーした Channel secret>
LINE_CHANNEL_ACCESS_TOKEN=<コピーした Channel access token>

# 隠し URL の一部 (= 推測困難な random 文字列推奨、20 文字以上)
# 生成例: openssl rand -hex 24
LINE_WEBHOOK_SECRET_PATH=<random 文字列>

# Step 4 で作成した LINE bot user の id (UUID)
LINE_BOT_USER_ID=<bot user uuid>

# LINE グループ ID → Tealus ルーム ID mapping (JSON 形式)
# グループ ID は Step 10 で取得、初回は空 {} で OK、後で追記して再起動
LINE_GROUP_TO_ROOM={}
```

設定後、server 再起動:

```bash
cd server
# 既存運用方法に従う (= pm2 / systemd / 直接 node 等)
```

## Step 8. LINE 公式 console に webhook URL 設定

LINE Developers Console → Messaging API タブ → Webhook URL:

```
https://<your-domain>/api/line/webhook/<LINE_WEBHOOK_SECRET_PATH>
```

例: `https://xxxx.ngrok-free.app/api/line/webhook/abc123def456ghi789`

「Verify」ボタンで疎通確認 → ★ Success が出れば OK。

★ **Use webhook** = ON 再確認。

## Step 9. LINE グループに bot を招待

1. LINE アプリで対象グループを開く
2. メンバー追加 → bot の LINE ID (= Step 2 で取得した bot の友達追加 URL / QR コード) で招待
3. bot がグループに参加完了

## Step 10. LINE グループ ID を取得

★ LINE グループ ID は招待後の webhook event から取得します:

1. グループ内で **任意のメッセージを 1 件発信** (= bot に届けば OK)
2. server log を確認:

```bash
# server ログから group ID を grep
grep "unmapped group" /path/to/server.log | tail -5
# → "[LINE Bridge] unmapped group: C1234abcd..." のような log が出る
```

3. `LINE Bridge unmapped group:` の後ろの ID (= `C` で始まる文字列) を `LINE_GROUP_TO_ROOM` に追加:

```bash
# .env を編集
LINE_GROUP_TO_ROOM={"C1234abcd567efgh890":"<対応する Tealus room の uuid>"}
```

4. server 再起動 (= 環境変数 reload)

## Step 11. 実機 verify (= 受信テスト)

LINE グループで以下を 1 件ずつ発信、Tealus ルームに投影されることを確認:

| message 種別 | 検証ポイント |
|---|---|
| text | 文字がそのまま Tealus に表示される |
| 画像 | 画像が Tealus に表示される (= サムネイル + クリックで拡大) |
| 音声 | 音声が Tealus に表示 + ★ ★ 自動で文字起こし完了 (= 既存 Whisper + organon polyseme inject 自動連動) |

### 検証用コマンド

```bash
# 最新の LINE bridge log 確認 (= 直近 10 件)
tail -50 /path/to/server.log | grep "lineMessageBridge\|LINE Bridge"

# DB で message が POST されたか確認
psql -U tealus -d tealus -c "SELECT id, type, sender_id, created_at FROM messages WHERE sender_id = '<bot-user-uuid>' ORDER BY created_at DESC LIMIT 5;"

# 音声 message の文字起こし状態確認
psql -U tealus -d tealus -c "SELECT vt.message_id, vt.status, vt.transcription FROM voice_transcriptions vt JOIN messages m ON m.id = vt.message_id WHERE m.sender_id = '<bot-user-uuid>' ORDER BY vt.created_at DESC LIMIT 5;"
```

## Troubleshooting

### signature verify failed (= log で `[LINE Bridge] signature verify failed`)

- `LINE_CHANNEL_SECRET` が LINE 公式 console と一致しているか確認
- 環境変数が server に正しく読み込まれているか (= server 再起動済か)
- LINE 公式 console と Tealus が同じ channel を見ているか (= 複数 channel ある場合に混同)

### 404 Not Found (= secret path 不一致)

- `LINE_WEBHOOK_SECRET_PATH` と webhook URL の最後の path が一致しているか
- 例: env が `abc123` なら URL は `/api/line/webhook/abc123`、`/api/line/webhook/xyz` だと 404

### unmapped group (= Tealus に投影されない)

- `LINE_GROUP_TO_ROOM` の JSON 形式が正しいか (= `{"group-id":"room-uuid"}`)
- グループ ID が正確にコピーされているか (= 大文字小文字 区別、空白なし)
- server 再起動済か (= 環境変数は startup 時に load)

### Content API fetch failed (= 画像 / 音声 受信時 エラー)

- `LINE_CHANNEL_ACCESS_TOKEN` の有効期限 (= long-lived は expire しない、ただし console で revoke 可能)
- LINE 公式の rate limit (= 通常運用で問題ないが、大量 message の場合注意)

### voice 音声が文字起こしされない

- `voice_transcriptions` table の status を確認 (= pending → processing → completed)
- 既存 Whisper pipeline が動作中か (= 既存 朝礼動画文字起こしが動いていれば LINE 音声も同 pipeline)
- 既存 `OPENAI_API_KEY` 設定確認

## scope 外 (= 別 Phase / 別 Issue)

- **Outbound (= Tealus → LINE post)**: 別 Phase
- **管理画面 UI** (= mapping CRUD): 別 Phase
- **video / sticker / file / location**: 別 Phase
- **送信者 filter / 時間帯 filter**: 別 Phase

## 関連

- 実装 Issue: [#288](https://github.com/gamasenninn/tealus/issues/288)
- 起点: 2026-06-02 業務メモ 10:47-10:49 (= 4 連続 voice memo)
- 親 vision: organon paradigm 自動 pipeline (= v0.3.0 release marker) の外部 channel 拡張第 1 例
- 関連 release: [v0.3.0](https://github.com/gamasenninn/tealus/releases/tag/v0.3.0)

## 参考リンク

- [LINE Developers — Get started with the Messaging API](https://developers.line.biz/en/docs/messaging-api/getting-started/)
- [LINE Developers — Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE Developers — Channel access tokens](https://developers.line.biz/en/docs/messaging-api/channel-access-tokens/)
- [LINE Official Account Manager](https://manager.line.biz/)
