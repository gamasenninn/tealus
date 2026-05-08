# RTC (mediasoup) — セットアップ手順

このドキュメントは Tealus に **rtc-server (mediasoup SFU)** を連携させて、**音声/ビデオ通話 + トランシーバー機能** を有効にするまでの手順です。クイックスタート (チャットのみ) では不要、通話 / 音声配信を使う時のみ必要。

---

## これから何をするか (全体像)

```
┌─────────────────────────────────────────────────────────────┐
│  ① rtc-server 起動 (mediasoup SFU、port 3100)                │
│       ↓                                                      │
│  ② JWT_SECRET を server / agent-server / rtc-server で揃える │
│       ↓                                                      │
│  ③ ANNOUNCED_IP を環境に合わせて設定                          │
│       ↓                                                      │
│  ④ ファイアウォールで UDP/TCP port を開放 (LAN / 外部 access)  │
│       ↓                                                      │
│  ⑤ クライアントで通話 button を押下 → 音声/ビデオ通話         │
└─────────────────────────────────────────────────────────────┘
```

**所要時間**: 10-15 分 (LAN 利用)、+15 分 (外部 access のため NAT 設定が必要なら)

**前提**:
- README のクイックスタート (Step 1-5) を完了している
- server / client / agent-server が動作している

---

## ステップ 1. rtc-server を起動 (~3 分)

### install + 自動 build

```bash
cd rtc-server
cp .env.example .env
npm install            # postinstall で esbuild の bundle.js も auto-build (#234)
```

> `npm install` 後 `public/bundle.js` が生成されているはず。これは client 側の通話 popup で使う mediasoup-client の bundle。**これが無いと通話 popup が「未接続」のまま固まる** ([#234](https://github.com/gamasenninn/tealus/issues/234) で auto-build 化済)。

### 起動

```bash
npm run dev
```

正常起動 log:
```
RTC server running on port 3100
mediasoup workers started: <N> worker(s)
```

`localhost:3100/health` で `{"status":"ok"}` が返れば OK。

---

## ステップ 2. 環境変数を設定 (~3 分)

`rtc-server/.env`:

```ini
RTC_PORT=3100
RTC_HOST=0.0.0.0

# mediasoup ネットワーク
ANNOUNCED_IP=127.0.0.1   # 同マシン内なら localhost
PUBLIC_IP=               # 外部 access するなら公開 IP

# JWT (server / agent-server と同一値必須)
JWT_SECRET=<server/.env と同じ値>

# Tealus API (TTS reader bot で使う)
TEALUS_API_URL=http://localhost:3000

# Aivis TTS reader bot (optional、トランシーバー機能で使う)
# AIVIS_API_KEY=
# AIVIS_MODEL_UUID=f5017410-fbb5-49e1-97cb-e785f42e15f5
# TTS_READER_BOT_ID=
# TTS_READER_BOT_PASS=
# TTS_READER_ROOMS=              # comma-separated room IDs
# TTS_READER_WATCH=false
```

### `JWT_SECRET` の重要性

**server / agent-server / rtc-server の 3 つで完全一致** していないと、認証で「invalid token」エラーになる。1 個でも違うと通話の招待が認証されない。

> 本番なら `openssl rand -hex 32` で生成して 3 つの `.env` 全部に同じ値を貼る。

### `ANNOUNCED_IP` の設定

| シナリオ | ANNOUNCED_IP |
|---|---|
| 同マシン内 (localhost) | `127.0.0.1` |
| LAN 内 (家 / 社内) | サーバー機の **LAN IP** (例: `192.168.1.20`) |
| 外部からも access | サーバー機の **公開 IP** + `PUBLIC_IP` も同じ |

LAN IP の確認:
- Linux/Mac: `ip addr` or `ifconfig`
- Windows: `ipconfig` の「IPv4 アドレス」

> `127.0.0.1` のままだと**他端末から通話できない**。WebRTC client は ICE candidate をこの IP で広告する。

---

## ステップ 3. server 側 proxy を確認 (~1 分)

server (port 3000) は `/rtc/*` を rtc-server (3100) に proxy している (`server/src/app.js`)。client は server 経由で rtc-server に接続するので、別途 firewall で 3100 を開ける必要はない (LAN 内なら)。

```bash
curl http://localhost:3000/rtc/health
# {"status":"ok"} が返れば proxy OK
```

> Vite dev server (port 5173) を経由する場合、`client/vite.config.js` の proxy にも `/rtc` が登録されているはず ([#257](https://github.com/gamasenninn/tealus/issues/257) で fix 済)。

---

## ステップ 4. ファイアウォール / NAT 設定 (~5-15 分、必要時のみ)

### LAN 内通話のみ

通常 OS 内蔵 firewall で UDP/TCP の **動的 port range** を許可する必要がある。mediasoup は **40000-49999** を default で使う (`rtcMinPort` / `rtcMaxPort` で変更可能)。

#### Windows

`mediasoup-worker.exe` の UDP/TCP 受信を許可:
1. 「Windows Defender ファイアウォール」→ 詳細設定
2. 受信の規則 → 新規 → プログラム → `rtc-server/node_modules/mediasoup/worker/out/Release/mediasoup-worker.exe`
3. 「接続を許可する」→ 全プロファイル

> 詳細は `rtc-server/TROUBLESHOOTING.md` の「問題1」「問題2」参照。

#### Linux (ufw)

```bash
sudo ufw allow 40000:49999/udp
sudo ufw allow 40000:49999/tcp
```

#### Mac

通常 default で localhost / LAN 内通信は許可されている。

### 外部 access (NAT 越え)

ルーターで **40000-49999/UDP** + **40000-49999/TCP** を rtc-server マシンに forward。
`PUBLIC_IP` を `.env` で設定 (固定 IP / DDNS の値)。

> SSL 証明書 / TURN server は別議論。今は LAN 内 + 限定的 NAT 越えのみ想定。

---

## ステップ 5. クライアントで通話確認 (~2 分)

1. client (5173 dev server or production build) を 2 端末で開く
2. 同じルームに入る
3. 通話 button (📞) を押下 → 相手側に着信通知
4. 双方が応答 → 音声/ビデオ通信開始

正常動作のシグナル:
- 通話 popup が「通話中」表示になる
- 双方の音声/映像が伝わる
- ブラウザ console に WebRTC ICE / DTLS の state change が出る

---

## ステップ 6. (Optional) TTS reader bot — トランシーバー機能用

mediasoup のトランシーバー受信機 (専用 hardware) が居る環境で、AI の TTS 音声をその受信機に配信する場合のみ設定。

`.env`:

```ini
AIVIS_API_KEY=<Aivis API key>
TTS_READER_BOT_ID=tts_reader      # bot user の login_id (admin で作成)
TTS_READER_BOT_PASS=<password>
TTS_READER_ROOMS=room-uuid-1,room-uuid-2
TTS_READER_WATCH=true             # メッセージ流入時に自動 TTS 配信
TTS_READER_MAX_LENGTH=500
```

> 通常の TTS は server 経由 Socket.IO blob で配信 (rtc-server 不要)。**transceiver gateway 受信機を運用している環境のみ** mediasoup 配信が必要。

---

## トラブルシューティング

### 通話 popup が「未接続」のまま固まる

- `rtc-server/public/bundle.js` が無い可能性 → `cd rtc-server && npm install` (postinstall で auto-build) or `npm run build`
- rtc-server プロセスが起動していない → `npm run dev` で起動 + log 確認
- JWT_SECRET 不一致 → server と rtc-server の `.env` を確認

### 「シグナリングは成功するが映像/音声が来ない」

- ファイアウォール (UDP) が原因の可能性 95%
- 詳細: `rtc-server/TROUBLESHOOTING.md` の「問題1」「問題2」

### 「invalid token」エラー

- `JWT_SECRET` が server / agent-server / rtc-server で一致していない
- 3 ファイル全部の `.env` を確認、同じ値に揃える

### 外部から通話できない (LAN 内は OK)

- `ANNOUNCED_IP` が `127.0.0.1` または LAN IP のまま → 公開 IP に変更
- `PUBLIC_IP` を設定
- ルーターで mediasoup の UDP/TCP port を forward

---

## 関連

- [`rtc-server/TROUBLESHOOTING.md`](../rtc-server/TROUBLESHOOTING.md) — 過去のトラブル記録
- [#234](https://github.com/gamasenninn/tealus/issues/234) — `bundle.js` auto-build (採用者保護)
- [#257](https://github.com/gamasenninn/tealus/issues/257) — Vite proxy `/rtc` 追加
- [`docs/setup-ai-agent.md`](setup-ai-agent.md) — agent-server セットアップ (rtc は通話関連、AI は別)
