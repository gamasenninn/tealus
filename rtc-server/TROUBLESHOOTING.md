# mediasoup SFU デモ - トラブルシューティング記録

## 概要

mediasoup を使った 1対1 ビデオ通話デモの開発中に遭遇した問題と解決策の記録。
Windows 11 + Chrome + WSL 環境での検証。
Tealus Server 経由のプロキシ構成で LAN 内・外部ネットワーク（4G/5G）からの通話に成功。

---

## 問題1: 映像が表示されない（シグナリングは成功）

### 症状
- WebSocket のシグナリング（join, produce, consume, resumeConsumer）は全て成功
- ブラウザのコンソールに「通話中」と表示される
- しかし相手の映像が表示されない

### 原因
mediasoup の WebRtcTransport が UDP のみで設定されていたが、Windows ファイアウォールが `mediasoup-worker.exe` の UDP 受信をブロックしていた。シグナリングは HTTP/TCP（Express + WebSocket）なので正常に動作するが、メディア（RTP）は UDP で転送されるため映像が届かなかった。

### 解決策
TCP フォールバックを追加:
```js
listenInfos: [
  { protocol: "udp", ip: "0.0.0.0", announcedAddress: "127.0.0.1" },
  { protocol: "tcp", ip: "0.0.0.0", announcedAddress: "127.0.0.1" },
],
enableUdp: true,
enableTcp: true,
preferUdp: true,
```

### 教訓
- シグナリングの成功 ≠ メディアの到達。WebRTC では ICE/DTLS 接続が別途必要
- デバッグ時は `icestatechange` と `dtlsstatechange` イベントを監視すべき
- Windows では UDP と TCP で異なるファイアウォール挙動がある

---

## 問題2: UDP ファイアウォールルールが効かない

### 症状
`netsh advfirewall firewall add rule` で UDP 許可ルールを追加したが、効果がない。

### 原因（当初の推測と実際）
- **推測**: GPO（グループポリシー）がローカルルールを無効化している
  - `LocalFirewallRules: N/A (GPO ストアのみ)` と表示
- **実際**: Windows 11 Home のデフォルト表示がそう見えるだけで、GPO は未設定
  - `HKLM\SOFTWARE\Policies\Microsoft\WindowsFirewall` レジストリキーが存在しない
  - ローカルルール自体は適用されていた

### 補足
- `mediasoup-worker.exe` は `node.exe` とは別プロセス。ファイアウォールルールの `program` 指定に注意
- Worker のパス: `node_modules/mediasoup/worker/out/Release/mediasoup-worker.exe`

---

## 問題3: UDP が通るのに TCP が選ばれる

### 症状
- localhost の UDP 通信テスト（`dgram` モジュール）は成功
- しかし mediasoup の接続は常に TCP が選択される
- `preferUdp: true` を設定しても効果なし

### 原因
Chrome はループバックアドレス（`127.0.0.1`）の **UDP 候補を生成しない**。

`chrome://webrtc-internals/` で確認すると:
- ブラウザの UDP 候補: `172.29.32.1`（WSL 仮想ネットワークアダプタ）
- mediasoup のアナウンスアドレス: `127.0.0.1`

ブラウザは `172.29.32.1` → `127.0.0.1` に UDP を送ろうとするが、Windows では**異なるネットワークインターフェースからループバックアドレスへの UDP は到達しない**。

TCP は `connect()` で直接 `127.0.0.1` に接続できるため成功する（peer-reflexive candidate として `127.0.0.1` が生成される）。

### 解決策
ブラウザが持つネットワークインターフェースと同じアドレスで mediasoup をアナウンスする:
```js
{ protocol: "udp", ip: "0.0.0.0", announcedAddress: "172.29.32.1" }
```

### 最終的な解決策（自動検出）
`os.networkInterfaces()` で全 IPv4 アドレスを取得し、自動的に `listenInfos` を構築:
```js
const os = require("os");

function getListenInfos() {
  const listenInfos = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family !== "IPv4") continue;
      listenInfos.push({ protocol: "udp", ip: "0.0.0.0", announcedAddress: addr.address });
    }
  }
  listenInfos.push({ protocol: "tcp", ip: "0.0.0.0", announcedAddress: "127.0.0.1" });
  return listenInfos;
}
```

### 教訓
- `preferUdp` はサーバー側の ICE 候補の優先度設定であり、ブラウザの候補選択を制御するものではない
- Chrome の ICE 候補生成は OS のネットワーク構成に依存する
- WSL がインストールされた Windows では `172.29.x.x` の仮想アダプタが存在する
- `chrome://webrtc-internals/` は WebRTC デバッグの最重要ツール

---

## 問題4: Tealus Server の Socket.IO が動かなくなる

### 症状
- rtc-server の /rtc プロキシを追加した後、Tealus のリアルタイムメッセージが届かなくなる
- メッセージ送信は成功するが、相手に即時反映されない（リロードで反映）

### 原因
`http-proxy-middleware` の `ws: true` オプションが、サーバーレベルで**全ての WebSocket upgrade をリッスン**する。`/rtc` 用のプロキシが `/socket.io/` パスの upgrade も横取りし、Socket.IO の接続が確立できなくなった。

### 解決策
`ws: true` を削除し、`server.on('upgrade')` で `/rtc/` パスのみ手動で転送する:
```js
// ❌ ws: true は全 WebSocket を横取りする
const rtcProxy = createProxyMiddleware({
  target: 'http://localhost:3100',
  ws: true,  // これが問題
});

// ✅ 手動で /rtc/ パスのみ upgrade を転送
const rtcProxy = createProxyMiddleware({
  target: 'http://localhost:3100',
  pathRewrite: { '^/rtc': '' },
  changeOrigin: true,
});
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/rtc/')) {
    rtcProxy.upgrade(req, socket, head);
  }
});
```

### 教訓
- `ws: true` はパス単位ではなくサーバー単位で動作する。複数の WebSocket サービス（Socket.IO + 別の WS）が共存する場合は手動 upgrade 必須
- 問題の切り分け: Socket.IO の接続が切れたのか、メッセージの配信が壊れたのかを `socket.connected` で確認

---

## 問題5: Service Worker が /rtc/ パスを横取り

### 症状
- ブラウザで `/rtc/` にアクセスすると、rtc-server の HTML ではなく Tealus クライアントの画面が表示される
- 直接 `http://localhost:3100` にアクセスすると正常

### 原因
PWA の Service Worker が `/rtc/*` へのナビゲーションリクエストをキャッシュされた client の index.html で応答していた。

### 解決策
`vite.config.js` の `navigateFallbackDenylist` に `/rtc/` を追加:
```js
VitePWA({
  workbox: {
    navigateFallbackDenylist: [/^\/media\//, /^\/api\//, /^\/system\//, /^\/agent-api\//, /^\/rtc\//],
  },
})
```

**注意: ブラウザのキャッシュクリア（DevTools → Application → Service Workers → Unregister）が必要。** 古い SW がブラウザに残り続ける。

---

## 問題6: bundle.js が HTML として返される（外部アクセス時）

### 症状
- NAS リバースプロキシ経由で `/rtc/` にアクセスすると、画面が真っ白
- DevTools で bundle.js の中身が HTML（Tealus の index.html）

### 原因
NAS のリバースプロキシまたはブラウザが、最初のエラー応答（SW による横取り）をキャッシュしていた。SW の問題を修正した後もキャッシュが残る。

### 解決策
rtc-server に `Cache-Control: no-store` を追加:
```js
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
```

---

## 問題7: 外部ネットワークから映像・音声が届かない

### 症状
- LAN 内では正常に通話できる
- 4G/5G 等の外部ネットワークからはシグナリング成功するが映像・音声が届かない
- ICE state が `connected` にならない

### 原因
2つの問題が重なっていた:

1. **announcedAddress にグローバル IP がない** — mediasoup が LAN IP のみを ICE candidate として通知するため、外部クライアントが到達できない
2. **UDP ポートフォワーディング未設定** — ルーターが RTP の UDP パケットを開発 PC に転送していない

### 解決策
1. グローバル IP を `announcedAddress` に追加:
```js
// 起動時に自動検出
listenInfos.push({ protocol: "udp", ip: "0.0.0.0", announcedAddress: "<グローバルIP>" });
listenInfos.push({ protocol: "tcp", ip: "0.0.0.0", announcedAddress: "<グローバルIP>" });
```

2. ルーターで UDP ポートフォワーディング:
   - プロトコル: UDP
   - 外部ポート: 10000-10100
   - 内部 IP: 開発 PC の LAN IP
   - 内部ポート: 10000-10100

### 教訓
- シグナリング（WebSocket）は HTTPS プロキシ経由で到達するが、メディア（RTP/UDP）はクライアント ↔ mediasoup Worker の直接通信
- WebRTC の外部接続には「グローバル IP のアナウンス」と「UDP ポートの開放」の両方が必要

---

## 問題8: announcedAddress にホスト名（DDNS）は使えない

### 症状（想定）
`announcedAddress` に DDNS ホスト名を指定しても外部接続できない。

### 原因
RFC 8445（ICE）の仕様で、ICE candidate の `connection-address` は **IP アドレス（IPv4/IPv6）のみ**。ホスト名は許可されていない。mediasoup の `announcedAddress` はそのまま ICE candidate としてクライアントに送られるため、ホスト名を指定するとブラウザが処理できない。

- ❌ `announcedAddress: "myhost.example.com"` → ICE candidate として無効
- ✅ `announcedAddress: "203.0.113.1"` → 正常に動作

### 解決策
起動時にグローバル IP を自動取得する方式を採用:
```
優先順位:
1. 環境変数（ANNOUNCED_IP / PUBLIC_IP）— 明示指定が最優先
2. DNS クエリ（OpenDNS: myip.opendns.com → 208.67.222.222）— 外部 HTTP 不要で最速
3. HTTP API フォールバック（api.ipify.org → ifconfig.me → icanhazip.com）
```

IP が変わっても rtc-server の再起動だけで対応できる。

---

## 問題9: WebSocket 接続エラーでサーバーがクラッシュ

### 症状
rtc-server に非 WebSocket のリクエスト（ブラウザのプリフライト等）が来ると、`Invalid status code 49508` エラーでプロセスが落ちる。

### 解決策
1. `WebSocketServer` に `path: "/ws"` を指定して、`/ws` 以外のリクエストを無視
2. `ws.on('error')` ハンドラを追加してエラーをキャッチ

```js
const wss = new WebSocketServer({ server, path: "/ws" });
// ハンドラ内:
ws.on("error", (err) => {
  console.error(`[WS error] ${err.message}`);
});
```

---

## ネットワーク構成図（外部通話成功時）

```
外部端末（4G/5G）
  │
  ├── HTTPS (443) ──→ NAS リバースプロキシ
  │                     ├── / ──→ Tealus Server (:3000) ──→ Client SPA
  │                     ├── /rtc ──→ rtc-server (:3100)    [シグナリング]
  │                     └── /socket.io ──→ Tealus Server   [Socket.IO]
  │
  └── UDP (10000-10100) ──→ ルーター ポートフォワーディング
                              └── 開発 PC (:10000-10100)   [RTP メディア]
```

- シグナリング: HTTPS → NAS → Tealus Server → /rtc プロキシ → rtc-server（WebSocket）
- メディア: 外部端末 ↔ ルーター ↔ 開発 PC（UDP 直接通信）

---

## デバッグに有用だったツール・手法

### サーバー側
```js
// ICE/DTLS 状態監視
transport.on("icestatechange", (iceState) => { ... });
transport.on("dtlsstatechange", (dtlsState) => { ... });

// 選択されたプロトコル確認
transport.on("iceselectedtuplechange", (tuple) => {
  console.log(tuple.protocol); // "udp" or "tcp"
});
```

### クライアント側
```js
// トランスポート接続状態
transport.on("connectionstatechange", (state) => { ... });
```

### ブラウザ
- `chrome://webrtc-internals/` で ICE candidate pair の詳細を確認
- 選択されたペアの `state: succeeded` を探す
- local/remote candidate の `protocol` フィールドで UDP/TCP を判別

### mediasoup API の注意点（v3.19）
- `transport.tuple` プロパティは存在しない
- `iceselectedtuplechange` イベントで tuple を取得する
- `transport.dump()` の `iceSelectedTuple` も `undefined`（v3.19）
