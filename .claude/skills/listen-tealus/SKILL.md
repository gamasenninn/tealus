---
name: listen-tealus
description: Tealus からのリアルタイム mention を Monitor で待機する。`@cc-{project}` 宛のメッセージが届いたら即起こされ、auto_level に従って応答する。同一ホスト (file) と別マシン (HTTP) の両方に対応。
---

# listen-tealus

agent-server が `@cc-{project}` mention を検知したときの起床通知を Monitor で監視し、設定された auto_level で応答する skill。

受け取り方が 2 通りある:

| mode | 受け取り方 | いつ使うか |
|---|---|---|
| **file** (既定) | `~/.tealus/cc-queue/{project}.jsonl` を `tail -n 0 -F` | CC セッションが **agent-server と同じホスト**にある |
| **http** (#214) | `GET /agent-api/cc-queue/stream` の NDJSON | CC セッションが**別マシン**にある |

**http mode の狙いは利便性ではなく隔離**。本番 DB / メディア / `server/.env` の秘密鍵があるホストと、AI が動くホストを分けられる。

## 前提

- **agent-server** が起動済み (webhook 受信 + `src/webhook/ccQueue.mts` 経由の routing が有効)
- このプロジェクトに **`.claude/cc-tealus.json`** が存在する (`.claude/cc-tealus.json.example` から copy + 編集)
- http mode では加えて: 本体が外から到達可能、`~/.tealus/cc-auth.json` にログイン情報

## 手順

### 1. 設定読み込みと mode 判定

`.claude/cc-tealus.json` を Read。schema:

| field | 必須 | 例 / default |
|---|---|---|
| `project_name` | ✅ | `"tealus"` (queue の suffix。`@cc-tealus` の suffix と一致させる) |
| `auto_level` | 任意 | `"L2"` (default) — `L1` / `L2` / `L3` |
| `catch_up_policy` | 任意 | `"ask"` (default) — `ask` / `all` / `skip` / `recent:4h` |
| `queue_path` | file mode | `"~/.tealus/cc-queue/tealus.jsonl"` (default は project_name から計算) |
| `stream_url` | http mode | `"https://tealus.example.com/agent-api/cc-queue"` (末尾に `/stream` は付けない) |
| `auth_file` | http mode | `"~/.tealus/cc-auth.json"` (default) |

**mode 判定**:

- `stream_url` があれば **http mode**、無ければ **file mode**
- ★ `queue_path` と `stream_url` の **両方があればエラーで止まる**。両方を有効にすると同じ mention を 2 回受け取り、二重に返信する

### 2. catch-up 処理

watermark file を Read:

- file mode: queue file の dirname にある `.last_processed-{project_name}`
- http mode: `.claude/.last_processed-{project_name}` (queue dir がローカルに無いため)

未処理の判定:

- file mode: queue file を読んで watermark 以降の行数
- http mode: `GET {stream_url}/pending?project={project_name}&since={watermark}` の `count`

処理:

- **未処理 0 件**: skip して step 3 へ
- **未処理 ≥1 件**: `catch_up_policy` に従う
  - `"ask"` (default): user に提示し option (A: 全部 / B: 直近 / C: 古いものは自動応答 / D: skip) を選ばせる
  - `"all"`: 確認なしで全件処理
  - `"skip"`: watermark を最新に更新して skip
  - `"recent:Nh"`: 過去 N 時間以内のみ処理

### 3. Monitor を arm

#### file mode

`tail -n 0 -F` で **新着のみ** を監視 (過去再生を回避):

```
Monitor (
  command: "tail -n 0 -F {queue_path} 2>/dev/null",
  description: "Tealus cc-queue: @cc-{project_name} 待機",
  persistent: true,
  timeout_ms: 300000
)
```

#### http mode

**★ arm する前に必ず疎通確認する。** これを飛ばすと、繋がっていないのに「listening」と表示され、失敗が silent になる:

```sh
curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $(取得したトークン)" \
  "{stream_url}/pending?project={project_name}"
```

`200` 以外なら **Monitor を張らず**、status code と原因の候補 (401 = 認証情報、000 = 到達不能 / DNS、502 = 本体が落ちている) を user に提示して止まる。

疎通が取れたら:

```
Monitor (
  command: "<下記の接続コマンド>",
  description: "Tealus cc-queue (HTTP): @cc-{project_name} 待機",
  persistent: true,
  timeout_ms: 300000
)
```

接続コマンド (`{...}` を設定値で置換して 1 行の sh として渡す):

```sh
P={project_name}; API={本体の origin}; STREAM={stream_url}
LOG=~/.claude/.cc-stream-$P.ndjson; RC=~/.claude/.cc-stream-$P.rc
FAILS=0; DOWN_FROM=0; DISC=0; LASTDAY=""; WARNED=0
while true; do
  TOKEN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
          -d @{auth_file} | node -pe "try{JSON.parse(require('fs').readFileSync(0,'utf8')).token}catch(e){''}")
  META=$(curl -s -H "Authorization: Bearer $TOKEN" "$STREAM/pending?project=$P")
  MAX_AGE=$(printf '%s' "$META" | node -pe "try{const v=Math.round(JSON.parse(require('fs').readFileSync(0,'utf8')).max_age_ms/1000);Number.isFinite(v)?v:0}catch(e){0}")
  if [ "$MAX_AGE" = "0" ]; then                     # 古いサーバ / 到達できない → 仮定値で続行
    MAX_AGE=3300
    [ "$WARNED" = "1" ] || { echo "[stream] max_age を取得できないため 3300 と仮定します"; WARNED=1; }
  elif [ "$FAILS" -gt 0 ]; then                     # ★ 復帰はここで判定 (接続終了を待たない)
    echo "[stream] recovered after ${FAILS} attempts, $(( $(date +%s) - DOWN_FROM ))s down"; FAILS=0
  fi
  TODAY=$(date '+%Y-%m-%d')
  if [ "$TODAY" != "$LASTDAY" ]; then
    [ -n "$LASTDAY" ] && echo "[stream] alive, ${DISC} disconnects in last 24h"
    LASTDAY=$TODAY; DISC=0
  fi
  SINCE=$(grep '^{"id"' "$LOG" 2>/dev/null | tail -1 \
          | node -pe "try{JSON.parse(require('fs').readFileSync(0,'utf8')).id}catch(e){''}")
  START=$(date +%s)
  { curl -sN -H "Authorization: Bearer $TOKEN" "$STREAM/stream?project=$P${SINCE:+&since=$SINCE}"; echo $? > "$RC"; } \
  | while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        '{"__hb"'*)   ;;                                                # heartbeat: 捨てる
        '{"__'*)      ;;                                                # ★ 制御メッセージ全般: 捨てる (前方互換)
        '{"id"'*)     printf '%s\n' "$line" >> "$LOG"; printf '%s\n' "$line" ;;
        *)            printf '[stream-error] %s\n' "$line" ;;           # 通知のみ、ログは汚さない
      esac
    done
  SEC=$(( $(date +%s) - START )); RC_VAL=$(cat "$RC" 2>/dev/null); DISC=$((DISC+1))
  BACKOFF=$(( 3 + ${RANDOM:-$$} % 10 ))     # jitter。RANDOM が無い sh では PID で代用
  MSG="[stream] disconnected after ${SEC}s (curl=$RC_VAL), retrying in ${BACKOFF}s"
  if [ "$RC_VAL" = "0" ] && [ "$SEC" -ge "$MAX_AGE" ] && [ "$SEC" -le $((MAX_AGE + 5)) ]; then
    FAILS=0; echo "$MSG" >&2                        # ★ 予定どおり = 記録だけ。起こさない
  else
    FAILS=$((FAILS+1)); [ "$FAILS" = "1" ] && DOWN_FROM=$START
    case $FAILS in 1|2|4|8|16|32|64|128) echo "$MSG (想定外 ${FAILS} 回目)" ;; *) echo "$MSG" >&2 ;; esac
    [ "$FAILS" -gt 5 ] && BACKOFF=$((BACKOFF * 4))
  fi
  sleep "$BACKOFF"
done
```

このコマンドの各部分には理由がある。**削らないこと**:

| 部分 | なぜ必要か |
|---|---|
| `while true` … `sleep 5` | ★ Monitor は `persistent: true` のとき **exit で監視ごと終わる**。curl がネットワーク断や nginx のタイムアウトで死ぬと、**セッションは黙って聞かなくなる**。`tail -F` には無い HTTP 固有の失敗モードなので、自力で張り直す。`sleep 5` はビジーループ防止 |
| 毎周の `login` | トークンは 7 日で失効する。周回ごとに取り直せば失効が構造的に起きない。**長寿命 JWT は使わない** (本体の `authenticate` は `decoded.id` で users を引くため、`{userId:...}` 形式の手製トークンでは `/api/rooms` が引けず認可できない) |
| `>> "$LOG"` + `SINCE` | ★ **受信済みカーソル**。`.last_processed` (watermark) は reply 成功時にしか進まないので、それを `since` に使うと **L2 で保留中の mention が再接続のたびに再提示される**。受信した時点で進むカーソルを別に持つことで、「切断中のイベントは拾う / 未処理は再送しない」を両立する |
| ★ `case` による **許可方式**の仕分け | **除外方式 (`grep -v '"__hb"'`) にしてはいけない。** proxy の 504 などで返る **HTML / テキストのエラー本文が素通りして受信ログに混ざり、`SINCE` の計算が壊れて空になる** = 再接続で切断中の mention を丸ごと取りこぼす。`{"id"` で始まる行だけをログに入れる。**2026-08-01 の dogfood で実際に踏んだ** |
| `SINCE` を `grep '^{"id"'` 経由で取る | 同じ理由の二重防御。ログに非 JSON 行が混ざってもカーソルが壊れない |
| `[stream-error]` / `[stream] disconnected` | 切断とエラーを**見えるようにする**。黙って張り直すと、何が起きているか分からないまま取りこぼしだけが進む。ただし **`$LOG` には書かない** |
| heartbeat を捨てる | サーバは 15 秒ごとに `{"__hb":1}` を流して接続を維持する。素通しすると **15 秒ごとに CC が起きる**。なお `grep` 等を挟む場合は `--line-buffered` が必須 (Monitor は行ごとの flush が前提) |
| ★ `'{"__'*)` で制御メッセージをまとめて捨てる | **前方互換のため**。`__hb` だけを名指しで捨てると、サーバが将来新しい制御メッセージ (`__meta` 等) を流した瞬間、**古い SKILL の環境が全部 `[stream-error]` を出す**。skill は各自が curl で取る配布形態なので追隨しない環境が必ず残る。`__` 接頭辞を **「イベントではない制御行」の予約語**として扱う |
| `START` と `disconnected after Ns` | ★ **接続がどれだけ持ったかを切断行自体に持たせる**。これが無いと、切断を見たときに「前回いつ張ったか」を思い出す必要があり、**イベントの初着時刻を接続開始と誤読する** (2026-08-01 に実際に起きた: 55 分の寿命による切断を「16 分だからデプロイだろう」と誤認)。なお接続時に別行を出すと **1 周期あたりの起床が 2 回に増える** (stdout の行はすべて Monitor のイベント) ので、切断行に持たせる。`START` はパイプの外で取ること (`while` の中はサブシェルで変数が残らない) |
| `{ curl ...; echo $? > "$RC"; }` | ★ **curl の終了コードを拾う。** これが無いと切断の種類をクライアント側だけで判別できず、毎回サーバログを見に行くことになる。`0`=サーバが正常に閉じた (寿命など) / `18`・`52`・`56`=転送が途中で切れた (ネットワーク起因) / `6`・`7`=DNS・接続失敗 / `28`=タイムアウト。**パイプの左側の終了コードを取る移植可能な方法はこれだけ** (`PIPESTATUS` は bash 専用、`$pipestatus` は zsh 専用、`set -o pipefail` は POSIX 外) |
| ★ `|| [ -n "$line" ]` | **末尾に改行が無い行を `read` が捨てるのを防ぐ。** エラー応答の本文 (401 の JSON や 504 の HTML) は改行で終わらないので、これが無いと **`[stream-error]` が無音で消える**。「エラーが出ていない」のではなく「読めていない」状態になる。2026-08-02 に実機で確認 |
| ★ 予定どおりの切断は `>&2` | **stdout の行はすべて Monitor のイベント = LLM を起こす**。stderr は出力ファイルに残るが起こさない。55 分ごとの正常な切断で起こすのは無駄 (1 日 26 回) なので黙らせる。**ただし全部を黙らせると「繋がらないまま何時間も」も無音になる** |
| ★ 静音の条件は `curl=0` かつ `MAX_AGE <= SEC <= MAX_AGE+5` | **両方揃わないと安全に黙らせない。** `curl=0` だけでは「サーバが正常に閉じたが寿命ではない」(再起動等) を拾えない。下限を `MAX_AGE` ちょうどにできるのは **`SEC` が原理的に `MAX_AGE` を下回らない**から (クライアントの計測開始はサーバのタイマー開始より必ず前)。実測 17 回が 3300/3301 の 2 値しか取らないのが裏づけ。**窓を広げても拾えるものは増えず、見逃すものが増えるだけ**。間違えるなら狭い側 |
| ★ `case $FAILS in 1|2|4|8...` の間引き | 障害中は 3〜12 秒ごとに再試行するので、素通しだと **1 時間の停止で 450 回前後の起床**になる。Monitor には「イベントが多すぎる監視は自動停止される」仕様があるため、**障害のときに限って監視が死ぬ**という最悪の形になる |
| ★ `recovered` を **pending の成否で**判定 | 接続終了時に判定すると **復帰の通知が最大 55 分遅れ、`down` の秒数に復帰後の正常接続が丸ごと含まれる**。周回頭の pending が通った時点でサーバは到達可能なので、そこで出す。**「落ちた」を通知するなら「戻った」も対で必要** |
| ★ `Number.isFinite(v)?v:0` | **古いサーバ (#361 前) は `max_age_ms` を返さない**。`undefined/1000` は `NaN` になるが**例外にならないので catch に落ちない**。そのままだと `[ "$SEC" -ge "NaN" ]` がエラーになり、**全ての切断が「想定外」に落ちて通知の嵐** = 防ごうとしている状態そのものになる。2026-08-02 に旧サーバへの実接続で確認 |
| 毎周の `pending` | MAX_AGE を毎回取り直す。arm 時に 1 回だけだと、**実行中にサーバ側で max_age を変えられたときに古い値を持ち続ける** (2026-08-01 の 120 秒実験で実例)。取れないときは 3300 と仮定し、**その旨を 1 回だけ通知**する (黙って仮定しない) |
| `[stream] alive` (1 日 1 回) | 変更後は正常運転が通知ゼロになるが、**Monitor が自動停止した場合も通知ゼロ**で区別がつかない。日次で 1 行出して **沈黙の意味を一つに絞る**。ただしこれは死活監視ではなく、**「来るはずのものが来ない」と誰かが気づいて初めて機能する** |
| `BACKOFF` の jitter | サーバが同時刻に全接続を閉じる (#360) ので、**固定待ちだと N セッションの再ログインが揃う**。`/api/auth/login` は毎回 bcrypt を踏むので CPU がスパイクする。3〜12 秒に散らす。`RANDOM` は POSIX `sh` に無いので PID で代用する |
| — | ★ **定期的な切断は正常**。サーバは `CC_STREAM_MAX_AGE_MS` (既定 55 分) で意図的に接続を閉じ、再ログイン + 再認可を促す (#360)。`[stream] disconnected` が 55 分周期で出るのは異常ではない |

> ★ **接続コマンドを変えたら、`sh -c` で 1 回通してから配布すること。**
> Monitor が使うシェルは環境によって zsh / bash / dash と違う。`RANDOM` のような
> bash/zsh 固有の記法は、**手元では絶対に再現しない形で他環境を壊す**。2026-08-01 に
> `sleep $((3 + RANDOM % 10))` を zsh のマシンで検証して「動く」と報告されたが、
> POSIX sh では算術エラーになるコードだった。別マシンで動いたことは、
> **そのマシンで動いた証拠にしかならない**。

### 4. 状態通知

user に以下のように報告:

```
🟢 Tealus listening
   project: {project_name}
   auto_level: {auto_level}
   mode: file / http
   source: {queue_path} または {stream_url}
```

### 5. event 到着時の振る舞い

`<task-notification>` で 1 行 jsonl payload が届く (file / http どちらでも同じ形)。各 payload に対して:

#### L1 (notify only)
```
📨 新着 from {sender.display_name} (room: {room_name})
   "{content}"
```
を表示するのみ。reply は user が手動指示。

#### L2 (default、suggest reply)
1. 上記の通知 + 「reply 案」を session の context (commit log / open issue / 過去の会話 etc.) を踏まえて生成
2. user に提示し `OK` / 編集 / `スキップ` を待つ
3. user 確認後、`tealus-mcp` の `send_message` で投稿

#### L3 (auto reply)
1. reply 案を即 `send_message` 投稿
2. user に「✅ 自動応答送信: <reply 要約>」と通知 (事後監査ログ)

### 6. watermark 更新

reply 完了時 (L2 の OK 後 / L3 投稿成功時) に msg.id を watermark file (step 2 の path) に書き込む。**reply 失敗時は更新しない** (再起動で再提示)。

★ watermark と `$LOG` の受信済みカーソルは**別物**。前者は「返信し終わった位置」、後者は「受け取った位置」。混ぜないこと。

## 停止

- session 内: `/stop-listen-tealus` (TaskStop で Monitor 終了)
- session 終了: 自動 cleanup

## 関連

- 設計議論: [#213](https://github.com/gamasenninn/tealus/issues/213) / HTTP 化: [#214](https://github.com/gamasenninn/tealus/issues/214)
- agent-server 側実装: `agent-server/src/webhook/ccQueue.mts` + `handler.mts` + `routes/ccQueue.mts`
- 採用者向け walkthrough: `docs/setup-cc-tealus-bridge.md`
- 別マシンでの設定手順 (CC 自身が読んで実行する): `docs/setup-cc-remote.md`
