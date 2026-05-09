# Cross-machine cc-tealus bridge — Syncthing setup walkthrough

agent-server と Claude Code が **別マシン**で動く構成で、cc-tealus bridge (Tealus → Claude Code wake-up) を成立させるための setup 手順。Syncthing で `~/.tealus/cc-queue/` を P2P sync することで、各機の inotify / `tail -F` が local file として動作する。

> **本ドキュメントの位置付け**: HTTP transport ([#264](https://github.com/gamasenninn/tealus/issues/264)) が構造的な本命解だが、実装着手前の **当面の繋ぎ解**。tealus-mcp が将来 HTTP 化したら本 setup は不要になる。

---

## 1. 何を解決するか

cc-tealus bridge は **agent-server と Claude Code が同マシン前提** で設計されている (Phase A、[#213](https://github.com/gamasenninn/tealus/issues/213))。具体的には:

```
[agent-server] webhook で @cc-tealus mention を検知
     ↓
~/.tealus/cc-queue/tealus.jsonl に append   ← local file
     ↓
[Claude Code listen-tealus skill] Monitor が tail -F で監視
     ↓
新着行 → wake → 応答
```

両 process が **同じ file** を見る前提なので、別マシンでは file beacon が共有されない。

### 2026-05-08 採用者第 1 号 (藤井さん) dogfood で発覚

- Tealus server: `192.168.11.12`
- agent-server (port 4000): `192.168.11.10`
- Claude Code: `192.168.11.10` 想定 → 実は別マシンに居て bridge 不成立

ベータテスト連絡板で議論、network mount 系 (NFS / SMB / SSHFS / Rclone) は **inotify が remote write を検知できない原理的制約** で全滅。`Syncthing` のみが「両機 local file として配置 + 裏で双方向 sync」アプローチで動く事を確認。

詳細は本ドキュメント末尾の「比較表」と関連 link を参照。

---

## 2. 前提

- **2 マシンが LAN 内** (同一サブネット推奨、別 segment は VPN 経由を別途検討)
- 各マシンで Syncthing を install できる (Linux / Mac / Windows / NAS で利用可能)
- ファイアウォールで以下 port を解放できる
  - **22000/tcp + 22000/udp** — Syncthing sync (必須)
  - **22067/tcp** — Syncthing relay (LAN 内なら不要、外部経由時のみ)
  - **8384/tcp** — Web UI (localhost のみ、外部公開不要)
- 両マシンの `~/.tealus/cc-queue/` が **両方とも書き込み可能** (agent-server が片側で書く前提)
- cc-tealus bridge の基本 setup は完了済 ([docs/setup-cc-tealus-bridge.md](setup-cc-tealus-bridge.md))

---

## 3. Step-by-step setup

### Step 1. Syncthing install (各マシンで)

#### Linux (Ubuntu / Debian)

```bash
# 公式 apt repo を追加 (推奨、stable ビルド)
sudo curl -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list
sudo apt update && sudo apt install -y syncthing

# 起動 (foreground、初回は config 自動生成)
syncthing
```

#### macOS

```bash
brew install syncthing
brew services start syncthing
# or foreground: syncthing
```

#### Windows

公式インストーラ ([syncthing.net/downloads](https://syncthing.net/downloads/)) または `winget install Syncthing.Syncthing` で。サービス化したい場合は `SyncTrayzor` (GUI ラッパー) 推奨。

#### 起動確認

ブラウザで `http://localhost:8384` を開いて Syncthing GUI が出れば OK。初回は admin password 設定推奨。

---

### Step 2. デバイス相互認識 (両マシンで)

Syncthing は P2P で動くため、**お互いを「相手の Device」として登録**する必要がある。

#### 2-1. 自機の Device ID を確認

各マシンの GUI 右上「Actions → Show ID」で 56 文字の ID (例: `7CFNWBM-...`) が表示される。これをコピー。

#### 2-2. 相手機を Device として追加

各マシンの GUI で:
1. 「Add Remote Device」 → 相手機の Device ID を貼り付け
2. Device Name に分かりやすい名前 (例: `tealus-server-10`)
3. Save

両機で同様に追加。同 LAN なら自動 discovery が働き、数秒で相互接続される。GUI 上で device が **緑 (Connected)** になれば成立。

> 接続できない場合: firewall で 22000/tcp + 22000/udp が空いているか確認、または「Introducer」モードを試す。

---

### Step 3. 共有フォルダ (`~/.tealus/cc-queue/`) を登録

#### 3-1. 片機 (agent-server を動かしている方、例: `.10`) で folder 追加

GUI で:
1. 「Add Folder」
2. **Folder Path**: `~/.tealus/cc-queue` (絶対 path 推奨、例: `/home/user/.tealus/cc-queue`)
3. **Folder ID**: `tealus-cc-queue` (両機で **同じ** にする)
4. **Folder Label**: `tealus cc-queue beacon`
5. **Sharing** タブで Step 2 で登録した相手機をチェック
6. **Advanced** タブで `File Watcher` を **Enabled**、`Watcher Delay (seconds)` を **1** (default 10 だと遅い)
7. Save

#### 3-2. 反対機 (Claude Code 側、例: `.12`) で folder accept

数秒後、反対機の GUI に「New Folder Offered」通知が出る:
1. 「Add」
2. **Folder Path**: `~/.tealus/cc-queue` (= 既存ディレクトリ、無ければ作成)
3. **Folder ID**: `tealus-cc-queue` (片機で設定した ID と一致確認)
4. Same Advanced 設定: File Watcher Enabled、Delay 1s
5. Save

両機で folder が **緑 (Up to Date)** になれば sync 確立。

---

### Step 4. 動作確認

#### 4-1. 双方向 sync の smoke test

片機で:
```bash
echo "sync test $(date)" > ~/.tealus/cc-queue/_test.txt
```

数秒後、反対機で:
```bash
cat ~/.tealus/cc-queue/_test.txt
# → "sync test ..." が見える
```

これが見えれば sync 動作 OK。`_test.txt` は両機で `rm` して cleanup。

#### 4-2. listen-tealus skill が反応するか

Claude Code を立てているマシンで `/listen-tealus` skill を arm。Tealus chat 上で `@cc-tealus テスト` を投稿。**期待 flow**:

```
[Tealus chat]                @cc-tealus テスト
[.10 (agent-server)]         tealus.jsonl に行 append
[Syncthing sync 1-2 秒]      ↓
[.12 (Claude Code)]          tealus.jsonl に同行が現れる
[listen-tealus Monitor]      tail -F が新着検知 → wake → 応答
```

応答が Tealus に戻れば end-to-end OK。

---

### Step 5. Sync delay tuning (recommended)

cc-queue 用途では **1-3 秒の sync delay** が望ましい。Syncthing default の File Watcher Delay は **10 秒** なので調整推奨。

GUI: Folder Edit → Advanced → `File Watcher Delay (seconds)` を **1** に。

> Battery 駆動 laptop で disk IO を抑えたい場合は `5` 等の妥協値に。常時電源 server なら `1` で問題なし。

---

## 4. ⚠️ 重要な注意

### (a) `listen-tealus` skill は **片機のみ**で arm

両機で skill を arm すると、watermark file (`.last_processed-{project}`) が両機で書き込まれて Syncthing で conflict が発生する。

✅ **推奨**: Claude Code を片機集中、Dev/Support 分業も **同機内で 2 session** (memory `feedback_morning_routine.md` の延長)

❌ **避ける**: 2 マシンで同時に listen-tealus arm

### (b) Syncthing conflict file の cleanup

両機で同 file を同時編集した場合、Syncthing は `.sync-conflict-YYYYMMDD-HHMMSS-DEVICE.jsonl` を生成する。これを定期 cleanup する patrol を入れると安心:

```bash
# crontab -e
*/30 * * * * find ~/.tealus/cc-queue -name "*.sync-conflict-*" -mtime +1 -delete
```

通常運用 (片機集中) なら conflict は起きないが、defense-in-depth として。

### (c) Firewall

| OS | コマンド |
|---|---|
| Linux (ufw) | `sudo ufw allow 22000/tcp && sudo ufw allow 22000/udp` |
| Linux (firewalld) | `sudo firewall-cmd --permanent --add-port=22000/tcp --add-port=22000/udp && sudo firewall-cmd --reload` |
| Mac | System Settings → Network → Firewall → Syncthing 許可 |
| Windows | 初回起動時の Windows Defender ダイアログで許可 |

### (d) Permission

両機で `~/.tealus/cc-queue/` が **同じ user で書き込める** 状態が必要:

```bash
# Linux/Mac
chmod -R u+rw ~/.tealus/cc-queue
chown -R $(whoami) ~/.tealus/cc-queue
```

### (e) Watermark file の sync (補足)

`.last_processed-{project}` も Syncthing 同期対象になるため、**片機で更新した最新位置が反対機にも sync される**。これは意図された動作だが、運用上 listen-tealus を片機集中する前提でしか想定しない (注意 (a) と同じ結論)。

---

## 5. 比較表 — なぜ Syncthing なのか

5/8 ベータテスト連絡板での議論決着を要約:

| 方式 | tail -F 動作 | setup | 長期維持 | 備考 |
|---|---|---|---|---|
| **Syncthing** | ✅ ほぼ即時 (秒単位) | 中 | ✅ active 開発 | ⭐ **当面の正解** (両機 local file、各機 inotify 動く) |
| NFS | ❌ 不可 | 中 (exports / 権限) | ✅ stable | network mount で remote write の inotify 不可 |
| SMB / CIFS | ❌ 不可 | 小 | ✅ stable | Samba lkml で確認 (VFS hooks 削除済)、CIFS で inotify 不可 |
| SSHFS | ❌ 不可 | 小 | ⚠️ unmaintained | FUSE 共通制約、開発停止 |
| Rclone mount | ❌ 不可 | 小 | ✅ active | FUSE + libfuse の本質制約、外部 event inject 不可 |
| rsync polling | ⚠️ 1-2s 遅延 | 小 | ✅ stable | listen-tealus skill 改修要、defensive な fallback |
| **HTTP transport ([#264](https://github.com/gamasenninn/tealus/issues/264))** | ✅ | 大 (実装要) | 設計中 | **将来本命**、Syncthing は繋ぎ |

**根本理由**: `inotify` は **local filesystem の VFS event を hook する仕組み**。network mount 系 (FUSE / NFS / CIFS / Rclone) では「自機が write した時」しか発火しない。Syncthing は両機に local file を実体化させる approach なので、inotify が普通に動く。

---

## 6. トラブルシューティング

### 「Syncthing UI に相手 device が出ない」

- Step 2 で Device ID を相互登録したか
- 同 LAN の場合: firewall で 22000/tcp + 22000/udp が両方向開いているか
- 別 LAN / 外部の場合: ルーターで port forward、またはリレー経由 (default で動くはず)

### 「Sync が遅い (10 秒以上)」

- File Watcher Delay (Step 5) が default 10s のまま → 1s に変更
- Syncthing 自体の rescan interval は default 1h、cc-queue 用途では問題なし

### 「conflict file が生成された」

- 両機で listen-tealus skill を同時に arm していないか確認 (注意 (a))
- 一度 Claude Code を片機集中に整理して、conflict file を `rm`
- 必要なら patrol cron 追加 (注意 (b))

### 「permission denied」

- `~/.tealus/cc-queue/` の owner / mode を両機で確認
- Linux/Mac で異なる UID / GID なら、idmap or `chmod 770` (group 共有) 検討

### 「sync は動くが listen-tealus が wake しない」

- 反対機 (Claude Code 側) の `tail -F` が tealus.jsonl を見ているか
- Syncthing が file の中身を modify した場合、`tail -F` は inode 切替で reopen する。skill 内 Monitor command を `tail -n 0 -F` で起動しているか確認

---

## 7. 関連 link

- [#213](https://github.com/gamasenninn/tealus/issues/213) cc-tealus bridge Phase A (file beacon 設計)
- [#214](https://github.com/gamasenninn/tealus/issues/214) Phase B (multi-session / network 拡張、本ドキュメントの上位 context)
- [#264](https://github.com/gamasenninn/tealus/issues/264) tealus-mcp HTTP transport 化 (構造解、将来本命)
- [docs/setup-cc-tealus-bridge.md](setup-cc-tealus-bridge.md) (前提の cc-tealus bridge setup)
- 2026-05-08 ベータテスト連絡板 議論 thread (cross-machine 問題 → Syncthing 解の議論経緯、msg `502f3cd2` 〜 `97370470`)
- [Syncthing 公式](https://syncthing.net/)
- [Syncthing inotify 統合 (v0.14.40+)](https://forum.syncthing.net/t/where-to-find-the-integrated-functionality-of-syncthing-inotify/11433)

---

## 8. 設計メモ — なぜこの doc が当面の解か

cc-tealus bridge の **本質課題**は「agent-server と Claude Code が同 file beacon を見る」こと。Syncthing は **「local file を両機に持たせて裏で sync」** という workaround で、課題の根本 (file path 共有) を transparent に解決する。

ただし:
- watermark file の sync で運用上の制約 (片機集中)
- conflict file の cleanup 必要
- network breakage 時に sync が止まる (当然だが、cc-tealus bridge 自体が動かない状態と等価)

これらは tealus-mcp が **HTTP transport 化** ([#264](https://github.com/gamasenninn/tealus/issues/264)) すれば本質的に解消される (file beacon 自体が不要になり、agent-server と Claude Code が直接 HTTP で会話)。本 walkthrough はそれまでの **繋ぎ** として位置付ける。

採用者環境で本 setup を運用する間に得られる feedback は、#264 の仕様検討に直接 contributing する。dogfood 価値は十分にある。
