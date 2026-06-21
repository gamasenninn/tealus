# LINE Bridge セットアップ手順 (Phase 1 〜 2.3 完成、★ ★ 6/6 Day 21 凍結宣言)

★ Tealus の **外部 channel 拡張第 1 例** として 2026-06-02 〜 06-06 の 5 日間で実装、★ ★ ★ ★ ★ user 判断で UI 化保留 (= YAGNI、user voice surface まで) のうえ ★ ★ structural foundation 完成として scope 凍結。

## ★ ★ 完成 feature 一覧

### 受信 (= Inbound) 主要 7 type 完全対応

| user 操作 | event type | 投影先 Tealus type | Phase |
|---|---|---|---|
| text | `text` | text | 1 |
| 「写真を選択」 | `image` | image + サムネイル | 1 |
| 音声 | `audio` | voice + 自動文字起こし + organon polyseme inject | 1 |
| 「動画を選択」 | `video` | video + ffmpeg thumbnail | 2.1 |
| 「ファイル」 添付 | `file` | file (原名 + 原拡張子保持) + TextFilePreview (= MD/JSON/CSV/TXT inline preview) | 2.1 |
| スタンプ | `sticker` | image (= LINE 公式 sticker CDN 経由) | 2.2 |
| 「位置情報」 | `location` | text + markdown (= 緯度経度 + Google Maps link) | 2.2 |

### 設定方式 (= Phase 2.3 確立 2 file 案)

- **catalog file** (= `server/config/line-groups.json`、自動更新): webhook 受信時 LINE API で group name 自動取得 + atomic write
- **mappings file** (= `server/config/line-group-mappings.json`、手動編集): D2 object form + pure string form 後方互換、★ ★ ★ file 編集後 ★ 次 webhook で即反映 (= restart 不要)
- **members file** (= `server/config/line-members.json`、自動更新、#309 案A): 後述「送信者名の付与」用。userId → 表示名の cache (= atomic write、既取得は API skip)。LINE 表示名 = 個人情報のため .gitignored

### 送信者名の付与 (= #309 案A MVP、2026-06-21)

LINE グループは複数人が発言するため、投影メッセージの本文先頭に `[氏名@グループ名]`（角括弧）を添えて「誰の発言か」を示す。

- 送信者名は webhook の `source.userId` から LINE API `GET /v2/bot/group/{groupId}/member/{userId}` で取得し `line-members.json` に cache（group name 取得と同型）。
- バブルのヘッダー送信者名は引き続き「LINE Bridge」（投稿は単一 bot user のため）。氏名は**本文の先頭行**に出る（ライブ/再読込で一貫）。
- text / image / voice / file / video / sticker / location 全 type に付与。userId 取得不可 / member profile 取得失敗時はラベル無しで degrade（従来どおり「LINE Bridge」のみ）。
- ★ MVP のため content 先頭に文字列として埋め込む方式。将来 per-message ラベル列（案B）/ LINE ユーザー別 bot user（案C）へ移行余地あり（[#309](https://github.com/gamasenninn/tealus/issues/309)）。

### LINE 公式 spec 準拠

- 200 silent return (= secret path mismatch / signature verify failed でも 200 + log warn のみ、★ webhook auto-suspend 構造的にゼロ)
- security: 攻撃者に URL / verify status 情報 leak しない

### Tealus client (= PWA) 内蔵 file preview

- TextFilePreview component で MD / TXT / JSON / CSV / source code 等の inline preview
- UTF-8 decode (= Chrome Android 文字化け回避)、cache + truncate (= 256KB 上限)、★ react-markdown + remarkGfm + remarkBreaks (= Tealus 内 markdown 統一感)

## ★ ★ Phase 2.x scope 外 (= 別 Phase / 別 Issue 候補、将来 user voice surface 待ち)

- **Phase 2.3 UI** (= mapping CRUD 画面): YAGNI で凍結、★ 業務担当者編集 use case surface まで保留 (= 2 file 案がそのまま UI data source として再利用可能)
- **Phase 2.4 outbound** (= Tealus → LINE post): LINE API 高額のため需要 surface 待ち
- **Phase 1.5 既存 LINE 業務グループ受信** (= Android 通知 forward 等): 別 angle、user 業務必要度次第
- **Phase 3 sticker 専用 type 追加 / location map / animated sticker / private sticker**: enhancement 候補

## ★ 完成 commit history

| commit | 内容 | Phase |
|---|---|---|
| `4603a4a` | Phase 1 初期実装 | 1 |
| `cec0e50` | 200 fix (= 真犯人解決) | 1 |
| `d2851a5` | docs update Day 19 | 1 |
| `950e101` | Phase 2.1 file/video 実装 | 2.1 |
| `7355060` | MD/.bin 問題 fix (= originalFileName) | 2.1 |
| `1c1b383` | TextFilePreview component | 2.1 |
| `5517671` | JSON auto-indent + CSV table | 2.1 |
| `0d00558` | Phase 2.2 sticker + location | 2.2 |
| `c8f678f` | docs Day 20 update | 2.2 |
| `c315703` | sticker 400 fix (= LINE sticker CDN) | 2.2 |
| `5612771` | Phase 2.3 2 file 案 + catalog + mappings | 2.3 |
| `959b71e` | test isolation fix (= 本番 file 上書き防止) | 2.3 |

## 関連 Issue (= 完成 close 済)

- [#288 Phase 1](https://github.com/gamasenninn/tealus/issues/288) (= text + image + audio)
- [#289 Phase 2.1](https://github.com/gamasenninn/tealus/issues/289) (= file + video + TextFilePreview)
- [#290 Phase 2.2](https://github.com/gamasenninn/tealus/issues/290) (= sticker + location)
- [#291 Phase 2.3](https://github.com/gamasenninn/tealus/issues/291) (= 2 file 案 + 凍結宣言)

---

以下、★ 採用者向け **dogfood 準備手順 / セットアップ完全 guide**。

## 前提

- Tealus サーバが稼働している (`server/` プロセス、port 3000)
- インターネット経由でアクセスできる webhook URL を用意できる (= ngrok / cloudflare tunnel / 公開 HTTPS)
- LINE 公式アカウント (Official Account) を作成できる権限
- 対象の LINE グループに bot を招待できる

★ scope 確認: 本手順は **受信のみ** (= LINE → Tealus)。Tealus から LINE への送信は API 高額のため Phase 2.x では実装していない (= Phase 2.4 outbound として残置)。

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

## Step 10. LINE グループ ID を取得 (= Phase 2.3、6/6 Day 21 確立)

★ Phase 2.3 で 「2 file 案」 を確立: ★ ★ user は ★ ★ ★ ★ ★ ★ ★ Tealus が自動収集する catalog file を open するだけで、group name ↔ ID 対応一覧を確認できる。server log grep 不要。

### file 構成

- ★ ★ **`server/config/line-groups.json`** (= 自動更新、★ Tealus が webhook 毎に書き換え)
- ★ ★ **`server/config/line-group-mappings.json`** (= 手動編集、user が ID コピペで投影設定)

両 file は ★ ★ .gitignored (= 実運用 file、sample は `.example.json` でコミット)。

### 動作 flow

1. ★ ★ グループ内で **任意のメッセージを 1 件発信** (= bot に届けば OK)
2. ★ ★ Tealus が自動的に `server/config/line-groups.json` 更新:
   ```json
   {
     "C1234abcd567efgh890": {
       "name": "営業部 LINE",
       "last_seen_at": "2026-06-06T10:00:00Z",
       "last_sender": "<user-id>",
       "last_message_snippet": "テスト",
       "first_seen_at": "2026-06-06T10:00:00Z"
     }
   }
   ```
3. ★ ★ user が file を open し、★ ★ ★ group name から ID を確認 + コピー
4. ★ ★ `server/config/line-group-mappings.json` を手動編集:
   ```json
   {
     "C1234abcd567efgh890": {
       "room_id": "<対応する Tealus room の uuid>",
       "description": "営業部 LINEブリッジ"
     }
   }
   ```
5. ★ ★ 保存 → ★ ★ ★ ★ ★ ★ ★ **次の webhook で即反映** (= restart 不要)

### 後方互換

- ★ pure string form (= `{ "groupId": "roomId" }`) も accept (= 旧 env LINE_GROUP_TO_ROOM 形式移行 path)
- ★ file なし + env LINE_GROUP_TO_ROOM あり時は env fallback (= 既存運用そのまま動く)
- ★ migration path: env → file への移行は ★ user 任意 timing で可能

### 旧方式 (= 後方互換、新規採用は file 推奨)

旧 env 編集方式 = restart 必要:
```bash
# .env を編集
LINE_GROUP_TO_ROOM={"C1234abcd567efgh890":"<対応する Tealus room の uuid>"}
# → server 再起動 (= 環境変数 reload)
```

## Step 11. 実機 verify (= 受信テスト)

LINE グループで以下を 1 件ずつ発信、Tealus ルームに投影されることを確認:

| message 種別 | 検証ポイント | Phase |
|---|---|---|
| text | 文字がそのまま Tealus に表示される | 1 |
| 画像 (= 標準) | 画像が Tealus に表示 (= サムネイル + クリックで拡大) | 1 |
| 音声 | 音声が Tealus に表示 + ★ ★ 自動で文字起こし完了 (= 既存 Whisper + organon polyseme inject 自動連動) | 1 |
| 動画 (= 動画選択 button) | 動画が Tealus に表示 + ★ ffmpeg 1sec frame thumbnail preview | 2.1 |
| ファイル添付 (= 「+」→「ファイル」) | 原ファイル名 + 原拡張子 で投影 (= MD/JSON/CSV/任意 file) | 2.1 |
| スタンプ | LINE 公式 sticker PNG が ★ image として投影 (= 既存 image grid に表示) | 2.2 |
| 位置情報 (= 「+」→「位置情報」) | 「📍 場所名 / 緯度経度 / [地図 link]」 markdown 投影 + tap で Google Maps 起動 | 2.2 |

### ★ Tealus client 側 file preview (= Phase 2.1 TextFilePreview component)

★ Tealus 「LINEブリッジ」 room 内の添付 file (= ファイル添付経由) には ★ 「📎 file_name」 link の下に ★ ★ **「▶ プレビューを開く」** button が表示されます (= MD/TXT/JSON/CSV/source code 等の text file 対象)。

★ tap で expand → inline preview:

| file 種別 | preview 動作 |
|---|---|
| `.md` / `.markdown` | ★ ★ react-markdown + remarkGfm + remarkBreaks で ★ ★ Tealus 内 message text と同 quality の markdown rendering (= 見出し / 段落 / リンク / コード等) |
| `.json` | ★ JSON auto-indent (= minify file でも自動成形 2 space indent)、★ parse 失敗時は raw fallback |
| `.csv` / `.tsv` | ★ ★ `<table>` rendering (= 簡易 RFC 4180 parser、header + body 分離 + zebra)、★ separator は拡張子から自動切り替え |
| `.txt` / `.log` / source code (= .js/.py/.ts 等) | ★ `<pre>` raw 表示 (= 等幅 font、UTF-8 decode、★ Chrome Android 等の charset 認識問題回避) |

★ ★ design 特徴:
- ★ ★ ★ UTF-8 で fetch.text() decode = Chrome Android 等の charset 認識問題回避 (= 6/5 Day 20 確立)
- 折り畳み default = chat flow を切らない UX
- expand 後の content は cache (= 折り畳み再 expand で再 fetch しない)
- 256KB 超過 file は ★ truncate + 警告表示 (= 大 file でも軽量)

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

### ファイル添付の display 名が `*.bin` になる / 原拡張子失われる (= 6/5 Day 20 fix 済)

- ★ 6/5 commit `7355060` 以降は ★ ★ LINE webhook の `message.fileName` field を ★ `saveLineContentToFile` の `originalFileName` option で受け取り、★ display 名 = 原名 + physical 拡張子 = 原拡張子 で保存
- ★ ★ もし古い version で動作している場合は ★ 最新 main に update + server restart

### Chrome Android で MD file 文字化け (= 6/5 Day 20 fix 済)

- ★ server 側は ★ `text/markdown; charset=UTF-8` で正しく配信、★ ★ Chrome Android が charset header 無視 or default encoding 優先で文字化け
- ★ ★ 解決 = ★ ★ ★ Tealus client 内蔵 TextFilePreview component で inline preview (= `<a download>` link 経由で external app に渡さず、Tealus 内で fetch.text() UTF-8 decode + react-markdown rendering)
- ★ 利用方法: 「📎 file_name」 link の下の 「▶ プレビューを開く」 button tap

### Content API fetch failed (= 画像 / 音声 受信時 エラー)

- `LINE_CHANNEL_ACCESS_TOKEN` の有効期限 (= long-lived は expire しない、ただし console で revoke 可能)
- LINE 公式の rate limit (= 通常運用で問題ないが、大量 message の場合注意)

### voice 音声が文字起こしされない

- `voice_transcriptions` table の status を確認 (= pending → processing → completed)
- 既存 Whisper pipeline が動作中か (= 既存 朝礼動画文字起こしが動いていれば LINE 音声も同 pipeline)
- 既存 `OPENAI_API_KEY` 設定確認

## 対応 message type 一覧 (= Phase 2.2 時点)

| user 操作 | LINE webhook event type | 動作 | Phase |
|---|---|---|---|
| text | `text` | ✓ 投影 | 1 |
| 「写真を選択」 (= 標準画像送信) | `image` | ✓ 投影 + サムネイル | 1 |
| 音声 メッセージ | `audio` | ✓ 投影 + 自動文字起こし | 1 |
| 「動画を選択」 | `video` | ✓ 投影 + ffmpeg thumbnail | 2.1 |
| 「ファイル」 添付 (= 画像/動画/PDF/MD 等) | `file` | ✓ 原名 + 原拡張子で投影 + TextFilePreview | 2.1 |
| スタンプ | `sticker` | ✓ LINE 公式 sticker PNG を image type で投影 | 2.2 |
| 「位置情報」 | `location` | ✓ text + markdown で投影 + Google Maps link | 2.2 |

★ ★ 「写真を選択」 (= 標準画像送信) と 「ファイル添付の画像」 は ★ LINE webhook で event type が ★ 異なる (= image vs file)。Phase 2.1 以降は両方 受信対応。

## scope 外 (= 別 Phase / 別 Issue)

- **Phase 2.3 outbound** (= Tealus → LINE post): LINE API 高額のため需要 surface 待ち
- **Phase 2.4 mapping CRUD UI** (= 管理画面): 現状 `.env` で十分、複数 group 運用後判断
- **送信者 filter / 時間帯 filter**: 必要なら Phase 2.5
- **Phase 1.5 既存 LINE 業務グループ受信** (= Android 通知 forward 等の別 angle): Day 17 末 + Day 19 で LINE 仕様の壁確定 (= 既存 group bot 招待中 stuck)、別 angle で別途検討
- **Phase 3 sticker 専用 type 追加**: user dogfood 後の認識次第で type 分離検討 (= 現状 image type 流用)
- **Phase 3 location 専用 type + map component**: 現状 text + markdown 投影、map preview component 要望時実装
- **Phase 3 ANIMATION / SOUND sticker 動的表示**: 現状静止画 first frame 投影、完全動作は別 task
- **Phase 3 private sticker** (= 自作スタンプパック): LINE 公式 type='sticker' event 非対応、別 dispatch 要

## 関連

### 実装 Issue (= 時系列)

- [#288 Phase 1](https://github.com/gamasenninn/tealus/issues/288) (= text + image + audio、close 済): 2026-06-02 Day 17 実装 → 2026-06-04 Day 19 真犯人解決 + close
- [#289 Phase 2.1](https://github.com/gamasenninn/tealus/issues/289) (= file + video + TextFilePreview、close 済): 2026-06-05 Day 20 完成
- [#290 Phase 2.2](https://github.com/gamasenninn/tealus/issues/290) (= sticker + location): 2026-06-05 Day 20 実装

### 完成日 + 主要 commit

- ★ Phase 1 完成: 2026-06-04 Day 19 (= 200 fix + path 復権、commit `cec0e50`)
- ★ Phase 2.1 完成: 2026-06-05 Day 20 (= file/video + TextFilePreview、commit `950e101` / `7355060` / `1c1b383` / `5517671`)
- ★ Phase 2.2 完成: 2026-06-05 Day 20 (= sticker/location、commit `0d00558`)

### 背景

- 起点: 2026-06-02 業務メモ 10:47-10:49 (= 4 連続 voice memo) by 小野哲
- 親 vision: organon paradigm 自動 pipeline (= v0.3.0 release marker) の外部 channel 拡張第 1 例
- 関連 release: [v0.3.0](https://github.com/gamasenninn/tealus/releases/tag/v0.3.0)

## 参考リンク

- [LINE Developers — Get started with the Messaging API](https://developers.line.biz/en/docs/messaging-api/getting-started/)
- [LINE Developers — Verify webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE Developers — Channel access tokens](https://developers.line.biz/en/docs/messaging-api/channel-access-tokens/)
- [LINE Official Account Manager](https://manager.line.biz/)
