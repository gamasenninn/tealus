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

## Step 3. LINE 公式設定 (= 2 つの管理画面で個別設定が必要)

★ ★ 注意: LINE 公式アカウントは ★ ★ ★ **2 つの管理画面で別レイヤーの設定** がある。両方で正しく設定しないと webhook が動作しない (= 6/2 Day 17 dogfood で判明した罠)。

### 3-1. LINE Developers Console (= [developers.line.biz/console/](https://developers.line.biz/console/))

Messaging API タブで:

- **Use webhook** = ★ ON
- **Auto-reply messages** = ★ OFF
- **Greeting messages** = OFF 推奨
- **Allow bot to join group chats** = ★ ON (= グループ招待を受け付ける)

### 3-2. LINE Official Account Manager (= [manager.line.biz](https://manager.line.biz/))

★ ★ ★ user の声 (= 6/2 Day 17 で判明):

> 「Developers Console だけ設定しても webhook が動かない、Official Account Manager 側の応答設定で 『チャット』 が ON だと webhook 完全停止する罠あり」

該当アカウント選択 → 設定 → **応答設定**:

- ★ ★ **チャット** = ★ ★ ★ ★ ★ **OFF 必須** (= ON だと user message が「人間オペレーター用 chat box」に蓄積され webhook 飛ばない LINE 仕様)
- **あいさつメッセージ** = OFF 推奨
- ★ **Webhook** = ★ ON
- **応答メッセージ** = OFF

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

## Step 9. LINE グループに bot を招待 (= ★ ★ ★ 新規グループ作成必須)

★ ★ ★ ★ ★ ★ 重要: ★ ★ **既存グループへの bot 招待は ★ ★ LINE 仕様で「招待中」のまま stuck し、★ webhook event を受信できません** (= 6/4 Day 19 dogfood で確定)。

理由:
- LINE 公式アカウント (bot) は ★ acceptInvitation API が ★ 公式に提供されていない (= bot 側で承認不可)
- 既存グループは ★ ★ 「友だちをグループに自動で追加」設定が ★ OFF (= default、★ 後から ON にできない LINE 仕様)
- 「自動追加 OFF」 のグループに招待された bot は ★ ★ ★ 「招待中」 stuck → ★ ★ event 飛ばない

### 解決策 = ★ ★ 新規グループ作成 + 自動追加 ON

1. LINE アプリ → ホーム → 「グループ作成」
2. メンバー選択画面で:
   - ★ Step 4 で friend 追加した bot (= 「LINE Bridge」 等の表示名) を選択
   - 通常メンバー (= 業務メンバー) も同時選択
3. ★ ★ ★ ★ ★ **「友だちをグループに自動で追加」 = ON** で作成 (= default ON、念のため確認)
4. グループ名入力 → 作成完了
5. → ★ ★ bot は ★ ★ 即時 join 完了 (= 「招待中」 stuck にならない)

★ scope 制約: 業務で運用中の既存グループを そのまま Phase 1 に使うことは ★ ★ LINE 仕様で不可。既存グループ受信は Phase 1.5 (= Android 通知 forward 等、別 angle) で別途検討。

## Step 10. LINE グループ ID を取得

★ LINE グループ ID は招待後の webhook event から取得します:

1. グループ内で **任意のメッセージを 1 件発信** (= bot に届けば OK)
2. server log を確認:

```bash
# server ログから 確認 (= 2 件の log が出るのが正常)
grep "LINE Bridge" /path/to/server.log | tail -5
# → "[LINE Bridge] dispatchEvent: type=message, source=group, msg=text" ← ★ ★ 届いた事実
# → "[LINE Bridge] unmapped group: C1234abcd..." ← ★ ★ group ID 取得
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

### Verify は成功するが実 message event が届かない

★ ★ ★ ★ 最頻出の落とし穴。Console UI の Verify ボタンは「成功」表示するのに、★ 実 message を送っても webhook log に何も来ない症状。

★ 切り分け step:

1. ★ **Manager.line.biz の 応答設定 「チャット」 が ON でないか確認** (= ON だと webhook 完全停止)
2. **新規グループで bot が正式参加しているか確認** (= 「招待中」 stuck では event 飛ばない、Step 9 参照)
3. ★ ★ **新規グループでも届かない場合**: bot が friend list から削除/block されていないか確認

### signature verify failed (= log で `[LINE Bridge] signature verify failed`)

- `LINE_CHANNEL_SECRET` が LINE 公式 console と一致しているか確認
- 環境変数が server に正しく読み込まれているか (= server 再起動済か)
- LINE 公式 console と Tealus が同じ channel を見ているか (= 複数 channel ある場合に混同)

★ ★ ★ 注: 6/4 Day 19 以降、★ ★ Tealus 元 code は ★ secret path mismatch / signature verify failed でも HTTP **200 silent return** + log warn のみ (= LINE 公式 spec「webhook は常に 2xx」 準拠、★ ★ webhook auto-suspend 防止 + security 観点で URL/sig 情報 leak 防止)。HTTP status が 200 でも log に warn 出ていれば正常設計。

### webhook 自滅 (= Day 17 末まで存在した bug、Day 19 fix 後は再発しない)

★ ★ history: Day 17 では `routes/line.js` が secret path mismatch → 404、signature verify failed → 401 を返す設計だったため、★ 401 連続 17 件で LINE 公式が **webhook auto-suspend** trigger。

★ ★ Day 19 fix 後 (= 6/4 commit `cec0e50` 以降): ★ 200 silent return 設計に変更、★ ★ webhook 自滅 trigger 構造的にゼロ。

### 404 Not Found (= secret path 不一致、6/4 以降は出ない)

- `LINE_WEBHOOK_SECRET_PATH` と webhook URL の最後の path が一致しているか
- 例: env が `abc123` なら URL は `/api/line/webhook/abc123`、`/api/line/webhook/xyz` だと ★ log に warn 出る (= ★ HTTP response は 200 silent)

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

### Phase 1 では受信しない message type

| user 操作 | LINE webhook event type | 動作 |
|---|---|---|
| ★ 「写真を選択」 (= 標準画像送信、カメラ/アルバム button) | `image` | ✓ Phase 1 で投影 |
| ★ ★ 「ファイル」 (= 画像/動画/PDF 等をファイル添付として送信) | `file` | ✗ Phase 2 scope、Phase 1 では silent skip |
| ★ ★ 「動画を選択」 (= 動画送信) | `video` | ✗ Phase 2 scope、Phase 1 では silent skip |
| sticker / location | `sticker` / `location` | ✗ Phase 2 scope、Phase 1 では silent skip |

★ ★ ★ ★ ★ 「LINE 標準画像送信 (= 写真 button 経由)」 と 「ファイル添付の画像」 は ★ LINE webhook で event type が ★ ★ 異なる (= 6/4 Day 19 で確定)。「ファイル添付の画像」 は Phase 1 では受信しないので注意。

### その他 Phase 2 scope

- **Outbound (= Tealus → LINE post)**: 別 Phase
- **管理画面 UI** (= mapping CRUD): 別 Phase
- **送信者 filter / 時間帯 filter**: 別 Phase
- **既存 LINE 業務グループ受信** (= Phase 1.5、Android 通知 forward 等の別 angle): Day 17 末 + Day 19 で LINE 仕様の壁確定、別 angle で別途検討

## 関連

- 実装 Issue: [#288](https://github.com/gamasenninn/tealus/issues/288)
- 起点: 2026-06-02 業務メモ 10:47-10:49 (= 4 連続 voice memo)
- 親 vision: organon paradigm 自動 pipeline (= v0.3.0 release marker) の外部 channel 拡張第 1 例
- 関連 release: [v0.3.0](https://github.com/gamasenninn/tealus/releases/tag/v0.3.0)
- 完成日: 2026-06-04 Day 19 (= 200 fix + path 復権 + Phase 1 全 scope 動作確認、commit `cec0e50`)

## 参考リンク

- [LINE Developers — Get started with the Messaging API](https://developers.line.biz/en/docs/messaging-api/getting-started/)
- [LINE Developers — Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE Developers — Channel access tokens](https://developers.line.biz/en/docs/messaging-api/channel-access-tokens/)
- [LINE Official Account Manager](https://manager.line.biz/)
