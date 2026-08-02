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

> リリースを**出す側**の手順は [リリース チェックリスト](release-checklist.md) を参照してください。

## バージョン別ノート

### → v0.8.0（AI セッションを別マシンで動かせるように）

> **★ 影響範囲**: 機能の中身は **cc-bridge（`@cc-*` で Claude Code を起こす仕組み）を使っている環境にのみ**効きます。メッセンジャーとして使っている場合、画面に見える変化はありません。**ただし下の「必須の作業」1 は全員が対象です。**

**必須の作業:**

1. ★ **Node 24 以上にする** — `engines` が 6 パッケージとも `>=20` / `>=22.6` から **`>=24.0.0`** に変わりました（`0cf9684`）。実行時の要件は以前から 24（Node native type stripping でビルドレス実行しているため）で、**宣言だけが古かった**のを実態に揃えたものです。**Node 22 以下では `npm install` が止まります**（loud に失敗するので気づけます）。

   ```bash
   node -v   # v24 以上であること
   ```

2. **server / agent-server の再起動** — cc-bridge の HTTP 経路（[#214](https://github.com/gamasenninn/tealus/issues/214)）を反映するため。

**DB migration: この版では追加ゼロ**です（最新は `026` のまま）。**client の再ビルドも不要**です（client の変更は内部リファクタのみ）。

**★ cc-bridge を使っている場合だけ、追加で 1 つ:**

**消費側の skill も差し替えてください。** `.claude/skills/listen-tealus/SKILL.md` は `main` から取得する運用なので、**タグを打っても配布物は切り替わりません**。

```bash
curl -o ~/.claude/skills/listen-tealus/SKILL.md \
  https://raw.githubusercontent.com/gamasenninn/tealus/main/.claude/skills/listen-tealus/SKILL.md
sh -n ~/.claude/skills/listen-tealus/SKILL.md   # ★ 配布前に構文を通す
```

`sh -n` を挟むのは、**zsh でしか動かない書き方が混ざっていても、書いた環境では気づけない**からです（`RANDOM` / `PIPESTATUS` など）。

★ **サーバだけ更新しても壊れません。**新しい制御メッセージは `{"__` で始まり、古い skill は**知らない制御行として黙って無視**します（前方互換）。ただし静音化と停止予告は効かないので、**55 分ごとと再起動のたびにセッションが起こされ続けます**。

**任意 / 条件付き（新しい必須の環境変数はありません）:**

| 環境変数 | 既定 | |
|---|---|---|
| `CC_STREAM_MAX_AGE_MS` | `3300000`（55 分） | 1 接続の最大寿命。★ **伸ばす / 外すと権限の更新が止まります**（下記） |
| `CC_STREAM_HEARTBEAT_MS` | `15000` | 無音時の keep-alive |
| `CC_SHUTDOWN_EXPECT_BACK_MS` | `30000` | 停止予告に載せる「戻ってくるまでの見込み」。デプロイに時間がかかる環境では伸ばしてよい |
| `CC_QUEUE_MAX_LINES` | `2000` | cc-queue の jsonl 上限（超えたら 1600 行に切り詰め、ログに出る） |

- **リバースプロキシ（Nginx 等）を挟んで cc-bridge を外に出す場合**は、ストリーム経路だけ `proxy_buffering off;` と長めの `proxy_read_timeout` が要ります（README の Nginx 例を参照）。バッファリングされると**行が届かず、通知がまとめて遅れて来ます**。
- **★ `CC_STREAM_MAX_AGE_MS` を伸ばさないこと。** 接続の認可は**接続時のスナップショット**で、JWT の検証も入口で 1 回だけです。「ルームから外された / ユーザーが無効化された / トークンが失効した」のどれも**開いている接続を止めません**（[#360](https://github.com/gamasenninn/tealus/issues/360)）。寿命で切ってクライアントに再ログイン + 再認可させることが、権限を新しく保つ唯一の経路です。既定の 55 分は nginx の `proxy_read_timeout 3600s` より短く取っています。

**この版で直った不具合（更新すれば解消）:**

- cc-queue ストリームの認可が古いまま残り続ける（[#360](https://github.com/gamasenninn/tealus/issues/360)。実測で 2 時間 26 分無切断の接続が出て顕在化）
- 別マシンのセッションが、**予定どおりの切断や計画的な再起動のたびに起こされる**（[#363](https://github.com/gamasenninn/tealus/issues/363) / [#365](https://github.com/gamasenninn/tealus/issues/365)。1 日 26 回 → 実イベントのみに）
- `docs/setup-cc-tealus-bridge.md` の skill 配置手順が、**存在しないファイル**をコピーするよう案内していた（しかも読み込まれない flat 形式）

**別マシンで動かす場合:** `docs/setup-cc-remote.md` を新設しました。**CC 自身が読んで実行する**形の手順書で、人間は raw URL を 1 本渡すだけです。★ **パスワードは人間が書きます**（`~/.tealus/cc-auth.json` を `chmod 600`）。

### → v0.7.0（PWA 更新検知 + エージェント指示の履歴）

**必須の作業:**

1. ★ **`cd client && npm run build`** — この版は**再ビルドしないと更新検知そのものが入りません**。ビルド時に `dist/version.json` が生成され、同じ ID がバンドルに焼き込まれます（[#356](https://github.com/gamasenninn/tealus/issues/356)）。server の `GET /api/version` はこの `client/dist/version.json` を読むため、**ファイルが無いと ID 不明として判定がスキップ**されます（誤検知を出さない設計なので、エラーにはならず静かに機能しません）。
2. ★ **`cd agent-server && npm install` + 再起動** — 依存に **`n3`（+ `@types/n3`）が追加**されました（[#348](https://github.com/gamasenninn/tealus/issues/348) の辞書 `.ttl` 読み込み用）。`npm install` を忘れると **agent-server が起動時に import 解決で落ちます**（これは silent でなく loud に失敗します）。
3. **server の再起動** — 静的配信の Cache-Control 分離（[#355](https://github.com/gamasenninn/tealus/issues/355)）と `GET /api/version` の追加を反映するため。

**DB migration: この版では追加ゼロ**です（`npm run migrate` は実行しても無害＝冪等ですが、新規適用はありません）。

**任意 / 条件付き:**

- **新しい必須の環境変数はありません。** 既定値ありの任意 env として `LINE_IMAGESET_FLUSH_MS`（LINE 複数画像の束ね待ち、既定 15 秒 / [#353](https://github.com/gamasenninn/tealus/issues/353)）が増えました。
- **リバースプロキシ（Nginx / Cloudflare 等）を挟んでいる場合**は、`index.html` / `sw.js` / `*.webmanifest` に対して **プロキシ側が独自の Cache-Control を上書きしていないか**を確認してください。#355 はオリジンが `no-store` を返すようにする変更なので、手前で上書きされると効きません。
- **organon を deploy していない環境**でも、辞書テーブル（manual + 自動学習）から `dictionary.local.ttl` が発行され、エージェント側の語彙正規化が効くようになりました（[#348](https://github.com/gamasenninn/tealus/issues/348)）。設定は不要です。

**★ この版に上げるときだけ、端末側は手動リロードが必要です:**

更新検知（#356）は「新しいクライアントが自分の陳腐化に気づく」仕組みなので、**まだ旧クライアントを開いている端末は、この版への更新自体は自動では気づけません**。各端末で 1 回だけハードリロード（PWA はアプリを閉じて開き直し、それでも変わらなければプロフィール画面の「キャッシュをクリア」）してください。**次回以降の更新からは、前面復帰時などに更新バナーが自動で出ます。**

更新できたかは、**プロフィール画面の下部に表示されるビルド ID** で目視確認できます（実機で新旧を判定する唯一の手段）。

**この版で直った不具合（更新すれば解消）:**

- iOS の PWA に更新が反映されない（[#355](https://github.com/gamasenninn/tealus/issues/355) / [#356](https://github.com/gamasenninn/tealus/issues/356)。standalone PWA は 2 日放置しても自己回復しないことを実機で確認済み）
- プロフィールの「キャッシュをクリア」が押しても無反応になる環境があった（[#356](https://github.com/gamasenninn/tealus/issues/356)）
- ルームのタグを削除できない（[#351](https://github.com/gamasenninn/tealus/issues/351)。管理トグルから削除可能に）
- LINE から複数画像を同時送信するとバラバラのメッセージになる（[#353](https://github.com/gamasenninn/tealus/issues/353)）

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
