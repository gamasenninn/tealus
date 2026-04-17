# mediasoup SFU デモ - トラブルシューティング記録

## 概要

mediasoup を使った 1対1 ビデオ通話デモの開発中に遭遇した問題と解決策の記録。
Windows 11 + Chrome + WSL 環境での検証。

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
