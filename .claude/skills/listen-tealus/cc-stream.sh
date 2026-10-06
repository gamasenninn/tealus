#!/bin/sh
# listen-tealus の http mode の接続コマンド (tealus#484)
#
# 使い方: sh cc-stream.sh <project_name> <本体の origin> <stream_url> [auth_file]
#   例:   sh cc-stream.sh tealus https://tealus.example.com https://tealus.example.com/agent-api/cc-queue ~/.tealus/cc-auth.json
#
# ★ 受け取った便を ~/.claude/.cc-stream-<project>.ndjson に追記し、同じ行を stdout にも出す。
#   - Claude Code の Monitor で使う (listen-tealus): stdout の行で session が起きる
#   - PaneDeck の service で常駐させる: トリガーに上のファイルを見させる (stdout はログに出るだけ)
# ★★ 各部分の理由は SKILL.md の「このコマンドの各部分には理由がある。削らないこと」の表にある。
# ★★★ 下の「SKILL.md と同じ」から後は、SKILL.md の接続コマンドと 1 文字も違わないこと。
#   agent-server/__tests__/unit/listenTealusSkillAuth.test.mts が突き合わせる
#   (SKILL.md を 1 ファイルだけ curl で取っている別マシンがあるので、当面は 2 か所に置く)
P="$1"; API="$2"; STREAM="$3"; AUTH="${4:-$HOME/.tealus/cc-auth.json}"
case "$AUTH" in "~/"*) AUTH="$HOME/${AUTH#"~/"}" ;; esac
if [ -z "$P" ] || [ -z "$API" ] || [ -z "$STREAM" ]; then
  echo "[stream] 使い方: sh cc-stream.sh <project_name> <本体の origin> <stream_url> [auth_file]"
  exit 2
fi
# ---- ここから SKILL.md と同じ ----
LOG=~/.claude/.cc-stream-$P.ndjson; RC=~/.claude/.cc-stream-$P.rc; BYE=~/.claude/.cc-stream-$P.bye; UP=~/.claude/.cc-stream-$P.up
FAILS=0; DOWN_FROM=0; DISC=0; LASTDAY=""; WARNED=0; GRACE_LIMIT=300; COUNT_FROM=$(date +%s); TOKEN=; STREAK=0
get_token() { curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
              -d @"$AUTH" | node -pe "try{JSON.parse(require('fs').readFileSync(0,'utf8')).token}catch(e){''}"; }
fetch_meta() { curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$STREAM/pending?project=$P"; }
auth_prepare() {                                    # ★ #427 トークンは使い回し、401 のときだけ取り直す
  [ -n "$TOKEN" ] || TOKEN=$(get_token)             # 初回だけ login を踏む
  RAW=$(fetch_meta); CODE=$(printf '%s\n' "$RAW" | tail -1); META=$(printf '%s\n' "$RAW" | sed '$d')
  [ "$CODE" = "401" ] || return 0                   # ★ 401 以外はそのまま (000/404 は「古いサーバ / 到達不能」の道へ)
  TOKEN=$(get_token)                                # ★ 失効した → 1 回だけ取り直す
  RAW=$(fetch_meta); CODE=$(printf '%s\n' "$RAW" | tail -1); META=$(printf '%s\n' "$RAW" | sed '$d')
}                                                   # ★★ 2 回目も 401 なら諦めて戻る (速い再接続ループに入らない)
mark_up() {                                         # ★ #512 /stream から本物の 1 行が来た = この接続はつながった
  [ -e "$UP" ] && return; : > "$UP"
  [ "$FAILS" -gt 0 ] && echo "[stream] recovered after ${FAILS} attempts, $(( $(date +%s) - DOWN_FROM ))s down"
  FAILS=0                                           # (パイプの中の写し。外の FAILS は $UP を見て戻す)
}
while true; do
  auth_prepare
  MAX_AGE=$(printf '%s' "$META" | node -pe "try{const v=Math.round(JSON.parse(require('fs').readFileSync(0,'utf8')).max_age_ms/1000);Number.isFinite(v)?v:0}catch(e){0}")
  if [ "$MAX_AGE" = "0" ]; then                     # 古いサーバ / 到達できない → 仮定値で続行
    MAX_AGE=3300
    [ "$WARNED" = "1" ] || { echo "[stream] max_age を取得できないため 3300 と仮定します"; WARNED=1; }
  else
    WARNED=0                                        # ★ 取れたら警告フラグを戻す (次に取れなくなったら再度知らせる)
  fi                                                # ★ #512 復帰はここで判定しない (/pending が通っても /stream が通るとは限らない)
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
  START=$(date +%s); rm -f "$UP"
  { curl -sN -H "Authorization: Bearer $TOKEN" "$STREAM/stream?project=$P${SINCE:+&since=$SINCE}"; echo $? > "$RC"; } \
  | while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        '{"__hb"'*)   mark_up ;;                                        # heartbeat: 捨てる (つながった印にだけ使う)
        '{"__bye"'*)                                                    # ★ 予告された切断 (#365 停止 / #366 寿命)
          E=$(printf '%s' "$line" | node -pe "try{const v=Math.round(JSON.parse(require('fs').readFileSync(0,'utf8')).__bye.expect_back_ms/1000);Number.isFinite(v)&&v>0?v:0}catch(e){0}")
          [ "$E" = "0" ] && E=30
          [ "$E" -gt "$GRACE_LIMIT" ] && E=$GRACE_LIMIT                 # 壊れた値でも暴走させない
          echo $(( $(date +%s) + E )) > "$BYE"
          printf '[stream] 切断予告: %s\n' "$line" >&2 ;;               # ★ 理由を記録に残す (起こさない)
        '{"__'*)      ;;                                                # ★ 制御メッセージ全般: 捨てる (前方互換)
        '{"id"'*)     mark_up; printf '%s\n' "$line" >> "$LOG"; printf '%s\n' "$line" ;;
        *)            if [ "$(date +%s)" -lt "$(cat "$BYE" 2>/dev/null || echo 0)" ]
                      then printf '[stream-error] %s\n' "$line" >&2    # ★ 猶予中は記録だけ (#365)
                      else case $((FAILS + 1)) in                       # ★ #512 切断と同じく 1・2・4・8… 回目だけ起こす
                             1|2|4|8|16|32|64|128) printf '[stream-error] %s\n' "$line" ;;   # 通知のみ、ログは汚さない
                             *) printf '[stream-error] %s\n' "$line" >&2 ;;
                           esac
                      fi ;;
      esac
    done
  END=$(date +%s); SEC=$(( END - START )); RC_VAL=$(cat "$RC" 2>/dev/null); DISC=$((DISC+1))
  [ -e "$UP" ] && FAILS=0                           # ★ #512 この接続はつながっていた → 想定外の数え直しはここで
  BACKOFF=$(( 3 + ${RANDOM:-$$} % 10 ))     # jitter。RANDOM が無い sh では PID で代用
  MSG="[stream] disconnected after ${SEC}s (curl=$RC_VAL), retrying in ${BACKOFF}s"
  if [ "$END" -lt "$(cat "$BYE" 2>/dev/null || echo 0)" ]; then
    FAILS=0; STREAK=0; echo "$MSG — 予告済みの切断 (猶予中)" >&2  # ★ __bye の猶予窓 (#365/#366)。判定によらず黙る
  elif [ "$RC_VAL" = "0" ] && [ "$SEC" -ge $((MAX_AGE - 5)) ] && [ "$SEC" -le $((MAX_AGE + 5)) ]; then
    FAILS=0; STREAK=0; echo "$MSG" >&2              # 予告を出さない古いサーバ向けの退避判定
  else
    FAILS=$((FAILS+1)); [ "$FAILS" = "1" ] && DOWN_FROM=$END   # ★ ダウンの起点は切断時刻 (#366)
    case $FAILS in 1|2|4|8|16|32|64|128) echo "$MSG (想定外 ${FAILS} 回目)" ;; *) echo "$MSG" >&2 ;; esac
    [ "$FAILS" -gt 5 ] && BACKOFF=$((BACKOFF * 4))
    [ "$SEC" -ge 60 ] && STREAK=0; STREAK=$((STREAK+1))  # ★ #484 続けて何回か。1 分以上つながったら数え直す
    case "$CC_STREAM_GIVE_UP" in ''|0|*[!0-9]*) ;;     # ★ #484 既定は粘る。正の整数のときだけ N 回で終わる
      *) [ "$STREAK" -ge "$CC_STREAM_GIVE_UP" ] && {   #   (PaneDeck の service が起こし直し、回数を見せる)
           echo "[stream] gave up after ${STREAK} unexpected disconnects (CC_STREAM_GIVE_UP=$CC_STREAM_GIVE_UP)"; exit 1; } ;;
    esac
  fi
  sleep "$BACKOFF"
done
