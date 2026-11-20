# 13. herdr の知見 — AI と人が同じ場で働くために

2026-11-20 開始。利用者の依頼「Tealus はエージェントとのやりとりが密になってきた。エージェント同士の自律的なやりとりも
要るかもしれない。もっと深く広く自由に、エージェントと人間がコミュニケーションできるよう、herdr のどんな機能を使えばよいかを学んで
ドキュメント化してほしい」(学習ループ 5 回、fable と協力)。

★ 対象は herdr 0.9.5 (2026-11 時点)。herdr は保守者が少ない若い道具で、口は版で変わる。**使う前に `herdr --help` と `herdr api schema` で
今の版を確かめること。**
★ 印: 【確】= 実際に動かして確かめた / 【文】= 公式の文書にある / 【推】= 推測。
★ Tealus での今の使い方 (配達役が herdr の中の Claude を起こす) は [docs/12](12_配達役設計.md)。ここはその外側まで含めた「何ができるか」の地図。
★ 試すときは**名前つきの試験用セッション** (`herdr --session <名前> …`) だけで行う。本番の herdr には読むだけのコマンドしか打たない。
  ★ herdr の中で動くエージェントには `HERDR_SOCKET_PATH`・`HERDR_PANE_ID` が入っていて、`--session` を付け忘れると本番に当たる。

## 1. 全体像 (学習ループ 1)

### 1.1 ものの形

| もの | 中身 | 名前の例 | サーバを上げ直したら |
|---|---|---|---|
| session | サーバ 1 つぶんの世界。ペイン・通信の口・保存先がまるごと別 | `default` / 試験用の名前 | 残る 【確】 |
| workspace | 仕事場 (班 1 つに相当) | `w1`、ラベル `tealus` | 戻る 【確】 |
| tab | 仕事場の中の画面 | `w1:t1` | 戻る 【確】 |
| pane | 端末の「場所」。閉じた番号は使い回さない 【文】 | `w1:p1` | 番号・作業フォルダは戻る。中の処理は消えて新しいシェルになる 【確】 |
| terminal | ペインの中身の端末そのもの | `term_…` | 番号が変わる 【確】 |
| agent | ペインの中で herdr が見分けた AI。名前は `[a-z][a-z0-9_-]{0,31}`、生きている間だけ | `lp`、`support` | 消える 【確】 |

- 保存物: `%APPDATA%\herdr\session.json` (配置と作業フォルダだけ) と `session-snapshots\` (上限 48、15 分に 1 回まで 【文】)。名前つきセッションは `sessions\<名前>\` の下 【確】
- **Claude が戻らない理由**: 戻すには `herdr integration install claude` が要り、入っていれば `claude --resume <id>` で開き直す 【文】。
  Tealus の機械では未導入 (`herdr integration status` → `claude: not installed`) 【確】。入れると Claude の設定に hook が足される 【文】 (→ ループ 5 で安全を見る)
- 画面の中身は既定では戻らない (`pane_history` は実験的・既定は切。秘密が残るため) 【文】
- 止めずに入れ替える道 `herdr update --handoff` は実験的 (待ち・購読は切れる) 【文】

### 1.2 外から触れる口

| 口 | 一言 |
|---|---|
| `status` / `session` / `server` | 状態を見る、名前つきセッションの一覧・停止・削除、サーバ停止・設定の読み直し |
| `workspace` / `tab` / `pane` | 配置を作る・一覧・改名・閉じる。pane は `run` `send-text` `send-keys` `read` `wait-output` `split` `move` も |
| `agent` | `list` `get` `read` `prompt` `wait` `start` `rename` `send-keys` `explain` (状態の判定の理由を見る) |
| `pane report-agent` / `release-agent` | 自作の AI が自分の状態を申告する・手放す 【確】 |
| `pane report-metadata` / `workspace report-metadata` | 表示だけの札 (題・状態の表示名・`名前=値`)。期限つきにできる。再起動で消える 【確】 |
| `notification show` | 画面に知らせを出す (画面がつながっていないと出ない様子 【確】、条件はループ 4) |
| `worktree` | git worktree を作って仕事場として開く・消す 【文】 |
| `terminal session observe` | **読むだけ**の画面の流れ (1 行 1 JSON、中身は base64) 【確】。`control` は書ける版 【文】 |
| `machine` / `--machine` / `--remote` | 保存した SSH 先へ同じコマンドを送る。相手のサーバを勝手に起動・更新しない 【文】 |
| `integration` | 18 種の AI 向けの hook を入れる・外す・状態を見る 【確】 |
| `plugin` | 宣言ファイルに actions / events / startup / panes。キーに結べる 【文】 |
| `api schema` / `api snapshot` | 通信の決まり (protocol 22、約 110 の命令) と全体の状態 【確】 |

- **通信の口 (socket API)**: 1 行 1 JSON。Windows では名前つきパイプ。node の `net.connect` でつながる 【確】
- ★ **出来事の流れ (`events.subscribe`) がある** 【確】: つないだまま `pane.agent_status_changed`・`pane_agent_detected`・`pane_updated`・`pane_closed`・
  `workspace_metadata_updated`・`pane.output_matched` (画面に指定の文字が出たら) が流れてくる。状態の申告から届くまで約 0.1 秒。
  過去ぶんは流れず、取りこぼすと `events_lost` で切られるので、つなぎ直して `session.snapshot` で合わせる 【文】。1 回だけ待つ版は `events.wait`・`agent wait`・`pane wait-output`

### 1.3 AI の見分け方

- 見分けられる AI は 24 種 (claude・codex・gemini・cursor など) 【確】
- Claude の状態は hook ではなく**画面の下端の見た目**で決めている。判定の決まりは herdr.dev から自動で更新される 【文】
- 状態は 5 つ 【文】: `working` (動いている)・`blocked` (許可や質問の画面を認識)・`done` (終わったがまだ誰も見ていない)・`idle` (待ち)・`unknown`
  - ★ 知らない形の許可画面は `idle` に見える。**`idle` は「打ってよい」の保証ではない** 【文】
- 項目: `completion_seq` (仕事を終えた回数)・`state_change_seq`・`interactive_ready`・`revision`・`terminal_title` 【確】
- `agent prompt` は `blocked` の相手には打たずに `agent_blocked` を返す。`--wait` は 5 秒以内に動きが無いと `agent_prompt_stalled` 【文】

### 1.4 Tealus に効きそうなもの (ループ 2〜5 で確かめる)

| 候補 | 何に効くか |
|---|---|
| `events.subscribe` | 配達役の「数秒ごとに見に行く」を、つなぎっぱなしの知らせに置き換えられる |
| `agent_blocked` の拒否 | 許可待ちの画面に便を打ち込む事故を herdr 側で止められる (配達役は既に使っている) |
| `completion_seq` | 「起こしたあと仕事を終えたか」を、誰が画面を見たかに左右されずに数えられる |
| `report-metadata` の札 | 「未読 3 件」などを herdr の一覧に出せる。期限つきで消し忘れない |
| Claude の integration | 再起動のあと各班が会話ごと戻る (今は自前の start.ps1 で戻している) |
| `--machine` | 別の PC の班へ同じコマンドで届く。自前の SSH 越し (docs/12 §13) と比べる |
| `terminal session observe` | 読むだけで画面を外へ流せる。★ 秘密が映るので Tealus には写さない (docs/12 §9) |
| plugin の events | 出来事ごとに herdr がコマンドを起動する。常駐を持たずに済む可能性 |

## 2. エージェントの様子をつかむ (学習ループ 2)

試験用セッションで、自分で状態を申告する偽の AI と、偽の claude (端末の題で working を演じる) を動かして確かめた。本物の Claude は起こしていない。

### 2.1 出来事の流れ (`events.subscribe`)

- 形 【確】: `{"id":"s","method":"events.subscribe","params":{"subscriptions":[{"type":"pane.agent_status_changed","pane_id":"w1:p1"},{"type":"pane.agent_detected"},{"type":"pane.created"},{"type":"pane.closed"}]}}`
  → `{"id":"s","result":{"type":"subscription_started"}}`、以後 1 行 1 出来事
- ★ **状態の購読はペインを 1 つずつ並べる** 【確】。`pane.agent_status_changed` は `pane_id` が必須 (`*` や班の名前は使えない)。
  並べれば 1 本の接続で全部見られる。1 つでも無いペインがあると全体が `pane_not_found` で断られて切られる
- ★ **1 接続 = 1 命令** 【確】。同じ接続に 2 つ目の命令を送っても黙って無視される。購読を足すときはつなぎ直す
- ★ **`pane.updated` では状態は分からない** 【確】 (出るのは改名・札・手放しのとき)
- 中身 【確】: `{"event":"pane.agent_status_changed","data":{"agent":"claude","agent_status":"done","pane_id":"w3:p1","workspace_id":"w3"}}`。
  **班の名前・`state_change_seq`・`completion_seq` は入っていない** (`agent` は種類)。名前は `agent list` の `pane_id` で引く
- 名前の書き方 【確】: 状態だけ点 (`pane.agent_status_changed`)、ほかは下線 (`pane_agent_detected`・`pane_created`・`pane_closed`・`pane_updated`)

| 起きたこと | 流れてくるもの 【確】 |
|---|---|
| エージェントが現れる | `pane_agent_detected` (全体)。そのペインを並べてあれば状態の出来事も |
| エージェントが消える | `pane_agent_detected` に `released:true`・`final_status`。同じペインに戻れば購読はそのまま効く |
| ペインを閉じる | `pane_closed`。接続は切れない |
| ペインが増える | `pane_created` だけ。状態の購読は入っていないので張り直す |
| サーバが止まる | 何も言わずに切れる (約 0.5 秒)。上げ直すとペインの番号は同じ・エージェントは 0 |
| 読むのが遅れる | 600 件ためても無事、1200 件で `events_lost` が来て切られる。ほかの購読者は無事 |
| 静かなとき | 何も流れない (生存確認の行は無い)。切れたかは接続が閉じたことでしか分からない |

- 合わせ直し 【文】: 購読を張り直す → `subscription_started` を待つ → 別の接続で `session.snapshot` → 出来事は「読み直せ」の合図として扱う (ためた出来事を重ねない)

### 2.2 実測 (2026-11-20)

| 測ったもの | 値 【確】 |
|---|---|
| 状態の変わり目 → 出来事の到着 | 0.5〜97 ms (中央 57)。サーバが約 0.1 秒ごとにまとめて流す |
| 画面で判定する相手が動き出す → working と分かる | 約 0.3〜0.5 秒。30 ms だけの仕事は見逃す |
| 口から直接 `agent.get`・`agent.list`・`session.snapshot` | 0.3〜0.4 ms |
| `herdr agent get` を 1 回起動 | 10〜20 ms、CPU 約 8 ms (11 班を 10 秒ごとに見ても 1 コアの 1% ほど) |

### 2.3 待つ命令

| 命令 | 動き 【確】 |
|---|---|
| `agent wait` | 今の状態が合っていれば即返る。`--until` 無しは idle・done・blocked。時間切れは `timeout`、待つ間に相手が消えると `agent_not_running`。`--timeout` 無しは無期限 |
| `events.wait` | `match_event` に 1 つの出来事。これも今その状態なら即 `wait_matched` (変わり目ではなく状態を見る) |
| `pane wait-output` | 既に出ている文字にも当たる |
| `agent prompt --wait` | blocked には打たず `agent_blocked`。打って 5 秒 (実測 5.3 秒) 動きが無いと `agent_prompt_stalled`。`--timeout` が 5000 以下だと先に `timeout` が返る |

- ★ **`timeout` も `agent_prompt_stalled` も「打たなかった」ではない** 【確】。文字は相手の画面に入っている。送り直す前に確かめる 【文】
- ★ **失敗の JSON は stderr に出る** (stdout は空、終了コード 1。使い方の誤りは 2) 【確】

### 2.4 状態の読み方の落とし穴

- `done` と `idle` 【確】: `done` は「終わったがまだ誰も見ていない」。人が見ると (`focus`) `idle` になる。人が見ているペインでは working からいきなり `idle` になる
  → **待つときは `idle` と `done` を両方並べる**
- `state_change_seq` 【確】: 状態の変わり目ごとに増える。★ **サーバ全体で 1 本の通し番号** (班ごとではない)。「前と違う」は「動いた」の印で、「自分の便で動いた」の証明ではない
- `completion_seq` 【確】: working (か blocked) → idle のときだけ付き、値はそのときの `state_change_seq`。「起こしたあと仕事を終えたか」は「打つ前と違う値が付いているか」で見る
- 現れた直後は数秒 `unknown` 【確】。その間に打つと動きを見逃す
- `blocked` は知っている形の画面だけ 【文】。`agent explain <名前> --json` で当たった決まり (`matched_rule`)・`fallback_reason`・`visible_blocker` が見える。
  `--file 画面.txt --agent claude` ならサーバ無しで試せる 【確】。Claude の working のいちばん強い決まりは端末の題の先頭の点字 【確】

### 2.5 別の PC

- `herdr --machine <名前> <命令>` は 1 回の命令を SSH 越しに送るだけ 【文】。購読を包むコマンドは無い 【確】
- 購読を持つなら、相手で小さな中継を走らせて SSH の標準出力で行を流す形になる 【推】。相手に置くものが増えるので、班が少ないうちは 1 回ずつ呼ぶままでよい

### 2.6 Tealus (配達役) への含み

- **購読は「いま見に行け」の合図にだけ使い、打つかどうかは読んでから決める**。定期の見回りは安全網として残す (切れても黙っているので)
- 費用の面で急ぐ理由は無い。得るのは速さ (数秒 → 0.1 秒)。11 回の `agent get` は 1 回の `agent list` にまとめられる
- ★ このループで見つけて直したもの (2026-11-20): 配達役は失敗の JSON を stdout で読んでいた (→ stderr も読む。`server_not_running` が「分からない」に落ちていた) /
  `timeout`・`agent_prompt_stalled` を「届かなかった」と扱い、打ち直しで二重になりえた (→ 「戻りが分からない」として、相手の進み具合が変わったか見る。変わらなくても 30 秒は打ち直さない)

## 3. エージェント同士 (学習ループ 3)

試験用セッションで、偽の claude を 2 つ別の仕事場に置き、片方にペインの中から herdr を打たせて確かめた。本物の Claude は起こしていない。

### 3.1 ペインの中からできること

- ペインには `HERDR_ENV=1`・`HERDR_SESSION`・`HERDR_SOCKET_PATH`・`HERDR_PANE_ID`・`HERDR_TAB_ID`・`HERDR_WORKSPACE_ID`・`HERDR_BIN_PATH` が入る 【確】。
  `--session` を付けない `herdr …` は自分のセッションに当たる。エージェントが走らせたスクリプトも同じ口を引き継ぐ
- ★ **持ち主・権限の区別は無い** 【確】。別の仕事場のペインに対して、画面を読む・`pane send-text`・`pane run`・`pane close`・
  他人の `agent rename`・他の仕事場の `worktree remove` が全部通った。`agent list` は全員が見える
- ★ **郵便受けやペイン間メッセージの仕組みは無い** 【確】。あるのは「相手の端末に文字を打つ」だけ
- plugin の `[[events]]` は出来事ごとにコマンドを起動でき、中継は作れる 【文】。ただし plugin は**利用者の全セッションに効き**、箱に入らない 【文】 (本番に触れるので試していない)

| やること | 口 | 実測 【確】 |
|---|---|---|
| 相手に打って終わりを待つ | `agent prompt <名前> "<文>" --wait --timeout <ms>` | 打つ → 相手が受ける 0.32〜0.34 秒。待ちの上乗せ約 0.5 秒 |
| 助手の場所を作る | `pane split --current --direction right --cwd "$PWD" --no-focus` | 36 ms |
| 助手を起こす | `agent start <名前> --kind <種類> --pane <番号> [-- 引数]` | そのペインの PATH で最初に見つかる実行ファイルが走る。準備を待つのは CLI の側 (口を直接呼ぶと直後の prompt は `agent_not_ready`) |
| ふつうのコマンド | `pane run <番号> "<コマンド>"` → `pane wait-output --match` | 11 ms (受け付けただけ) |
| 結果を読む | `agent read <名前> --source recent-unwrapped --lines N` | 長い返事は欠けるので、ファイルに書かせて道を返させる 【文】 |
| 作業の木を分ける | `worktree create --cwd <repo> --branch <名前> --no-focus` | 151 ms。`~/.herdr/worktrees/<repo>/<branch>` と新しい仕事場ができる |

### 3.2 herdr 自身の作法 (`herdr --skill`) 【文】

- 利用者が herdr と明言したときだけ使う。「委任できそうだから」では使わない
- 既定は今のタブの隣のペイン・同じ作業フォルダ。仕事場・タブ・worktree は頼まれない限り作らない
- `--current` か番号か名前で指す。裏の仕事は `--no-focus`
- **自分が作っていないものは閉じない**。`server stop` は打たない
- blocked は画面を見て利用者に聞く。`timeout`・`agent_prompt_stalled` のあと同じ便を打ち直さない
- ★ どれも**書かれた作法で、herdr は止めない** (3.1)

### 3.3 壊れ方

| 場面 | 起きること 【確】 |
|---|---|
| 確認待ち (blocked) の相手 | `agent prompt` は `agent_blocked` で断る。★ **`pane send-text` + `pane send-keys enter` は通り、確認に答えてしまう** |
| 2 人が同時に打つ | 文字は混ざらない (22 通で 0)。ただし両方とも受け付けられ、重複は弾かれない |
| 相手が作業中 | 断られずに入る。`--wait` は「回」を追わず、先の仕事の終わりで返ることがある 【文】 |
| 誰が打ったか | 受け手には分からない。打てる人は誰でも、その相手の「利用者」になる |
| 記録 | `herdr-server.log` に時刻・命令名・成否だけ。**宛先・文面・送り手は残らない** |

### 3.4 4 つの型

| 型 | 速さ | 記録 | 人が見る・止める | 向くもの |
|---|---|---|---|---|
| (a) 相手のペインに直接打つ | 0.3 秒 | 無し | その画面を見ていた人だけ | 班をまたいでは使わない |
| (b) 助手を隣に生んで待つ | 生むのに数秒、以後 0.3 秒 | 無し | 同じタブに見える | 自分の班の中の下ごしらえ・試験・ビルド |
| (c) worktree を分ける | 0.15 秒 | git に残る | 仕事場として見える | 利用者が頼んだときだけ |
| (d) 起こすだけ herdr、会話は部屋 | 今は数秒 | 部屋に全部 | 部屋で見て口を挟める | 班と班・人と班のやりとり全部 (今の形、docs/12) |

### 3.5 Tealus での線引き (提案)

**herdr で直接してよい**
- 自分の班が**自分で作ったペイン**でのコマンド実行と助手 (同じタブの隣・同じフォルダ)。終わったら自分で閉じる
- 状態を見るだけの `agent list`・`agent get`
- 配達役の起こし (id だけの決まった文面、docs/12 §8)

**Tealus の部屋を通す**
- ほかの班への依頼・問い・訂正・結果の報告すべて。人の判断が要ること。あとで「誰が何を頼んだか」を引くこと

**しない**
- ほかの班のペインへの `agent prompt`・`pane send-text`・`send-keys`・`pane run`・`close`・`rename`・画面の `read`
  — 本文を渡すことになり (docs/12 §8 の 1)、配る人が 2 人になり (§4.4)、記録が残らない
- blocked への代答 (`pane send-text` で抜けられるが使わない。docs/12 §8 の 12)
- 頼まれていない仕事場・worktree を作ること、plugin を足すこと (全セッションに効く)、`--machine` でほかの PC のエージェントを起こすこと (docs/12 §9)

- 班の間を速くしたいなら、直接打つのではなく配達役を `events.subscribe` (§2) で速くする。得は数秒で、失うのは記録
- ★ herdr は止めてくれないので、この線引きは各班の手順 (`handle-tealus`) に書いて守る。
  破られたことに気づく手として、`herdr-server.log` の `agent.prompt` の回数と配達役が打った回数を突き合わせる案がある 【推】
- ★ ペインの中で動くものは何でも、同じ機械の全部の班に打てる (認証なし)。安全の見直しはループ 5

## 4. 人とエージェント (学習ループ 4)

試験用セッションで、受けたキーを全部記録する偽の TUI を置き、pty 越しに herdr の画面 (TUI) をつないで確かめた。本物の Claude は起こしていない。

### 4.1 見るだけ・事故を防ぐ

- ★ **TUI を読むだけでつなぐ口は無い** 【確】。`herdr`・`herdr session attach <名前>`・`--remote` のどれにも読むだけの指定は無い。つないだ人のキーは全部ペインに届く
- **読むだけなのは `terminal session observe` だけ** 【確】。1 行 1 JSON (中身は base64)。stdin に何を書いてもペインには届かない。何人でも同時に見られる 【文】。
  人が見るには base64 を戻して端末に書く小さな道具が要る 【推】
- `terminal attach`・`agent attach` は **Windows では未対応** 【確】
- ★ **Ctrl+C は設定で飲み込める** 【確】 (2026-11-19 に「止める設定は無い」と答えたのは誤り)。既定では TUI で押した Ctrl+C はそのままペインに届く (Claude が落ちた事故の道)。
  server の config.toml に次を足して `herdr server reload-config` すると届かなくなる (再起動は要らない):

  ```toml
  [[keys.command]]
  key = "ctrl+c"
  type = "shell"
  command = "rem"
  description = "ctrl+c は届けない"
  ```

| 試した形 | ペインに届いた Ctrl+C 【確】 |
|---|---|
| 既定 | 届く |
| server の設定に上の結び | 届かない (ほかの文字は届く) |
| client の設定だけに結び | 届く — **キーは server 側の設定で決まる** |
| 結んだまま、外から `herdr pane send-keys <ペイン> ctrl+c` | 届く (止めたいときはこれ) |

  - ★ 効くのはその server の全ペイン。herdr の中の普通のシェルも TUI からは Ctrl+C で止められなくなる (Claude Code を止めるのは Esc なので班には困らない)
  - `HERDR_CONFIG_PATH` を変えて server を起こせば、セッションごとに別の設定にできる 【確】
- 抜けるのは Ctrl+B → q。抜けてもエージェントはそのまま 【確】。2 人が同時につないでも両方生きる 【確】

### 4.2 知らせ

- `notification show` が `disabled` だったのは、`[ui.toast] delivery` の既定が `"off"` のため 【確】。`delivery` は `off` / `herdr` (画面の中) / `terminal` / `system` (OS の通知) 【文】
- `herdr` にすると画面の隅に出る。裏の仕事場のエージェントが blocked になると自動で「<種類> needs attention」 (画面の文字は出ない) 【確】
- ★ どの形も**画面をつないでいる人**にしか届かない 【確】【文】。**スマホには届かない** — 届くのは Tealus の通知
- plugin で Tealus に投稿することはできる 【推】 が**作らない**: plugin は全セッションに効き・箱に入らず・Tealus の鍵を持つことになり、配達役の鼓動と同じ仕事が 2 か所になる

### 4.3 札 (`report-metadata`)

```
herdr pane report-metadata w1:p1 --source tealus:courier --token unread="未3" --token last="14:05" --ttl-ms 120000
herdr pane report-metadata w1:p1 --source tealus:courier --clear-token unread --clear-token last
```

- ★ **既定の画面には出ない** 【確】。サイドバーの行に `$名前` を足して初めて見える (`[ui.sidebar.agents] rows = [..., ["$unread", "$last"]]`)
- 期限 (`--ttl-ms`) が来ると画面からも `agent get` の `tokens` からも消える 【確】。配達役が見回りのたびに付け直せば、配達役が止まると札も自然に消える
- 上限 【確】: 値 80 字・1 回 16 個まで・名前は英数字と `_` `-` (日本語の名前は不可)・`--ttl-ms` は 24 時間まで。サイドバーは幅 26 桁が既定なので短く。狭い画面 (1 列表示) には出ない
- 札は表示だけで、状態・待ち・知らせには効かない 【文】

### 4.4 口を挟む

| 道 | 確認待ち (blocked) の相手に | 向くもの |
|---|---|---|
| TUI でその班を選んで打つ | 届く (人が画面を見て答える) | **確認に答える正しい道** |
| `agent prompt` | 断る (`agent_blocked`) 【確】 | 空いている相手への指示。配達役はこれだけ |
| `pane send-text`・`pane send-keys` | **通って答えになる** 【確】 | 使わない (docs/12 §8 の 12) |

- **Tealus から代わりに答える仕組みは作らない** (docs/12 §9 のまま)。何を許すのかを見せる (= 画面の文字を写す)・押した人の確かめ・取り違え防止・記録を、全部 Tealus と配達役が持つことになり、配達役が「もう 1 人の利用者」になる
- 間の案: Tealus は「ec班が確認待ち」と**開き方**だけを出す (PC で `herdr` → その班 → 答える → Ctrl+B → q)

### 4.5 スマホ・離れた所から

- herdr にスマホ用のアプリも web の画面も無い 【文】。道は「SSH のアプリで機械に入って `herdr`」。狭い幅では 1 列の表示になる 【確】
- ★ SSH で入ったスマホは、全部の班に打てる・閉じられる (§3.1)。常用は勧めない

| | herdr | Tealus |
|---|---|---|
| スマホで班の状態を見る | SSH + TUI | 「AIの班」のタブ |
| 確認待ちを知る | 画面をつないでいる間だけ | 業務メモ + 通知 |
| 班に頼む・聞く | その班の端末に打つ (記録なし) | 部屋に `@cc-班` (記録あり) |
| 確認に答える | TUI で打つ | できない (作らない) |
| 画面そのものを見る | できる | 写さない (docs/12 §9) |

### 4.6 Tealus への提案 (上から順)

| # | 案 | 使う機能 | 危なさ |
|---|---|---|---|
| 1 | Ctrl+C を飲み込む結びを config.toml に足す | `[[keys.command]]`・`server reload-config` | 普通のシェルも TUI から Ctrl+C が効かなくなる。本番の設定を変える (利用者の判断) |
| 2 | 「AIの班」の確認待ちの行に開き方を出す | 今の鼓動だけ | なし |
| 3 | 配達役が `unread`・`last` の札を期限つきで付ける | `pane report-metadata`・サイドバーの行 | 配達役が herdr に書く口が 1 つ増える (表示だけ) |
| 4 | PC 用の読むだけの覗き窓 | `terminal session observe` | 画面は手元にだけ出す |
| 5 | PC の前の人向けの知らせ | `[ui.toast] delivery` | 画面をつないでいる間だけ |

- **しない**: Tealus から確認に答える / plugin で Tealus に投稿する / 画面を Tealus に写す
