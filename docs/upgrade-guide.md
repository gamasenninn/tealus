# アップグレードガイド — 新しいバージョンへの更新手順

自己ホストで Tealus を運用している採用者向けに、**既に動いている環境を新しいバージョンへ更新する**手順をまとめます。新規インストールは [README のセットアップ](../README.md#セットアップ) を参照してください。

> **要点だけ先に**: 更新の急所は **`cd server && npm run migrate`（DB 更新）** と **`cd client && npm run build`（画面の再ビルド）** の 2 つ。これを忘れると「クラッシュはしないが機能が静かに壊れる」状態になります（[#334](https://github.com/gamasenninn/tealus/issues/334)）。迷ったら下の「更新後の健全性チェック」で起動ログを確認してください。

---

## 基本の更新手順（どのバージョンでも共通）

Tealus はサーバをビルドレス実行（Node の型ストリッピング）するため、**サーバ側のビルドは不要**です。更新で必要なのは「コード取得 → 依存更新 → DB migration → クライアント再ビルド → 再起動」の 5 ステップです。

### 0. 事前準備（推奨）

```bash
# いま動いているバージョンを控えておく（切り戻し用）
git describe --tags        # 例: v0.5.0

# DB のバックアップ（任意だが本番では推奨。docker-compose で PostgreSQL を動かしている場合）
docker-compose exec -T postgres pg_dump -U tealus tealus > backup-$(date +%Y%m%d).sql
```

### 1. コードを取得

```bash
# main を追従している場合
git pull

# タグ運用（特定バージョンに固定したい）の場合
git fetch --tags
git checkout v0.6.0
```

### 2. 依存を更新（各パッケージ）

念のため各パッケージで `npm install` を実行します（依存が変わっていなければ即終了します）。

```bash
cd server        && npm install
cd ../client     && npm install     # postinstall で client/dist を自動再ビルド
cd ../agent-server && npm install    # ★ 忘れやすい（AI 応答が動かない原因になる）
cd ../rtc-server && npm install      # postinstall で bundle を自動再ビルド（音声通話を使う場合）
```

> `agent-server` の `npm install` 忘れは、AI エージェント（Light/Deep）や cc-* ブリッジが動かない典型原因です。

### 3. ★ DB を更新（migration）

```bash
cd server
npm run migrate
```

- migration は **`server/.env` の DB 接続情報**を使います（先に `.env` があること）。
- 全 migration を順に流しますが、**各 migration は冪等**（`IF EXISTS` / `IF NOT EXISTS` 等）に書かれているため、**再実行しても安全**です。既に適用済みのものは実質何もしません。
- `All migrations completed.` が出れば成功。

### 4. ★ クライアントを本番ビルド

```bash
cd client
npm run build
```

- サーバは `client/dist` を配信するので、**画面の更新はこの再ビルドで初めて反映**されます。
- 手順 2 の `npm install` で `postinstall: vite build` が走っているので**既にビルド済みのことが多い**ですが、確実にするため明示実行を推奨します。
- dev サーバ（`npm run dev` / Vite）で運用している場合はこの手順は不要です（ただし本番運用は build 推奨）。

### 5. プロセスを再起動

**この順序**で再起動します（依存の向き）:

```
server（ポート 3000） → agent-server → rtc-server →（使っていれば）トランシーバー CLI
```

- サーバ側コードは再起動で反映（ビルドレスなので build 不要）。
- 音声通話を使わないなら rtc-server は省略可。

---

## 更新後の健全性チェック

更新が正しく効いたかは、**サーバの起動ログ**と**画面**で確認できます。

### 起動ログ（server）

以下の warn が**出ていなければ OK**です。出ていたら対応してください:

| ログ | 意味 | 対応 |
|------|------|------|
| `[migration-check] ... テーブルが見つかりません` | DB migration 忘れ | 手順 3（`npm run migrate`）を実行 |
| `[build-check] client/dist/index.html が見つかりません` | クライアント未ビルド | 手順 4（`npm run build`）を実行 |

> どちらも **稼働は止まりません**（フォールバックで動き続ける）。だからこそ「気づかないうちに機能だけ欠ける」ので、更新直後にログを一度確認してください。

### 画面（ブラウザ / PWA）

- **ハードリロード**で新しい画面を読み込みます（`Ctrl+Shift+R` / macOS は `⌘+Shift+R`）。
- PWA（ホーム画面アプリ）はサービスワーカーのキャッシュのため、**1 回で変わらなければもう一度リロード**（またはアプリを閉じて開き直し）。

### MCP（tealus-mcp を使っている場合）

- ツール（例: `send_form`）が増えたバージョンに上げたら、**Claude Code をフル再起動**してください。in-app reload や `/mcp` 再接続では stdio 子プロセスが生き残り、反映されません。
- `.mcp.json` でバージョンをタグ固定している運用（例: `github:gamasenninn/tealus-mcp#v0.14.6`）は、**pin を新しいタグに上げてから**フル再起動が必要です。

---

## バージョン別ノート

### → v0.6.0（汎用フォーム + エージェント起動入口）

**必須の作業:**

1. ★ **`cd server && npm run migrate`** — 追加 migration は `026_message_form_type.sql` の 1 本（汎用フォーム [#336](https://github.com/gamasenninn/tealus/issues/336) 用に `messages.type` へ `'form'` を許可）。**これを忘れるとフォーム投稿が DB 制約で失敗**します。
2. ★ **`cd client && npm run build`** — フォーム UI・エージェント起動入口（🤖ボタン/エージェントに送る/編集トリガー [#338](https://github.com/gamasenninn/tealus/issues/338)）・送信/表示まわりのリファクタが入っているため、再ビルド必須。
3. **`cd agent-server && npm install` + 再起動** — エージェント identity 口・編集トリガー（#338）を含むため。

**任意 / 条件付き:**

- **MCP から `send_form` を使う場合**は、`tealus-mcp` を **v0.14.8 以上**にしてください（タグ固定運用なら pin 更新 + フル再起動）。本体 server の更新だけでは MCP クライアント側は変わりません。
- **新しい必須の環境変数はありません。** cc-bridge 受付エコーの表示時間（`CC_ACK_TTL_MS`）など既定値ありの任意 env のみです。

**この版で直った不具合（更新すれば解消）:**

- スリープ復帰後に「考え中 / 入力中」表示が残る（[#340](https://github.com/gamasenninn/tealus/issues/340)）
- 汎用フォームの回答ボタンが何度も押せてしまう二重回答（[#341](https://github.com/gamasenninn/tealus/issues/341)）

---

## よくある詰まり（トラブルシューティング）

| 症状 | 原因 | 対応 |
|------|------|------|
| 辞書育成タブが 500 になる | DB migration 忘れ（[#334](https://github.com/gamasenninn/tealus/issues/334)） | 起動ログ `[migration-check]` を確認 → `cd server && npm run migrate` |
| フォームが崩れて表示 / 送っても AI が起動しない | クライアント未ビルド、または migration（026）未適用 | 手順 3・4 を実行。MCP 経由で送るなら `tealus-mcp` のバージョンも確認 |
| 画面が古いまま変わらない | ブラウザ / PWA のキャッシュ | ハードリロード（`Ctrl/⌘+Shift+R`）、PWA は再度リロード |
| AI エージェントが無反応 | `agent-server` の `npm install` / 再起動忘れ | 手順 2・5 を実行 |
| MCP で「トークンが無効です」 | 本体 server 再起動で JWT が失効 | Claude Code を reload（stdio MCP の JWT は server restart で失効する） |
| MCP に新ツールが出ない | in-app reload / `/mcp` 再接続では反映されない | Claude Code を**フル再起動**（タグ固定なら pin も更新） |

---

## 切り戻し（更新で問題が出たとき）

```bash
git checkout v0.5.0     # 元のバージョンへ
cd client && npm install && npm run build
cd ../server && npm install
# プロセス再起動（server → agent-server → rtc-server）
```

- **DB migration は基本「進める」方向のみ**です。新 migration が既存データを壊す設計は避けていますが（v0.6.0 の 026 は制約拡張のみで後方互換）、心配なら手順 0 のバックアップから復元してください。
- 破壊的変更を伴うバージョンは、その版の「バージョン別ノート」に必ず明記します。
