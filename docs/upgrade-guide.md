# アップグレードガイド — 新しいバージョンへの更新手順

自己ホストで Tealus を運用している採用者向けに、**既に動いている環境を新しいバージョンへ更新する**手順をまとめます。新規インストールは [README のセットアップ](../README.md#セットアップ) を参照してください。

> **要点だけ先に**: 更新の急所は **`cd server && npm run migrate`（DB 更新）** と **`cd client && npm run build`（画面の再ビルド）** の 2 つ。これを忘れると「クラッシュはしないが機能が静かに壊れる」状態になります（[#334](https://github.com/gamasenninn/tealus/issues/334)）。迷ったら下の「更新後の健全性チェック」で起動ログを確認してください。

---

## 基本の更新手順（どのバージョンでも共通）

Tealus はサーバをビルドレス実行（Node の型ストリッピング）するため、**サーバ側のビルドは不要**です。更新で必要なのは「コード取得 → 依存更新 → DB migration → クライアント再ビルド → 再起動」の 5 ステップです。

> ★ **`docker-compose.full.yml` で動かしている場合は、下の 2〜5 の代わりに次の 2 行です**（[#558](https://github.com/gamasenninn/tealus/issues/558)）。
> Tealus のイメージは公開しておらず、手元のソースから作ります。**`git pull` だけではイメージは古いまま**なので、必ず作り直してください。
> migration は server の起動時に先に走ります。
>
> ```bash
> git pull
> docker compose -f docker-compose.full.yml up -d --build
> ```

### 0. 事前準備（推奨）

```bash
# いま動いているバージョンを控えておく（切り戻し用）
git describe --tags        # 例: v0.5.0

# DB のバックアップ（任意だが本番では推奨。docker-compose で PostgreSQL を動かしている場合）
docker-compose exec -T postgres pg_dump -U tealus tealus > backup-$(date +%Y%m%d).sql
```

> ★ **Windows の PowerShell 5.1 では上の `>` を使わないでください**。`>` が文字コードを変えて、ダンプが壊れます ([#566](https://github.com/gamasenninn/tealus/issues/566))。
> コンテナの中でファイルに書いてから取り出す形にします (custom 形式。戻し方は下の「壊れたときの復元」):
>
> ```powershell
> docker exec tealus_postgres pg_dump -U tealus -Fc -f /tmp/backup.dump tealus
> docker cp tealus_postgres:/tmp/backup.dump .\backup.dump
> ```

> ★ **コンテナ名は構成で違います**。ここの例は開発用の `docker-compose.yml` (`tealus_postgres`)。本番用の `docker-compose.full.yml` で動かしているなら **`tealus_postgres_prod`** に読み替え、`docker-compose exec` には `-f docker-compose.full.yml` を付けます。迷ったら `docker ps` で名前を確かめてください。

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
cd ../dashboard  && npm install      # postinstall で dashboard/dist を自動再ビルド（管理画面 /system）
```

> `agent-server` の `npm install` 忘れは、AI エージェント（Light/Deep）や cc-* ブリッジが動かない典型原因です。

### 3. ★ DB を更新（migration）

```bash
cd server
npm run migrate
```

- migration は **`server/.env` の DB 接続情報**を使います（先に `.env` があること）。
- 適用済みのファイルは台帳 (`schema_migrations`) に記録され、**未適用のものだけ**が流れます（[#406](https://github.com/gamasenninn/tealus/issues/406)）。何度流しても安全です。
- `N 件の migration を適用しました。` か `適用済みです` が出れば成功。
- ★★ **台帳の無い DB (v0.9.0 以前、または 2026-10-10 より前の `docker-compose.yml` の初回起動で作った DB [#557](https://github.com/gamasenninn/tealus/issues/557)) では一度止まります。** Docker で作った DB は、止まったときの案内の「Docker の初回起動で…作った DB なら」に従ってください。 案内に出る `--baseline` は「最新まで当ててある DB」用です。**v0.9.0 から上げるなら `npm run migrate -- --baseline-through 026_message_form_type.sql` → `npm run migrate` の順に**（[#500](https://github.com/gamasenninn/tealus/issues/500)、下の「→ v0.10.0」）。

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
| `[build-check] dashboard/dist/index.html が見つかりません` | エージェントのダッシュボード (/system) 未ビルド。エージェントの設定・ログが見られない (★ ユーザーと webhook は本体の 管理ダッシュボード `/admin` で作るので影響しない) | `cd dashboard && npm install`（postinstall でビルド） |
| `[migration-check] ★ 未適用 N 件: …` (v0.11.1 以降) | DB migration 忘れ | 手順 3（`npm run migrate`）を実行。★ 名前が出たものが流れていない |
| `[migration-check] ★ 未適用の migration が N 件あるので起動しません: …` (v0.12.0 以降) | DB migration 忘れ。★ **本体は起動せずに終わる** (流す前に起動すると、新しい列を読む口が全部 500 になるため) | 手順 3（`npm run migrate`）を実行してから、もう一度起動 |
| `[media] removed_media の表がありません` | DB migration 忘れ (v0.11.0 の 040) | 手順 3（`npm run migrate`）を実行。★ そのままだと削除した部屋の添付がまだ開ける |
| `[model-guard] ... は ChatGPT アカウント (subscription) の codex では使えません` (agent-server) | Codex のモデルが外されたもの | v0.11.0 のノートの 1. を参照 |

> 「起動しません」の行を除いて、どれも **稼働は止まりません**（フォールバックで動き続ける）。だからこそ「気づかないうちに機能だけ欠ける」ので、更新直後にログを一度確認してください。

### 画面（ブラウザ / PWA）

- **ハードリロード**で新しい画面を読み込みます（`Ctrl+Shift+R` / macOS は `⌘+Shift+R`）。
- PWA（ホーム画面アプリ）はサービスワーカーのキャッシュのため、**1 回で変わらなければもう一度リロード**（またはアプリを閉じて開き直し）。

### MCP（tealus-mcp を使っている場合）

- ツール（例: `send_form`）が増えたバージョンに上げたら、**Claude Code をフル再起動**してください。in-app reload や `/mcp` 再接続では stdio 子プロセスが生き残り、反映されません。
- `.mcp.json` でバージョンをタグ固定している運用（例: `github:gamasenninn/tealus-mcp#v0.14.6`）は、**pin を新しいタグに上げてから**フル再起動が必要です。

---

> リリースを**出す側**の手順は [リリース チェックリスト](release-checklist.md) を参照してください。

## バージョン別ノート

### → v0.12.0（アプリの通行証 / お客様のタブ / 初回のパスワード変更 / 入口の締め直し）

> **★ 影響範囲**: **全員に作業があります。** DB migration が 5 本 (`041`〜`045`)、client の再ビルドも要ります。
> ★★ この版から、**migrate を忘れると本体は起動しません** (下の 1.)。通話 (rtc-server) を使っている環境は 4.、ルームごとの AI の設定を手で置いている環境は 5. も読んでください。
> 一覧は [CHANGELOG](../CHANGELOG.md) の v0.12.0。

**必須の作業:**

#### 1. ★★★ migrate は再起動の前に (忘れると本体が起動しない)

```bash
cd server && npm run migrate      # 041〜045 の 5 本が流れる (v0.11.1 の DB には台帳があるので、そのまま続きから)
```

- 出力に `Running migration: 041_portal_links_pass.sql` 〜 `045_users_is_external_contact.sql` と `5 件の migration を適用しました。` が出れば成功 (v0.11.1 の形の DB で実際に流して確かめています)
- ★ 5 本とも列・表を**足すだけ**です。v0.11.1 の本体が動いたまま流して構いません (流してから再起動、の順が止まる時間が最も短い)
- ★★ **流す前に新しい本体を起動すると、起動せずに終わります** (`[migration-check] ★ 未適用の migration が 5 件あるので起動しません: …` を error で出して終了コード 1)。以前は起動して warn を出すだけで、下の表の口が失敗し続けました
- ★ `npm run dev` (nodemon) で動かしている環境は、**`git pull` の時点で自動で再起動がかかり、ここで止まります**。migrate のあと、手で起動し直してください (ファイルが変わらないので nodemon は自分では戻りません)。落ちたら起こし直す仕組み (pm2・サービス) の下では、migrate を流すまで起動と終了を繰り返します
- 起動を止めるのは「未適用が確か」なときだけです。DB に届かない・台帳が無いときは `[migration-check] 未適用かどうかを確かめられないまま起動します: …` を warn に出して起動するので、そのときは下の表のとおりに壊れます

| 番号 | 中身 | 流さずに動くと |
|---|---|---|
| 041 | アプリの通行証 (`portal_links.pass`、#607) | ホーム画面のタブ (`GET /api/rooms/portal-links`) が全員 500 |
| 042 | 初回ログインでパスワードの変更を求める印 (`users.must_change_password`) | ★★★ **ログインもその後の操作もすべて失敗する** (認証のたびにこの列を読む) |
| 043 | 削除した投稿の本文の退避 (`deleted_message_contents`) | 投稿の削除が失敗する |
| 044 | 指示の履歴の ☆ 固定 (`prompt_pins`) | 指示の履歴が出ない |
| 045 | 社外の窓口の印 (`users.is_external_contact`。トーク一覧のタブ「お客様」) | ★ トーク一覧 (`GET /api/rooms`) が全員 500 |

#### 2. ★ 依存を入れ直す (server / agent-server / rtc-server)

新しく増えたパッケージはありませんが、3 つとも依存の版 (package-lock) が上がっています。基本の手順 2 のとおり、各パッケージで `npm install` を。client と dashboard は依存の変更なしですが、`npm install` が再ビルドを兼ねます。

#### 3. ★ client を本番ビルドし直す

ビルドしないと次のものが**エラーなしで出ません**: 初回ログインのパスワード変更の画面 (042 の印は付くのに、画面が求めない)・タブ「お客様」・アプリの通行証・ログインの鍵の延長 (下の「挙動が変わるもの」)・通知の宛先が無い人への案内。

#### 4. ★★ 通話・トランシーバー (rtc-server) を使っている環境

rtc-server の入口 (`/ws`) は、**ログインした、その部屋のメンバーだけ**を通すようになりました。鍵なしで入れるのは同じマシンから直接つないだものだけです。rtc-server を再起動したうえで、次の 2 つを確かめてください。

- **`JWT_SECRET` が本体と同じ値で rtc-server に届いていること**。rtc-server は `server/.env` を読みます (Docker は `rtc-server/.env`)。空だと全員が「鍵なし」扱いになり、リバースプロキシ越しの接続は `[WS] 鍵の無い接続を断りました` で切られます
- ★★ **rtc-server を本体と別のマシン・別のコンテナで動かしているなら `TEALUS_API_URL` に本体の URL を入れること**。メンバーかどうかは rtc-server が本体 (`GET /api/rooms/:id`) に聞きます。既定は `http://127.0.0.1:<PORT、既定 3000>` なので、届かないと**メンバーも全員「この部屋のメンバーではありません」で断られます** (rtc-server のログに `[WS] メンバーでない部屋への参加を断りました`)
- 鍵を付けずに別のマシンから `/ws` へつなぐ自作の道具は、つながらなくなります

#### 5. ★★ agent-server: 再起動の前に tealus-mcp を取っておく / ルームの設定の置き場が変わる

```bash
cd agent-server && npm install
npx -y github:gamasenninn/tealus-mcp#v0.17.0 < /dev/null     # ★ 最後まで流す (途中で止めない)
```

- agent-server が起動する tealus-mcp が **v0.14.7 → v0.17.0** に上がりました (`send_form`・`edit_message` が AI から見える)。版はコードの中 (`agent-server/src/lib/mcpPackages.mts`) なので設定は要りませんが、**上げて最初の起動は npx のダウンロードで遅く、AI の道具が時間切れで 1 つも出ないことがあります**。上の 1 行を先に流しておけば起きません。★ 途中で打ち切ると、欠けたキャッシュが残って道具が出ないままになります
- ★★ **ルームごとの設定 4 つ (`room_settings.json`・`light_prompt.md`・`mcp_config.json`・`CLAUDE.md`) の置き場が、AI の作業場所の外へ移りました**: `<AGENT_WORKSPACE_ROOT>/<agentId>/<roomId>/` → `<AGENT_WORKSPACE_ROOT>/_room-configs/<agentId>/<roomId>/`。今あるものは agent-server の**起動のときに自動で移ります** (ログに `[room-config] workspace 内の設定 N 個を外 (_room-configs) へ移しました`)。ダッシュボードから設定している環境は何もしなくて構いません
  - ★ **手でファイルを置いている環境は、これからは新しい置き場を編集してください**。古い置き場に置いたファイルは読まれません (次の起動で、新しい置き場に同じ名前が無いときだけ移ります。あると古い方は黙って無視されます)
  - ★ バックアップの対象に `_room-configs` を入れてください
- cc-bridge を使っている環境は、**消費側の skill も差し替えてください** (`.claude/skills/listen-tealus/` の `SKILL.md` と `cc-stream.sh`。取り方は「→ v0.9.0」と同じ)。張り直しのたびに古い待ち受けが残って増えるのを止める直しが入っています。サーバだけ上げても壊れません

**挙動が変わるもの (作業は不要):**

- **管理者が作った・パスワードを入れ直した人の利用者は、次のログインでパスワードの変更を求められます** (機械のアカウントと、今いる利用者には付きません)。新しく決めるパスワードは **8 文字以上**。★ 管理 API で利用者を作る自作のスクリプトは、8 文字未満だと 400 になります
- **ログインの鍵は、使っている間は延びます** (7 日。ただし最初のログインから 30 日で入り直し)。v0.11.1 で出した鍵はそのまま使えるので、上げた日に入り直しは起きません。本体は応答のヘッダー `X-Refreshed-Token` で新しい鍵を返します (読まない相手には影響なし)
- **部屋の AI の MCP 設定を書けるのはシステム管理者だけ** (`PUT/POST/DELETE /config/room/:id/mcp`)。読むのは今までどおり。会話モードでは `edit_message` を既定で外しました (部屋の設定で戻せます)
- 管理 API: 自分自身・最後の有効なシステム管理者は無効にも一般にもできません。`is_active` は `true` / `false` だけ (文字列の `"false"` を送るスクリプトは 400)。役割は `admin` / `user` / `guest` だけ。部屋の最後の有効なグループ管理者は、解除も退会させることもできません
- bot の画像の口 (`/api/bot/push-image`、`/api/bot/push-file` で種類が `image/*` のとき) は、HEIC・BMP と途中で切れた画像を 400 で断ります。部屋のアプリ・ホームのリンク・webhook の宛先は `http` / `https` の URL だけ
- 通知の宛先は、30 日送り直されなければ本体が外します (その人のいちばん新しい 1 本は外しません。その端末で開き直せば戻ります)。機械のアカウントには部屋の通知を送りません
- `GET /api/auth/me` に `push_active_subscriptions` (有効な通知の宛先の本数) が増えました。0 本の人には画面が案内を出します
- `@Claude` の別名 (`agent-server/config/cc-aliases.json`) を既定から外しました。使っていた環境は自分で足してください。★ このファイルを手元で書き換えていると `git pull` がぶつかります (先に退避を)

**任意 (新しい必須の環境変数はありません):**

| 環境変数 / 設定 | 既定 | |
|---|---|---|
| `APP_PASS_KEY_DIR` (server) | `~/.tealus/app-pass` | アプリの通行証 (#607、`docs/11`) の鍵 `<ホスト名>.key` の置き場。鍵を置かなければ通行証は出ません (機能は止まったまま) |
| `APP_LOGIN_TARGETS` (server) | 空 (= 誰にも出さない) | ブラウザから「Tealus でログイン」(`docs/11` §5.5)。`<origin>\|<戻り先のパス>` をカンマで並べる。例: `https://portal.example.com\|/auth/callback` |
| `PUSH_STALE_DAYS` / `PUSH_INACTIVE_DELETE_DAYS` (server) | `30` / `90` | 通知の宛先を外すまで・無効の宛先を消すまでの日数 |
| `TEALUS_API_URL` (rtc-server) | `http://127.0.0.1:3000` | 上の 4. |
| `OPENAI_IMAGE_MODEL` (agent-server) | `gpt-image-1` | 画像生成のモデル。この版から `.env` に書いた値が tealus-mcp に届きます |
| `TAVILY_API_KEY` (agent-server) | なし | web 検索を使うなら `.env` に置き、`mcp_config.json` の `env` で `${TAVILY_API_KEY}` と引く (#573) |
| `ENABLE_CROSS_ROOM_DELEGATION` (agent-server) | off | 部屋をまたいで仕事を頼む (`%<部屋> <頼みごと>`)。以前からある設定で、`.env.example` に書かれていなかっただけです |
| `AGENT_PENDING_JOURNAL` (agent-server) | `~/.tealus/agent/pending-work-<ポート>.json` | AI の仕事の控え (予告なしに止まったあと、次の起動で「中断されました」を知らせる) |
| `BACKUP_LOG_DIR` (agent-server) | なし | 入れると `npm run doctor` がバックアップの記録を見ます |

- **見張り** (`server/config/watchdogs.json`、`docs/09`): 見方が 2 つ増えました (`push_reach` 通知が届かない人 / `disk_free` 空き容量)。`alert_after` (何回続けて異常なら知らせるか、既定 1) も。書き方は `watchdogs.example.json`。足さなければ今までどおりです
- **MCP (Claude Code の側の tealus-mcp)**: タグ固定の運用なら pin を `#v0.17.0` に上げてフル再起動 (検索で見つけた投稿の全文の取り方・`search_messages` の `type` に `file` / `form`)
- Windows でログオン時に本体と agent-server を上げる `scripts/startup/tealus-autostart.ps1` を足しました (登録は自分で。冒頭の説明を参照)
- `AGENT_CODEX_BIN` を指定しなければ、Deep も agent-server の `node_modules` の codex (Light v2 と同じ版) を使います

**切り戻すとき (v0.11.1 へ):** DB はそのままで動きます (041〜045 は足すだけ。v0.11.1 は知らない台帳の行を無視します)。★ ただし **ルームの設定は `_room-configs` に移ったまま**なので、v0.11.1 の agent-server からは見えず、ルームの設定が既定に戻ったように動きます。戻すなら `_room-configs/<agentId>/<roomId>/` の中身を `<agentId>/<roomId>/` へ写してください。

**この版で直った不具合（更新すれば解消）:**

- ログインの期限 (7 日) が切れたとき、端末の通知の登録まで外していた (iPhone は自分で作り直せず、通知が止まったままになる)
- 通知の宛先が 0 本になった人に、画面が何も言わなかった / 招待された人に、入る前の便が全部「未読」で出ていた
- 誰も消せない部屋が残った ([#643](https://github.com/gamasenninn/tealus/issues/643)) / 同じ名前のグループに気づけなかった
- 部屋の知らせのたびに、全タブ・全パネルがそれぞれ部屋の一覧を取りに行っていた / 端末の読み込みの繰り返しで本体が大量に叩かれても誰も気づけなかった (`[http-flood]` を warn に 1 行)
- DB が止まったときの失敗の理由がログで空だった / DB の失敗を 401 で返し、利用者がログイン画面へ落ちていた (500 に)
- 見張りがバックアップの記録 (NAS) を同期で読み、NAS が応答しないと本体の全部が止まる形だった
- 画像生成のモデル名 `OPENAI_IMAGE_MODEL` が tealus-mcp に届いていなかった / node 直起動の Docker で Deep (codex) が codex を見つけなかった
- 文字起こし・文字の投稿を同じ文のまま保存すると版が積まれていた

### → v0.11.1（0.11.0 の監査で見つかった穴 2 つ）

- 0.11.0 から上げる場合: `git pull` → **server の再起動**だけ (migration・依存・client の変更なし)
- 0.10.0 から上げる場合: 下の「→ v0.11.0」が全部当てはまります。★ 0.11.1 では、migrate を忘れて起動すると `[migration-check] ★ 未適用 N 件: …` が名前つきで出ます。040 を流す前でも部屋の削除は止まりません

### → v0.11.0（見張り / トークを先に出す / 音声編集のキーボード操作 / Codex のモデル）

> **★ 影響範囲**: **全員に作業があります。** DB migration が 7 本 (`034`〜`040`)、client の再ビルドも要ります。
> ★★ ChatGPT アカウントで Codex を使っている環境 (`LIGHTV2_AUTH=subscription` / `DEEP_AGENT_PROVIDER=codex`) は **1. が最優先**です。
> 一覧は [CHANGELOG](../CHANGELOG.md) の v0.11.0。

#### 1. ★★★ Codex のモデルと codex-sdk（ChatGPT アカウントで使っている環境）

2026-10-14 19:00 UTC に、OpenAI が **gpt-5.5 を ChatGPT アカウントの Codex から外しました**。そのままだと議事録などの Light v2 と Deep Codex が止まります
(画面: 「そのモデルは ChatGPT アカウントの codex では使えません…」/ ログ: `The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account`)。

```bash
cd agent-server
npm install                       # @openai/codex-sdk ^0.162.1 が入る (★ 古い 0.128 は新しいモデルを断る)
npx codex exec --skip-git-repo-check -s read-only -m gpt-5.6-sol "OK とだけ返して"   # ★ 1 回試す
```

通ったら `agent-server/.env` を:

```bash
AGENT_LIGHT_MODEL=gpt-5.6-sol
AGENT_DEEP_CODEX_MODEL=gpt-5.6-sol
```

agent-server を再起動します。

- ★ **モデルだけ替えても直りません** — codex 0.128 は gpt-5.6-sol を「新しい版にしてください」で断ります (本家で実測)
- ★ OpenAI の案内の `gpt-6.1-sol` も codex 0.162.1 なら通ります (0.154 以前は not supported)。プランや時期で使えるモデルは変わるので、**必ず 1 回試してから**設定してください
- ★ `AGENT_CODEX_BIN` を指定しなければ、Deep も agent-server の node_modules の codex (Light と同じ版) を使います (v0.12.0 から。それまでは node 直起動の Docker で Deep が codex を見つけませんでした)。`AGENT_CODEX_BIN` でグローバルの codex を指している場合、Deep はそちらを使います。グローバルの codex も上げてください (`npm i -g @openai/codex`)。gpt-5.6-sol なら 0.154 以上、gpt-6.1-sol なら 0.162 以上 (本家で実測)
- API キーで使っている環境は影響ありません

#### 2. ★★★ migrate は再起動の前に (忘れると 034 でログインもできない)

```bash
cd server && npm run migrate      # 034〜040 の 7 本が流れる (v0.10.0 の DB には台帳があるので、そのまま続きから)
```

| 番号 | 中身 | 忘れると |
|---|---|---|
| 034 | 通知音をアカウントの設定に (`users.notification_sound`) | ★★★ **ログインもその後の操作もすべて失敗する** (ログインと認証のたびにこの列を読む。プッシュの送信も) |
| 035 / 039 | 添付の索引 | 遅くなるだけ |
| 036 | 辞書の語の `seen_at` | ★ organon からの取り込み (辞書の語の登録) が失敗する |
| 037 | 見張りの鼓動 (`heartbeats`) | `/api/bot/heartbeat` が失敗する |
| 038 | 転送の参照の縛りを外す | 転送された投稿がある部屋を削除できない (500) |
| 040 | 削除した部屋の添付 (`removed_media`) | ★ 0.11.0 では**部屋の削除が 500** (0.11.1 で直した: 記録を飛ばして削除は通す)。削除した部屋の添付が開けたまま (`[media] removed_media の表がありません` を warn) |

#### 3. ★ client を本番ビルドし直す

画面の変更が多い版です (トークを先に出す #600・音声編集のキーボード操作 #604・送信の受け取り #593 など)。ビルドしないと何も変わりません (エラーは出ません)。

#### 4. ★ 10-10〜10-11 に入った 2 つの注意 (v0.10.0 から上げる環境は全部当てはまる)

- **AI の子プロセスへ渡す環境変数は許可一覧になった** (#565 #570 #573) — MCP の道具が親の環境変数に頼って鍵を読んでいた場合、**黙って届かなくなる**。手順は [ルームの workspace から資格情報を追い出す（#419）](#-ルームの-workspace-から資格情報を追い出す419) の節の「★ #573」
- **npx で起動する MCP の道具は版を固定する** (#577) — 同じ節の「★ #577」

#### 5. 任意

- **本番は `NODE_ENV=production` を推奨** (#603)。★ production では記録の既定が info になり、ログイン・REST の `[debug]` 行が消えます。今までどおり残すなら `LOG_LEVEL=debug` も
- **見張り** (#595、`docs/09`): `server/config/watchdogs.example.json` を写して `watchdogs.json` に。Tealus の部品 (無線の送り込みなど) は `tealus-cli ... --heartbeat <名前>` で鼓動を送れます。Windows 向けのバックアップのスクリプトは `scripts/backup/`
- 中継先: `AGENT_URL` / `RTC_URL` / `MCP_HTTP_URL` (#556)。LINE のアルバムの束ね待ち: `LINE_IMAGESET_FLUSH_MS` / `LINE_IMAGESET_MAX_WAIT_MS` (#552)
- Docker: compose は初回起動で migration を流しません (#557)。`up -d --build` で (#558)

### → v0.10.0（ルームトリガー / 会話モード / 読み上げのエンジン / 入口の締め直し）

> **★ 影響範囲**: **全員に作業があります。** DB migration が 7 本 (`027`〜`033`)、client の再ビルドも要ります。
> v0.9.0 から上げるときの手順は下の **0.** が最優先です。そのあとの節は、この版に入った作業の多い変更ごとの手順です。
> 一覧は [CHANGELOG](../CHANGELOG.md) の v0.10.0。

#### 0. ★★★ v0.9.0 から上げるときの migrate（[#500](https://github.com/gamasenninn/tealus/issues/500)）

v0.9.0 の DB には migration の台帳 (`schema_migrations`) がありません。そのため `npm run migrate` は
「どこまで適用済みか判定できません」と**止まります**。

```bash
cd server
npm run migrate -- --baseline-through 026_message_form_type.sql   # 026 までを「適用済み」と記録するだけ
npm run migrate                                                    # 027〜033 の 7 本が流れる
```

- ★★ **止まったときの案内に出る `--baseline` (上限なし) は打たないでください。** 全ファイルを「適用済み」と記録するだけなので、
  **027〜033 が流れないまま適用済みになり、静かに壊れます** (会話モードの設定・通知のオフ・LINE の引用返信の表が無いまま動く)
- 2026-09-05 以降の main を追っていて、一度 baseline 済みの環境は、ふつうに `npm run migrate` だけで残りが流れます
- 確認: 2 行目の出力に `Running migration: 033_line_message_links.sql` が出ること。`npm run doctor` の `db-migrations` が「未適用 0 件」になること

#### → 2026-09-27〜10-01 の分（通知の設定 / 受け口の締め直し）

> **★ 影響範囲**: **全員**に作業が 2 つ (migration と client のビルド)。agent-server と本体の webhook を使っている環境は、**鍵を両側に入れる**作業が 1 つ増えます (推奨)。一覧と理由は [CHANGELOG](../CHANGELOG.md) の「★ 更新時の急所」。

**1. migration と client のビルド (全員)**

```bash
cd server && npm run migrate      # 031_room_member_push_muted / 032_room_push_machine_posts
cd ../client && npm run build     # 通知の設定画面・「いま見ている部屋」・日付へ飛ぶ
```

★ migration を忘れても**止まりません**。通知を送る所でエラーになり、**通知が黙って送られなくなる**だけです (ログに `sendPushToRoomMembers error`)。

**2. webhook の鍵を両側に入れる (agent-server を使っている環境・推奨)**

```
① 本体の管理画面 → Webhook → http://localhost:4000/webhook/tealus の secret に値を入れる
② agent-server/.env の WEBHOOK_SECRET に同じ値を入れる
③ agent-server を再起動
```

- ★ **①を先に**。本体が署名を付けて送り始めても、古い agent-server は署名を見ないので通知は途切れません
- ★★ **②だけ (agent-server 側だけ) にすると、署名の無い通知を 401 で断るので、エージェントが黙って起きなくなります** (agent-server のログに `Webhook signature missing or mismatch`)
- 両方空のままなら以前どおり動きます (起動時と `npm run doctor` で警告が出ます)

**3. 挙動が変わるもの (作業は不要)**

- 人の利用者のアカウントで `/api/bot/rooms/:id/join` を呼んでいる自作のツールは 403 になります (ボットだけ)
- アップロードした HTML の中から、ブラウザの保存領域 (localStorage 等) は使えなくなります
- `localhost` / LAN の URL にはリンクプレビューが付かなくなります
- 自己登録は「人の利用者が 0 人のとき」だけ。開発用 compose の DB は `127.0.0.1` だけで待ち受けます

**健全性チェック**: `npm run doctor` で `webhook-secret` の warn が出ないこと (鍵を入れた場合)。

#### → ルームの workspace から資格情報を追い出す（#419）

> **★ 影響範囲**: **`DEEP_AGENT_PROVIDER=codex` を使ったことがある環境だけ**に、**手を動かす作業があります**（[#419](https://github.com/gamasenninn/tealus/issues/419)）。使っていない環境と新規インストールは、**何もする必要がありません**。

**なぜ手作業が要るのか（★ pull しただけでは終わりません）**

`prepareCodexHome` は `<WORKSPACE_ROOT>/<agentId>/<roomId>/.codex_home/` を作っていました。ここは
**filesystem MCP の root の中**なので、agent が `read_file` で読めます。中身は:

```
auth.json           ChatGPT の OAuth トークン
config.toml         OPENAI_API_KEY / GOOGLE_API_KEY / TEALUS_PASSWORD
sessions/rollout-*  codex のセッション記録（★ 中身に鍵が写り込みます）
*.sqlite            codex の会話履歴 / memories / logs
```

新しいコードは `<WORKSPACE_ROOT>/_codex-homes/<agentId>/<roomId>` に書き、**workspace 内の古いものを見つけたら消します**。
このため、**何もしないと次の 2 つが起きます**:

```
Deep が走ったルーム    → 古い .codex_home は自動で消える
                        ★★ ただし コードは「消す」。codex のセッション記録ごと消えます
Deep が走らないルーム  → ★ 残ったまま。読める状態が続きます
```

**必須の作業（★ 削除ではなく「移動」させてから更新する）:**

1. **移す**（セッション記録を残したまま、読める場所から外す）

   ```bash
   cd agent-server
   node --env-file=.env scripts/migrate-codex-homes.mts          # 下見（何もしません）
   node --env-file=.env scripts/migrate-codex-homes.mts --apply  # 移動
   ```

   ★ 下見が「workspace の中に .codex_home はありません」と出たら、**この節は読み飛ばして構いません**。
   ★ 実行すると **移行前後のファイル総数が一致するか**を出します。一致しなければ止めて確認してください。

2. **agent-server の再起動** — 反映に要ります。それまでは古いコードが動くので、Deep が走ったルームでは
   `.codex_home` が作り直されます。

3. **確認**（★ 全深さで走査します。`ripgrep` / `grep -r` は**既定で dot-dir を飛ばす**ので使わないでください）

   ```bash
   node --env-file=.env scripts/scan-workspace-secrets.mts
   ```

   次の 2 行が出れば完了です。

   ```
   ★ 資格情報らしきものは 0 件でした (値は一切出していません)
   コードが workspace に書くもの (.codex_home / .deep_mcp_config.json): 0 件
   ```

   ★ このスクリプトは**値を一切出しません**（ファイル名と種類だけ）。

**★ 手書きの `mcp_config.json` に資格情報を入れている場合は、別途 1 つ:**

ルーム固有 MCP の設定に接続文字列を直接書いている場合、**それは自動では移りません**。
`${VAR}` の参照に書き換え、実体を `agent-server/.env` に置いてください（展開は `lib/envRefs.mts`）。

```jsonc
// 変更前
"args": ["-y", "@bytebase/dbhub@1.5.0", "--transport", "stdio", "mysql://user:pass@host:3306/db"]
// 変更後（実体は agent-server/.env の HKSDB_DSN へ）
"args": ["-y", "@bytebase/dbhub@1.5.0", "--transport", "stdio", "${HKSDB_DSN}"]
```

★ #577 `@latest` や版なしにしないでください。起動のたびに、その時 registry が返す版が動きます (DSN を渡す子プロセスが、確かめていないコードになる)。上げるときは版を書き換え、先に手で 1 回 `npx -y <名前@版>` を流してキャッシュに入れます。

★ 未定義の変数は**そのまま残ります**（空文字にすると `mysql://:@host/db` のような
「それらしく見えて壊れている」値になり、原因が分からなくなるため）。起動ログの `envRefs` の警告で気づけます。

**★ #573 (2026-10-11 以降の版) 道具の子プロセスは親の環境変数を受け継がなくなりました:**
MCP の道具 (グローバル・ルーム固有とも) に渡るのは、PATH などの許可した変数と、設定の `env` に書いたものだけです。
`agent-server/.env` の API キーを「書かなくても届いていた」設定 (例: tavily の `TAVILY_API_KEY`) は、`env` に参照を足してください。
また、本体の中核の鍵 (`JWT_SECRET` / `WEBHOOK_SECRET` / `DB_PASSWORD` / `DATABASE_URL` / bot のパスワード) は `${VAR}` で引けません。

```jsonc
"tavily": { "command": "npx", "args": ["-y", "tavily-mcp@0.2.18"], "env": { "TAVILY_API_KEY": "${TAVILY_API_KEY}" } }
```

**#419 そのものの DB migration は追加ゼロ**です。★ ただし同じ v0.10.0 で、ほかの変更が migration を足しています (下の「この版のほかの変更」と、この節の **0.**)。

**★ 鍵を入れ替えるかどうか**は、環境ごとに判断してください。判断材料の集め方（いつから読める状態だったか /
読まれた形跡があるか）は [#419](https://github.com/gamasenninn/tealus/issues/419) のコメントに実例があります。
★ 本家の環境では「外部公開されておらず、到達できたのは社内メンバーだけで、読まれた証拠が無い」ため
**入れ替えない**判断をしました。★★ ただし「読まれていない」ことが証明されたわけではありません。

#### → この版のほかの変更 (2026-09-28)

**★ DB migration が 2 本増えました** (031 ルームごとの通知オフ [#463](https://github.com/gamasenninn/tealus/issues/463) / 032 機械の投稿の通知 [#463](https://github.com/gamasenninn/tealus/issues/463))。
**必ず `npm run migrate` を流してから**本体を再起動してください。
★ 先に再起動すると、ルームを開く処理 (`GET /api/rooms/:id`) がエラーになり、通知も止まります。

**Redis を使わなくなりました** ([#466](https://github.com/gamasenninn/tealus/issues/466))。
当初の設計で入れていましたが、コードからは一度も使われていませんでした (キーは常に 0 件)。
`docker-compose.yml` / `docker-compose.full.yml` から外したので、Redis のコンテナを動かしている環境では:

```bash
# 開発用の compose で動かしている場合 (データは入っていないので消して構いません)
docker compose up -d --remove-orphans
# docker-compose.full.yml で動かしている場合
docker compose -f docker-compose.full.yml up -d --remove-orphans
# 残った空のボリュームを消す (任意)
docker volume ls | grep redisdata
```

`.env` の `REDIS_URL` はもう読まれません。消しても残しても動きは変わりません。

**★ 自己登録 (`POST /api/auth/register`) を最初の 1 人だけに閉じました。**
人の利用者が 1 人でもいれば 403 を返します。2 人目以降は、管理者が 管理ダッシュボード (本体の画面の プロフィール → 管理ダッシュボード、`/admin`) の「ユーザー」タブから作成してください。

### → v0.9.0（停止と寿命切断を必ず予告する / フォームの表示）

> **★ 影響範囲**: **フォームを使っている場合は全員に画面の変化があります**（[#370](https://github.com/gamasenninn/tealus/issues/370)）。それ以外（停止予告・寿命切断の理由）は **cc-bridge（`@cc-*`）を使っている環境にのみ**効きます。

**必須の作業:**

1. ★ **client を本番ビルドし直す** — フォームの表示変更（文字サイズ追随 / 横拡張 / 畳み込み）は **client のみの変更**です。ビルドしないと**画面は何も変わりません**。エラーは出ないので、**静かに変化ゼロ**になります。

   ```bash
   cd client && npm run build
   ```

2. **server / agent-server の再起動** — 本体サーバの graceful shutdown（[#368](https://github.com/gamasenninn/tealus/issues/368)）と寿命切断の予告（[#366](https://github.com/gamasenninn/tealus/issues/366)）を反映するため。

**DB migration: この版では追加ゼロ**です（最新は `026` のまま）。

**★ cc-bridge を使っている場合だけ、追加で 1 つ:**

**消費側の skill も差し替えてください。** `.claude/skills/listen-tealus/SKILL.md` は `main` から取得する運用なので、**タグを打っても配布物は切り替わりません**。

```bash
S=~/.claude/skills/listen-tealus/SKILL.md
curl -o "$S" https://raw.githubusercontent.com/gamasenninn/tealus/main/.claude/skills/listen-tealus/SKILL.md

# ★ 接続コマンドだけを抜き出して構文を通す（Markdown 全体に掛けない）
awk '/^P=\{project_name\}/{f=1} f&&/^```/{exit} f' "$S" | sh -n && echo "構文 OK"
```

★ **サーバだけ更新しても壊れません**（新しい制御メッセージは `{"__` の前方互換で黙って無視されます）。ただし差し替えないと、**サーバが送る切断理由を使わず古い経過秒の窓で判定し続け**、ダウン秒数の過大表示（例: 実際 11 秒に対し `3309s down`）と `alive` 行の件数ずれも残ります。

**任意 / 条件付き（新しい必須の環境変数はありません）:**

| 環境変数 | 既定 | |
|---|---|---|
| `CC_GATEWAY_EXPECT_BACK_MS` | `30000` | ★ **新規。** 本体サーバの停止予告に載せる「戻ってくるまでの見込み」。デプロイに時間がかかる環境では伸ばす（超えた分は購読者側の通常判定で拾われます） |

- **★ 本体サーバの停止予告は、agent-server が動いていて初めて届きます。** 本体は「自分が落ちる」を知っていますが**購読者を知りません**（購読者を知っているのは agent-server 側）。予告に失敗した場合は warn を出して停止処理を続行します（agent-server が先に落ちている場合は普通に起こります）。**両方を止めるときは、本体を先に止めると予告が出ます。**
- **LINE ブリッジを新しく足す場合**、bot を招待した時点で group ID が catalog（`server/config/line-groups.json`）に載ります。**「1 通投稿してください」と頼む必要はもうありません**（[#367](https://github.com/gamasenninn/tealus/issues/367)）。

**この版で直った不具合（更新すれば解消）:**

- 別マシンのセッションが、**本体サーバの再起動のたびに予告なしで切られる**（[#368](https://github.com/gamasenninn/tealus/issues/368)。接続は本体を通り抜けているのに、予告を入れたのは agent-server だけだった）
- **寿命切断が「想定外」として通知される**（[#366](https://github.com/gamasenninn/tealus/issues/366)。2 台の時計が 55 分で 2 秒ずれると、経過秒からの逆算が誤判定する）
- **復帰通知のダウン秒数が過大**（[#366](https://github.com/gamasenninn/tealus/issues/366)。起点が切断時刻ではなく接続開始時刻だった）
- **LINE グループを足すときに、mapping を書くまでの投稿が捨てられる**（[#367](https://github.com/gamasenninn/tealus/issues/367)。実例では画像 1 枚を含む 3 件）
- **フォームだけ文字サイズ設定に追随しない**（[#370](https://github.com/gamasenninn/tealus/issues/370)）
- v0.8.0 の周知で案内した構文チェック `sh -n SKILL.md` が、**常に落ちるだけで何も検査していなかった**（上のコマンドが正しい形です）

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
S=~/.claude/skills/listen-tealus/SKILL.md
curl -o "$S" https://raw.githubusercontent.com/gamasenninn/tealus/main/.claude/skills/listen-tealus/SKILL.md

# ★ 接続コマンドだけを抜き出して構文を通す
awk '/^P=\{project_name\}/{f=1} f&&/^```/{exit} f' "$S" | sh -n && echo "構文 OK"
```

構文を通すのは、**zsh でしか動かない書き方が混ざっていても、書いた環境では気づけない**からです（`RANDOM` / `PIPESTATUS` など）。

★ **`sh -n "$S"` と Markdown 全体に掛けてはいけません。** frontmatter の 3 行目で必ず落ちるので、**接続コマンドまで到達せず、常に赤く出るだけの検査**になります（2026-08-02 に一度そう書いて配布し、Mac セッションの指摘で判明）。**「落ちるべきときに落ちるか」を確かめていない検査は、無いより悪い**（通ったつもりになる）。

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
| `git pull` が「package-lock.json を上書きできない」で止まる (Aborting) | 前回の `npm install` が手元の package-lock.json を書き換えた (自分で変えていなくても起きる。[#566](https://github.com/gamasenninn/tealus/issues/566)) | `git checkout -- server/package-lock.json client/package-lock.json agent-server/package-lock.json` で手元の変更を捨ててから `git pull`。そのあと手順 2 の `npm install` |
| MCP で「トークンが無効です」 | トークンの期限切れ (7 日)、本体の `JWT_SECRET` を変えた、またはそのアカウントを無効にした。★ 本体の再起動だけでは失効しない | Claude Code を reload (stdio MCP はログインし直す) |
| MCP に新ツールが出ない | in-app reload / `/mcp` 再接続では反映されない | Claude Code を**フル再起動**（タグ固定なら pin も更新） |

---

## 切り戻し（更新で問題が出たとき）

```bash
git checkout v0.5.0     # 元のバージョンへ
cd client && npm install && npm run build
cd ../dashboard && npm install
cd ../server && npm install
# プロセス再起動（server → agent-server → rtc-server）
```

- **DB migration は基本「進める」方向のみ**です。新 migration が既存データを壊す設計は避けていますが（v0.6.0 の 026 は制約拡張のみで後方互換）、心配なら手順 0 のバックアップから復元してください。
- 破壊的変更を伴うバージョンは、その版の「バージョン別ノート」に必ず明記します。

---

## 壊れたときの復元（DB・メディア・鍵と設定）

ディスクの故障・誤操作などで本体のマシンを作り直すときの順番です ([#566](https://github.com/gamasenninn/tealus/issues/566))。
**戻すには次の 3 つが要ります。** どれかが欠けると戻せないものがあるので、バックアップに入っているかを先に確かめてください。

| もの | 中身 | 無いと |
|------|------|--------|
| DB のダンプ | `pg_dump` の出力 (custom 形式 `-Fc` か、プレーン SQL) | 投稿・利用者・部屋がすべて失われる |
| メディア | `MEDIA_ROOT` の中身 (画像・動画・音声・ファイル・サムネイル) | 投稿は残るが、添付が開けない |
| 鍵と設定 | `server/.env`・`agent-server/.env`・`agent-server/mcp_config.json`、`.gitignore` で外している `server/config/` のファイル (ルームトリガー・LINE のグループ など) | ★ `VAPID_*` を失うと全員のプッシュの登録がやり直し。`JWT_SECRET` を失うと全員がログインし直し。設定ファイルは手で作り直し |

### 1. コードを取得

```bash
git clone https://github.com/gamasenninn/tealus.git && cd tealus
git checkout <ダンプを取ったときのタグ>   # 新しい版に上げるのは、戻し終わって動くのを見てから
```

### 2. 鍵と設定を元の場所へ置く

`server/.env`・`agent-server/.env`・`agent-server/mcp_config.json`・`server/config/` のファイルを、バックアップから同じ場所へ写します。

### 3. DB を戻す

```bash
docker compose up -d postgres
```

★ **DB のパスワードを合わせる**。新しく作った DB の利用者のパスワードは `docker-compose.yml` の `POSTGRES_PASSWORD` (既定 `tealus_dev`) になります。`server/.env` の `DB_PASSWORD` を別の値にしていたら、DB 側を合わせます:

```bash
docker exec -it tealus_postgres psql -U tealus -c "ALTER USER tealus PASSWORD '<server/.env の DB_PASSWORD>'"
```

★ この節の `tealus_postgres` も、本番用の構成では `tealus_postgres_prod` です (上の「コンテナ名は構成で違います」)。

ダンプを戻します (形式で 2 通り):

```bash
# custom 形式 (-Fc、ファイルの先頭が PGDMP)
docker cp backup.dump tealus_postgres:/tmp/backup.dump
docker exec tealus_postgres pg_restore -U tealus -d tealus --no-owner --no-privileges /tmp/backup.dump

# プレーン SQL (★ Windows の PowerShell 5.1 の < は使わない。bash で)
docker exec -i tealus_postgres psql -U tealus tealus < backup.sql
```

そのあと `cd server && npm run migrate`。ダンプには適用済みの台帳 (`schema_migrations`) も入っているので、ダンプより新しい migration だけが流れます。

### 4. メディアを戻す

バックアップのメディアを、`server/.env` の `MEDIA_ROOT` へ**中の並びのまま**写します (`images/`・`voices/`・`thumbnails/` …)。DB の投稿はこの相対パスでファイルを指しています。

### 5. 起動して確かめる

手順 2 (依存) と 4 (クライアントのビルド) をしてから、本体 → agent-server → rtc-server の順に起動します。確かめること:

- ログインできる / 古い部屋の投稿が出る / 画像・音声が開ける
- AI (`@アシスタント`) が答える
- プッシュ通知が届く (届かなければ `VAPID_*` が元と違う。各端末で通知を登録し直す)
