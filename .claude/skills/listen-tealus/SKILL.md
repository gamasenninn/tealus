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
- このプロジェクトに **設定ファイル**が存在する (`.claude/cc-tealus.json.example` から copy + 編集)。1ディレクトリを複数の班が共用する場合は**役割別**に分ける (step 1)
- http mode では加えて: 本体が外から到達可能、`~/.tealus/cc-auth.json` にログイン情報

## 手順

### 1. 設定の選択と読み込み、mode 判定

設定ファイルの置き方は 2 通り:

| 置き方 | ファイル名 | いつ使うか |
|---|---|---|
| 単一役割 (既定) | `.claude/cc-tealus.json` | **1ディレクトリ = 1班**。organon / kairos / lp / docs / phronesis / tealus-apps はこれ |
| **役割別** | `.claude/cc-tealus.{role}.json` | ★ **1ディレクトリを複数の班が共用する場合** (`C:\app\tealus` の 本体班 `tealus` / サポート班 `support`、[#392](https://github.com/gamasenninn/tealus/issues/392)) |

**選び方 (この順に判定する)**:

1. **skill 引数があれば、それを役割名として `.claude/cc-tealus.{引数}.json` を使う**
   — 例 `/listen-tealus support`。**無ければエラーで止まる** (存在する役割別ファイルを一覧して示す)
2. 引数が無く、役割別ファイルが **1 つだけ**あればそれを使う
3. 引数が無く、役割別ファイルが **2 つ以上**あれば ★ **user に聞いて止まる。既定を選んではいけない**
4. 役割別ファイルが無ければ `.claude/cc-tealus.json` を使う (従来どおり)

★ **`.claude/cc-tealus.json` と役割別ファイルを同じディレクトリに混在させない。**
混在していたら**止まって user に聞く**。どちらを読むかを skill が黙って決めると、
**間違った班として静かに待機する**状態が作れてしまう (下の実例)。

★ **役割別に分けたら `.gitignore` の pattern も広げること** (`.claude/cc-tealus.json` だけを
無視していると `cc-tealus.support.json` が commit 対象に残る)。

選んだファイルを Read。schema:

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

- **未処理 0 件**: skip して step 3 へ。★ **ただし「0 件」を正常の証拠にしないこと** (下記)
- **未処理 ≥1 件**: `catch_up_policy` に従う
  - `"ask"` (default): user に提示し option (A: 全部 / B: 直近 / C: 古いものは自動応答 / D: skip) を選ばせる
  - `"all"`: 確認なしで全件処理
  - `"skip"`: watermark を最新に更新して skip
  - `"recent:Nh"`: 過去 N 時間以内のみ処理

#### ★ 「未処理 0 件」は正常の証拠にならない

**間違った queue を見ていれば、未処理は常に 0 に見える。** file mode では arm する前に必ず横並びで見る:

```sh
ls -la ~/.tealus/cc-queue/*.jsonl
```

選んだ queue が**他に比べて極端に古い / 小さい**なら、**役割の取り違えを疑って user に確認する**。

★ 2026-08-20〜08-28 に実際に起きた: `C:\app\tealus` の `.claude/cc-tealus.json` が
`support` のまま 8 日間放置され、**本体班のセッションが `support.jsonl`
(最終更新 8 日前・23KB) を監視**していた。本来見るべき `tealus.jsonl` は
**1.1MB・当日も稼働・未処理 5 件**で、その中に**自分がその日に出したフォームへの回答 2 件**が
入っていた。「未処理 0 件」「🟢 listening」と報告した時点では**何も間違って見えなかった**。

★ **投稿側は部屋のメンバーシップ (403) で気づけるが、受信側は静かに外れる。**
出す方に防波堤があることを、受け取る方の正しさの証拠にしないこと。

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
LOG=~/.claude/.cc-stream-$P.ndjson; RC=~/.claude/.cc-stream-$P.rc; BYE=~/.claude/.cc-stream-$P.bye
FAILS=0; DOWN_FROM=0; DISC=0; LASTDAY=""; WARNED=0; GRACE_LIMIT=300; COUNT_FROM=$(date +%s)
while true; do
  TOKEN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
          -d @{auth_file} | node -pe "try{JSON.parse(require('fs').readFileSync(0,'utf8')).token}catch(e){''}")
  META=$(curl -s -H "Authorization: Bearer $TOKEN" "$STREAM/pending?project=$P")
  MAX_AGE=$(printf '%s' "$META" | node -pe "try{const v=Math.round(JSON.parse(require('fs').readFileSync(0,'utf8')).max_age_ms/1000);Number.isFinite(v)?v:0}catch(e){0}")
  if [ "$MAX_AGE" = "0" ]; then                     # 古いサーバ / 到達できない → 仮定値で続行
    MAX_AGE=3300
    [ "$WARNED" = "1" ] || { echo "[stream] max_age を取得できないため 3300 と仮定します"; WARNED=1; }
  else
    WARNED=0                                        # ★ 取れたら警告フラグを戻す (次に取れなくなったら再度知らせる)
    [ "$FAILS" -gt 0 ] && {                         # ★ 復帰はここで判定 (接続終了を待たない)
      echo "[stream] recovered after ${FAILS} attempts, $(( $(date +%s) - DOWN_FROM ))s down"; FAILS=0; }
  fi
  TODAY=$(date '+%Y-%m-%d')
  if [ "$TODAY" != "$LASTDAY" ]; then
    [ -n "$LASTDAY" ] && {                          # ★ 集計の起点からの経過を必ず添える (#366)
      ELAPSED=$(( $(date +%s) - COUNT_FROM ))
      printf '[stream] alive, %d disconnects in %dh%02dm\n' \
             "$DISC" $((ELAPSED / 3600)) $(((ELAPSED % 3600) / 60)); }
    LASTDAY=$TODAY; DISC=0; COUNT_FROM=$(date +%s)  # 件数と起点は必ず同時に戻す
  fi
  SINCE=$(grep '^{"id"' "$LOG" 2>/dev/null | tail -1 \
          | node -pe "try{JSON.parse(require('fs').readFileSync(0,'utf8')).id}catch(e){''}")
  START=$(date +%s)
  { curl -sN -H "Authorization: Bearer $TOKEN" "$STREAM/stream?project=$P${SINCE:+&since=$SINCE}"; echo $? > "$RC"; } \
  | while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        '{"__hb"'*)   ;;                                                # heartbeat: 捨てる
        '{"__bye"'*)                                                    # ★ 予告された切断 (#365 停止 / #366 寿命)
          E=$(printf '%s' "$line" | node -pe "try{const v=Math.round(JSON.parse(require('fs').readFileSync(0,'utf8')).__bye.expect_back_ms/1000);Number.isFinite(v)&&v>0?v:0}catch(e){0}")
          [ "$E" = "0" ] && E=30
          [ "$E" -gt "$GRACE_LIMIT" ] && E=$GRACE_LIMIT                 # 壊れた値でも暴走させない
          echo $(( $(date +%s) + E )) > "$BYE"
          printf '[stream] 切断予告: %s\n' "$line" >&2 ;;               # ★ 理由を記録に残す (起こさない)
        '{"__'*)      ;;                                                # ★ 制御メッセージ全般: 捨てる (前方互換)
        '{"id"'*)     printf '%s\n' "$line" >> "$LOG"; printf '%s\n' "$line" ;;
        *)            if [ "$(date +%s)" -lt "$(cat "$BYE" 2>/dev/null || echo 0)" ]
                      then printf '[stream-error] %s\n' "$line" >&2    # ★ 猶予中は記録だけ (#365)
                      else printf '[stream-error] %s\n' "$line"        # 通知のみ、ログは汚さない
                      fi ;;
      esac
    done
  END=$(date +%s); SEC=$(( END - START )); RC_VAL=$(cat "$RC" 2>/dev/null); DISC=$((DISC+1))
  BACKOFF=$(( 3 + ${RANDOM:-$$} % 10 ))     # jitter。RANDOM が無い sh では PID で代用
  MSG="[stream] disconnected after ${SEC}s (curl=$RC_VAL), retrying in ${BACKOFF}s"
  if [ "$END" -lt "$(cat "$BYE" 2>/dev/null || echo 0)" ]; then
    FAILS=0; echo "$MSG — 予告済みの切断 (猶予中)" >&2  # ★ __bye の猶予窓 (#365/#366)。判定によらず黙る
  elif [ "$RC_VAL" = "0" ] && [ "$SEC" -ge $((MAX_AGE - 5)) ] && [ "$SEC" -le $((MAX_AGE + 5)) ]; then
    FAILS=0; echo "$MSG" >&2                        # 予告を出さない古いサーバ向けの退避判定
  else
    FAILS=$((FAILS+1)); [ "$FAILS" = "1" ] && DOWN_FROM=$END   # ★ ダウンの起点は切断時刻 (#366)
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
| ★ **終了コードとエラー本文は両方要る** | proxy のエラーは **`curl=0` で返ることがある**。本文を受け取ったうえで転送自体は正常終了するため、**終了コードだけでは異常と判定できない**。2026-08-02 の実例: `[stream-error] Error occurred while trying to proxy...` と `disconnected after 3102s (curl=0)` が同時に出た。<br>逆に `[stream-error]` は **切断の分類とは独立に stdout へ出る**ので、エラー本文が返った場合は静音窓の中でも必ず起こす。**2 本の独立した検知経路を持つのが意図**で、どちらかを消すと片目になる |
| ★ `|| [ -n "$line" ]` | **末尾に改行が無い行を `read` が捨てるのを防ぐ。** エラー応答の本文 (401 の JSON や 504 の HTML) は改行で終わらないので、これが無いと **`[stream-error]` が無音で消える**。「エラーが出ていない」のではなく「読めていない」状態になる。2026-08-02 に実機で確認 |
| ★ 予定どおりの切断は `>&2` | **stdout の行はすべて Monitor のイベント = LLM を起こす**。stderr は出力ファイルに残るが起こさない。55 分ごとの正常な切断で起こすのは無駄 (1 日 26 回) なので黙らせる。**ただし全部を黙らせると「繋がらないまま何時間も」も無音になる** |
| ★ 静音の条件は `curl=0` かつ `MAX_AGE-5 <= SEC <= MAX_AGE+5` | **これは古いサーバ向けの退避判定**。理由が届くならそちらが優先で、この窓は使われない (下の行)。<br>`curl=0` だけでは「サーバが正常に閉じたが寿命ではない」(再起動等) を拾えないので、両方要る。**窓を広げても拾えるものは増えず、見逃すものが増えるだけ**なので、必要以上に広げない |
| ★ 下限を `MAX_AGE-5` にした経緯 (**削って `MAX_AGE` に戻さないこと**) | 当初は下限を `MAX_AGE` ちょうどにしていた。根拠は「**`SEC` は原理的に `MAX_AGE` を下回らない**」(クライアントの計測開始はサーバのタイマー開始より必ず前) で、実測 17 回が 3300/3301 の 2 値しか取らないことが裏づけだった。<br>★ **2026-08-02 に `SEC=3298` が出て反証された。** サーバ側の実測は 3300 秒ちょうど (寿命切断で確定) で、2 台の時計が 55 分の間に 2 秒ずれていた。606 ppm なので自然なドリフトでは説明がつかず、NTP の補正と見られる。<br>★ **導出は正しく、言語化されていない前提が誤りだった** —— `date +%s` は**壁時計であって単調増加しない**。この前提は原因が NTP かどうかに関係なく成り立たないので、下限を上げ直してはいけない |
| ★ `case $FAILS in 1|2|4|8...` の間引き | 障害中は 3〜12 秒ごとに再試行するので、素通しだと **1 時間の停止で 450 回前後の起床**になる。Monitor には「イベントが多すぎる監視は自動停止される」仕様があるため、**障害のときに限って監視が死ぬ**という最悪の形になる |
| ★ `recovered` を **pending の成否で**判定 | 接続終了時に判定すると **復帰の通知が最大 55 分遅れ、`down` の秒数に復帰後の正常接続が丸ごと含まれる**。周回頭の pending が通った時点でサーバは到達可能なので、そこで出す。**「落ちた」を通知するなら「戻った」も対で必要** |
| ★ `DOWN_FROM=$END` (`$START` ではない) | `START` は**終了した接続の開始時刻**なので、`down` に**その接続が生きていた時間が丸ごと入る**。2026-08-02 の実例: 実際のダウン 11 秒に対し `3309s down` と表示された (3298 + 11)。<br>★ **短命な接続失敗では `START ≈ 切断時刻` なので気づかない。長く生きた接続が想定外に終わったとき初めて出る。**上の「pending の成否で判定」と同じ勘違いの残り半分で、判定点だけ直して起点を放置していた |
| ★ `Number.isFinite(v)?v:0` | **古いサーバ (#361 前) は `max_age_ms` を返さない**。`undefined/1000` は `NaN` になるが**例外にならないので catch に落ちない**。そのままだと `[ "$SEC" -ge "NaN" ]` がエラーになり、**全ての切断が「想定外」に落ちて通知の嵐** = 防ごうとしている状態そのものになる。2026-08-02 に旧サーバへの実接続で確認 |
| 毎周の `pending` | MAX_AGE を毎回取り直す。arm 時に 1 回だけだと、**実行中にサーバ側で max_age を変えられたときに古い値を持ち続ける** (2026-08-01 の 120 秒実験で実例)。取れないときは 3300 と仮定し、**その旨を 1 回だけ通知**する (黙って仮定しない) |
| `[stream] alive` (1 日 1 回) | 変更後は正常運転が通知ゼロになるが、**Monitor が自動停止した場合も通知ゼロ**で区別がつかない。日次で 1 行出して **沈黙の意味を一つに絞る**。ただしこれは死活監視ではなく、**「来るはずのものが来ない」と誰かが気づいて初めて機能する** |
| ★ `alive` に **経過時間を必ず添える** (`in 4h32m`) | 当初は `in last 24h` と書いていたが、**`DISC` はループのプロセス変数なので張り直すたびに 0 に戻る**。定常運転では 24 時間で正しいが、**張り直した日はラベルだけが過大**になり、「昨日 40 件・今日 6 件、何かあったか」と読むと実際は「張り直しただけ」になる (2026-08-02 に実例)。<br>★ 経過を行に入れると、**張り直しがあったことが同じ 1 行で分かる**。`since start` では「いつからか」が落ちるので不可。<br>★ `DISC=0` と `COUNT_FROM` の更新は**必ず同じ場所で同時に**行うこと。片方だけ戻すと、また数字とラベルがずれる |
| ★ `__bye` と猛予窓 (`$BYE`) | **再起動はバグ修正のたびに起きる**。人が毎回予告する運用は、忘れるようになった時点で本当に必要な場面でも使われなくなるので、**サーバが自分で予告する** (#365)。<br>★ **「次の 1 回の切断だけ黙る」では足りない** —— 切断は黙っても、その後の再接続失敗 (まだ戻っていない) で結局起こされる。**時間の猛予として持つ**。<br>★ 時間で持つと、「予告が来たのに切断が来ない」ケースも**自動で失効する** (失効処理を書く必要すら無い)。回数で持つと消し忘れが起きる |
| ★ `expect_back_ms` をサーバから受け取る | クライアントが 60 秒などと決め打つと、**#361 で解いたばかりの問題 (サーバの都合をクライアントがハードコード) を再導入**する。デプロイに 5 分かかる日もあり、その値を知っているのはサーバだけ。<br>ただし `GRACE_LIMIT` (300 秒) で clamp すること —— **壊れた値を返されても永久に黙り込まない**ため |
| ★ 寿命切断も `__bye` で予告される (#366) | **切断の理由を知っているのはサーバだけ**。経過秒から逆算する方式 (上の窓) は `date +%s` が単調増加する前提に乗っていて、**時計が動いた瞬間に誤判定する**。サーバが `{"__bye":{"reason":"max_age"}}` を送れば、時計がずれても丸めがどうでも判定は変わらない。<br>`expect_back_ms` は停止時より**短い** (サーバは動き続けているので即座に繋ぎ直せる)。長くすると、寿命切断の直後に起きた本物の障害がその分だけ黙って見過ごされる |
| ★ `__bye` の中身を stderr に 1 行残す | 猶予窓を張るだけだと **理由 (`shutdown` / `max_age`) が消える**。stdout に出すと起こしてしまうので stderr へ。**通知はしないが記録は残す**、の使い分け |
| ★ クラッシュでは `__bye` が出ない | これは欠陥ではなく**意図した振る舞い**。計画的な停止 (SIGINT / SIGTERM) だけが静かになり、クラッシュ・電源断・`kill -9` は異常として残る。**予告できるものは予告し、予告できないものは異常として残る** —— 仕組みから自然にそうなるので、例外処理を書く必要がない |
| `BACKOFF` の jitter | サーバが同時刻に全接続を閉じる (#360) ので、**固定待ちだと N セッションの再ログインが揃う**。`/api/auth/login` は毎回 bcrypt を踏むので CPU がスパイクする。3〜12 秒に散らす。`RANDOM` は POSIX `sh` に無いので PID で代用する |
| — | ★ **定期的な切断は正常**。サーバは `CC_STREAM_MAX_AGE_MS` (既定 55 分) で意図的に接続を閉じ、再ログイン + 再認可を促す (#360)。`[stream] disconnected` が 55 分周期で出るのは異常ではない |

> ★ **接続コマンドを変えたら、配布前に構文を通すこと。**
>
> ```sh
> awk '/^P=\{project_name\}/{f=1} f&&/^```/{exit} f' SKILL.md | sh -n && echo "構文 OK"
> ```
>
> Monitor が使うシェルは環境によって zsh / bash / dash と違う。`RANDOM` のような
> bash/zsh 固有の記法は、**手元では絶対に再現しない形で他環境を壊す**。2026-08-01 に
> `sleep $((3 + RANDOM % 10))` を zsh のマシンで検証して「動く」と報告されたが、
> POSIX sh では算術エラーになるコードだった。別マシンで動いたことは、
> **そのマシンで動いた証拠にしかならない**。
>
> ★ **`sh -n SKILL.md` と Markdown 全体に掛けてはいけない。** frontmatter の 3 行目で
> 必ず落ちるので、**接続コマンドまで到達せず、常に赤く出るだけの検査**になる
> (2026-08-02 にそう書いて配布し、Mac セッションの指摘で判明)。
> ★ 検査を書いたら、**わざと壊した入力で落ちることまで確かめる**こと。
> 「通った」だけでは、その検査が何かを見ている証拠にならない。

### 4. 状態通知

user に以下のように報告:

```
🟢 Tealus listening
   project: {project_name}
   config:  {選んだ設定ファイル}      ← ★ どれを読んだかを必ず出す
   auto_level: {auto_level}
   mode: file / http
   source: {queue_path} または {stream_url}
```

★ **`config:` 行を省略しない。** 役割別に分けた意味は「どちらとして待機しているかが
報告に出ること」にある。project 名だけだと、**設定が古いのか意図どおりなのかを user が見分けられない**。

### 5. event 到着時の振る舞い

`<task-notification>` で 1 行 jsonl payload が届く (file / http どちらでも同じ形)。各 payload に対して:

#### ★ 同報された便 (`recipients` が 2 つ以上) —— #387

payload に `recipients` があれば、**同じ便が他の班にも届いている**。

```json
{"id":"...","room_name":"AI班連絡","recipients":["tealus","organon","kairos"], ...}
```

- **他の班も同じものを読んでいる前提で動く。** 「調べておきます」と全班が言うと同じ作業が 3 回走る。
  自分の担当範囲だけに答え、他班の範囲は書かない
- ★ **返信の先頭 mention は発信者 1 つだけにする。** 受け取った宛先を並べて返してはいけない
  —— A の返信が B と C を起こし、B の返信が A と C を起こす、が成立する。
  自己ループ防止は「行頭にあるか」だけで効いている (`docs/06` §6.1) ので、
  **返し方の慣習が唯一のブレーキ**になる
- **同報してよいのは最初に投げる便だけ。** 返信・追記では使わない

`recipients` が無い payload (古いサーバ) は単一宛先として扱う。

#### ★ 送るとき —— `@cc-` を付けるかどうか (#396、2026-09-03 合意)

**`@cc-x` は「配送する」と「起こす」を同時に意味する。片方だけを選ぶ書き方は無い。** そして
**作らないと決めた** —— 部屋に投稿した時点で配送は済んでおり、queue が足しているのは実質「起こす」だけ
だから (「queue に入れるが起こさない」は「部屋に置く」とほぼ同じ)。したがって判断は 1 行:

```
★ @ を付けない   1 日遅れても困らない便
                 監査行 / 日次照合 / 「了解」/ 印を付けた報告 / 定型の自動報告
★ @ を付ける     問い / 訂正 / 相手の記録を変えるもの / 急ぐもの
```

★ **基準を「相手に読む習慣があるか」に置かないこと。** 置くと、習慣の有無を双方で確かめ合ってからでないと
始められない。**便ごとに「1 日遅れて困るか」で決めれば、いまの手順のまま双方が同時に始められる**
(2026-09-03 に本体班・Mac セッションで合意。★ 前者で組んだ「両方が習慣を持ってから外す」は過剰だった)。

★★ **遅れの実測**: 受け手はどちらも「起こされたときにしか部屋を読まない」に近い。
本体班は朝のセッション開始時に 業務メモ + AI班連絡 を 24h ぶん読む手順があるが、**2 部屋・1 日 1 回・
セッションが始まったときだけ**。Mac セッションは日次照合に「部屋を読む」を足した (2026-09-03)。
**どちらも最大 1 日遅れる。** それで困る便には付ける。

★★★ **記法を足す案を採らなかった理由は、失敗の仕方が違うから**:

```
新記法を足す    知らない班 → ★ 配送そのものを落とす (壊れる)
@ を付けない    知らない班 → ★ いままでどおり付ける (今と同じ)
```

skill には配布経路が無く、**いちばん古い版の listener に合わせるしかない** (実例: 26 日古い版で
運用していた班がいた)。耐えるのは後者だけ。

★ 測定の全文と、この判断に至るまでの誤り 4 件は
[#396](https://github.com/gamasenninn/tealus/issues/396) のコメントにある。

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
