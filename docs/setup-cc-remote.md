# 別マシンの Claude Code を Tealus につなぐ (#214)

> **このドキュメントは Claude Code 自身が読んで実行する手順書です。**
> 人間がやることは、このファイルの URL を CC に渡すことと、パスワードを 1 つ書くことだけです。
>
> ```
> https://raw.githubusercontent.com/gamasenninn/tealus/main/docs/setup-cc-remote.md を読んでセットアップして
> ```

## これは何をするものか

Tealus で `@cc-{project}` と書くと、Claude Code のセッションが**その場で起こされて返信する**仕組み (cc-bridge) を、**Tealus サーバとは別のマシンで**動かせるようにします。

**このマシンに Tealus の repo を clone する必要はありません。** 必要なのは Claude Code 本体と、これから設定する 2 つのファイルだけです。

### なぜ別マシンなのか

利便性ではなく **隔離**です。Tealus サーバと同じホストで AI を動かすと、`@cc-*` に反応する AI が本番 DB・メディアファイル・`server/.env` の秘密鍵に原理的に手が届きます。別マシンなら、届くのは HTTP API 越しに許可された範囲だけになります。

### 経路

```
[このマシン]                                    [Tealus サーバ]
  Claude Code                                     :3000 本体
    ├─ 往路 tealus-mcp (send_message 等) ───────►  /api/*
    └─ 復路 listen-tealus skill                    /agent-api/cc-queue/stream
         curl で NDJSON を受信      ◄────────────    (agent-server :4000)
```

往路 (CC → Tealus) と復路 (Tealus → CC) は別の仕組みです。両方の設定が要ります。

---

## ステップ 0. 人間にお願いすること

**先にこれを user に依頼してください。** ここから先はこの情報が無いと進みません。

1. **Tealus の URL** (例: `https://tealus.example.com`)
2. **bot ユーザの login_id とパスワード** — この CC セッションが Tealus 上で名乗るアカウント
3. **認証情報ファイルを user 自身に作ってもらう**:

   ```bash
   cat > ~/.tealus/cc-auth.json <<'EOF'
   { "login_id": "AI_AGENT", "password": "ここにパスワード" }
   EOF
   chmod 600 ~/.tealus/cc-auth.json
   ```

   ★ **パスワードは CC が書かないでください。** user 自身にこのコマンドを実行してもらいます (`!` プレフィックスでこのセッション内から実行してもらうのが楽です)。

`~/.tealus/` が無ければ先に `mkdir -p ~/.tealus` してもらってください。

---

## ステップ 1. 往路 — tealus-mcp を登録する

Claude Code の MCP 設定 (`~/.claude.json`) に追加します。**stdio transport で構いません** — MCP サーバはこのマシン上で CC の子プロセスとして起動し、そこから Tealus へは HTTP で出ていくので、別マシンでも問題なく動きます。

```json
{
  "mcpServers": {
    "tealus": {
      "command": "npx",
      "args": ["-y", "github:gamasenninn/tealus-mcp"],
      "env": {
        "TEALUS_API_URL": "https://tealus.example.com",
        "TEALUS_USER_ID": "AI_AGENT",
        "TEALUS_PASSWORD": "..."
      }
    }
  }
}
```

- `TEALUS_API_URL` は **必ず外から到達できる URL**にします (`localhost` ではない)。この env 名でないと読まれません
- パスワードを含むので、この編集も user にやってもらうか、値の入力だけ user に任せてください

登録したら **Claude Code を再起動**します (MCP は起動時に読まれます)。再起動後、`mcp__tealus__list_rooms` が通れば往路は完了です。

---

## ステップ 2. 復路 — listen-tealus skill を配置する

repo が無いので GitHub から直接取ってきます。**ディレクトリ形式が必須**で、flat な `.md` は読み込まれません:

```bash
mkdir -p ~/.claude/skills/listen-tealus
curl -sL https://raw.githubusercontent.com/gamasenninn/tealus/main/.claude/skills/listen-tealus/SKILL.md \
  -o ~/.claude/skills/listen-tealus/SKILL.md
```

ユーザー単位 (`~/.claude/skills/`) に置くと、どのディレクトリで `claude` を起動しても使えます。

---

## ステップ 3. 復路の設定ファイルを作る

CC を起動するプロジェクトディレクトリに `.claude/cc-tealus.json` を作ります:

```json
{
  "project_name": "tealus",
  "auto_level": "L2",
  "catch_up_policy": "ask",
  "stream_url": "https://tealus.example.com/agent-api/cc-queue",
  "auth_file": "~/.tealus/cc-auth.json"
}
```

| field | 説明 |
|---|---|
| `project_name` | `@cc-{ここ}` の部分。Tealus 側で呼ぶ名前と一致させる |
| `auto_level` | `L1` 通知のみ / `L2` 返信案を出して確認 (既定) / `L3` 即返信 |
| `stream_url` | 本体の origin + `/agent-api/cc-queue`。末尾に `/stream` は付けない |
| `auth_file` | ステップ 0 で user に作ってもらったファイル |

★ **`queue_path` は書かないでください。** それは同一ホスト用の設定で、`stream_url` と併記すると同じ mention を 2 回受け取って二重に返信します (skill 側でエラーにしています)。

---

## ステップ 4. 疎通を確認する

**`/listen-tealus` を実行する前に、必ずここで確認します。** 繋がっていないまま待機に入ると「listening」と表示されたまま何も来ず、失敗が見えなくなります。

```bash
TOKEN=$(curl -s -X POST https://tealus.example.com/api/auth/login \
        -H 'Content-Type: application/json' -d @~/.tealus/cc-auth.json \
        | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")

curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "https://tealus.example.com/agent-api/cc-queue/pending?project=tealus"
```

`200` が返れば OK です。それ以外なら、下の表を見て user に原因を伝えてください。

| 結果 | 意味 | 対処 |
|---|---|---|
| `TOKEN` が空 | ログイン失敗 | `~/.tealus/cc-auth.json` の login_id / password。user に確認 |
| `000` | 到達できない | URL の typo / DNS / ファイアウォール。まず `curl -I https://.../` で本体自体に届くか確認 |
| `401` | トークンが無効 | 同上。本体と agent-server の `JWT_SECRET` がずれている可能性もある |
| `404` | 経路が無い | 本体の `/agent-api` proxy か、agent-server 側の `/cc-queue` route が古い。サーバ側が #214 を含むバージョンか確認 |
| `502` | agent-server が落ちている | サーバ側で agent-server の起動を確認してもらう |

---

## ステップ 5. 待機を開始する

```
/listen-tealus
```

skill が `stream_url` を見て HTTP モードで接続します。`🟢 Tealus listening` と `mode: http` が表示されれば完了です。

Tealus 側で `@cc-tealus テスト` と投稿してもらい、このセッションが起きれば成功です。

---

## サーバ側に必要な設定 (該当する場合だけ)

nginx などのリバースプロキシを挟んでいる場合、**ストリーミング用の設定が必要**です。既定のままだとレスポンスがバッファされて通知が届かない、あるいは 60 秒で切られます:

```nginx
location /agent-api/cc-queue/ {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_buffering off;         # バッファすると 1 行ずつ届かない
    proxy_read_timeout 3600s;    # 既定の 60s だと頻繁に切れる
}
```

これは Tealus サーバ側の設定なので、user かサーバ管理者にお願いしてください。

> 💡 接続が切れても skill 側のコマンドが自動で張り直し、切断中に届いたイベントも `since` で拾います。ただし切断が頻発すると無駄なので、上の設定は入れておく方が良いです。

---

## うまくいかないとき

| 症状 | 見るところ |
|---|---|
| `/listen-tealus` が出てこない | `ls ~/.claude/skills/listen-tealus/SKILL.md`。置いた後は **Claude Code の再起動**が必要 |
| 待機はしているが起きない | Tealus 側で、**この bot がそのルームに参加しているか**。参加していないルームのイベントは配信されません (返信もできないため) |
| 15 秒おきに起きる | heartbeat がフィルタされていない。skill の接続コマンドから `grep --line-buffered -v '"__hb"'` が抜けていないか |
| 同じ mention に 2 回返信する | `.claude/cc-tealus.json` に `queue_path` と `stream_url` が両方ある |

## 関連

- 同一ホストでの設定を含む全体像: [`setup-cc-tealus-bridge.md`](setup-cc-tealus-bridge.md)
- 設計と経緯: [#213](https://github.com/gamasenninn/tealus/issues/213) / [#214](https://github.com/gamasenninn/tealus/issues/214)
