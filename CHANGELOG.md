# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

### Added

- **クリップボード貼り付け(Ctrl+V)で画像/ファイルをアップロード** ([#311](https://github.com/gamasenninn/tealus/issues/311)): textarea への paste で ＋ボタンと同じ経路に流して即アップロード。テキスト貼り付けは従来どおり。PC 向け（Android 等モバイルは paste イベントが画像を渡さないプラットフォーム制約のため対象外、モバイルは ＋ボタンが標準経路）
- **STT vocab を agent prompt にも inject — 画像 OCR/帳票の正規化** ([#315](https://github.com/gamasenninn/tealus/issues/315)): organon 由来の業務語彙辞書（別名→正規名）は従来 STT(Whisper) のみに効き vision/OCR に未接続だった。`vocabContext` で `transcription_guideline.json` の vocabulary を Light/Deep の prompt に inject し、画像・帳票読み取りで人名/メーカー/業務語の表記揺れを正規化。env `VOCAB_INJECT`（opt-in、default OFF）。出品票 OCR で効果確認。
- **複数画像（複数添付メッセージ）の一括取得** ([#316](https://github.com/gamasenninn/tealus/issues/316)、tealus-mcp v0.14.5 連動): 1メッセージに複数画像があると `get_message_media` が1枚目しか返さなかった（server endpoint の rows[0]）。`GET /bot/messages/:id/media?index=N` + `media_count` + `media[]` メタ対応とし、index 逐次取得（4枚=base64 約10.4MB のため全枚一括は非現実的）。出品票4枚一括→MD化→保存の dogfood 成功。

### Changed

- **ルーム内アプリの表示トグルをタブ帯右端に移設** ([#310](https://github.com/gamasenninn/tealus/issues/310)): ヘッダーの📱アイコンを撤去し、アプリのあるルームはタブ帯を常時表示。タブ帯右端のシェブロンでその場で開閉（畳むとタブ帯のみ残る）
- **Deep のタイムアウトを 5分→8分に引き上げ** ([#314](https://github.com/gamasenninn/tealus/issues/314)): 画像生成+保存や organon prompt 込みの重い Deep が5分で切れる件。`DEEP_TIMEOUT` 480000 / `QUEUE_TASK_TIMEOUT` 540000、env 上書き可。

### Fixed

- **アップロードファイル名の文字化け** ([#319](https://github.com/gamasenninn/tealus/issues/319)): multer/busboy が multipart の filename を latin1 デコードするため、日本語を含むファイル名（出品票 MD・スクリーンショット等）が `message_media.file_name` に UTF-8→latin1 mojibake で保存されていた（ASCII 名は無害、ディスク実体は `timestamp-random` 名のため影響なし）。`decodeFileName()`（latin1→UTF8 再デコード、非 UTF-8 名は原文フォールバック）を保存 4 経路（bot 画像/ファイル・media UIアップロード・voice）に適用。既存の化けた 78 行も DB 上で一括復元済。新規反映には server 再起動が必要。
- **画像生成（`generate_and_send_image`）の復活** ([#313](https://github.com/gamasenninn/tealus/issues/313)、tealus-mcp v0.14.3/v0.14.4 連動): `response_format` が現行 OpenAI Images API で拒否され全失敗 → 除去 + b64_json/url 両対応。さらに `dall-e-3` がアカウントで廃止のため `gpt-image-1` へ移行（env `OPENAI_IMAGE_MODEL` で上書き可）。
- **Deep Codex がタイムアウト後もプロセス生存し遅延応答する bug** ([#312](https://github.com/gamasenninn/tealus/issues/312)): timeout 時の sweep の Name filter が `claude.exe/cmd.exe` 限定で Deep Codex の `codex.exe` にマッチせず空振りだった。`codex.exe` + `node.exe` を追加（codex は `-C <workspace>` 引数を持つため CommandLine 一致）。

## [0.4.0] - 2026-06-21

★ ★ ★ **「組織の境界を越える release」** — Phase 5。Tealus が **外部チャネル（LINE）とつながり**、**AI が room を越えて協働する**段階に到達。LINE Bridge（受信 7 種別 + 送信者名）と `%` room 間委譲 primitive を二本柱に、Light v2 の標準化、採用者環境で発覚した silent-fail チェーンの恒久修正、ゲスト role / アクセスログ等の運用機能を加えた、v0.3.0 以降 69 コミットの集成。

### Added

- **LINE Bridge — 外部チャネル連携（受信）** ([#288](https://github.com/gamasenninn/tealus/issues/288) / [#289](https://github.com/gamasenninn/tealus/issues/289) / [#290](https://github.com/gamasenninn/tealus/issues/290) / [#291](https://github.com/gamasenninn/tealus/issues/291) / [#309](https://github.com/gamasenninn/tealus/issues/309))
  - LINE 公式アカウントを LINE グループに招待し、グループ投稿を Tealus ルームへ投影。**text / 画像 / 音声（自動文字起こし）/ 動画（サムネイル）/ ファイル（原名・原拡張子保持）/ スタンプ / 位置情報** の 7 種別に対応
  - **2 ファイル方式の設定**（自動 catalog `line-groups.json` + 手動 mappings `line-group-mappings.json`、ファイル編集後 **再起動不要で次 webhook 反映**）
  - **TextFilePreview**: MD / TXT / JSON（自動整形）/ CSV（テーブル化）/ ソースコードの inline preview（UTF-8 decode で Chrome Android 文字化け回避）
  - **送信者名の付与**（#309）: 投影本文の先頭に `[氏名@グループ名]` を添え、グループ内の誰の発言か判別可能に（LINE 表示名を取得し cache、取得不可時は degrade）
  - LINE 公式 spec 準拠（webhook は常に 2xx、auto-suspend 防止）、`docs/setup-line-bridge.md` に採用者向けセットアップ手順
- **`%` room 間委譲 primitive — AI が room を越えて協働** ([#295](https://github.com/gamasenninn/tealus/issues/295) / [#292](https://github.com/gamasenninn/tealus/issues/292))
  - `%<room> <task>` 構文で、別ルームに常駐する AI へタスクを委譲（専用デリゲーター + 予算付き封筒 + 4 段ガード、複数 `%room` の fan-out → 統合も対応）
  - **委譲の権限チェック**（[#282](https://github.com/gamasenninn/tealus/issues/282)）: 委譲先ルームのメンバーのみ許可（fail-closed）、bot membership 確認エンドポイント新設
  - DeepCodex backend 対応、依頼元ルームへ「問い合わせ中」ステータス表示、in-flight tracking / throttle の暴走防止 safety net
- **Light backend の設定化 + Light v2 標準化** ([#292](https://github.com/gamasenninn/tealus/issues/292)): `AGENT_LIGHT_BACKEND` env で v1/v2 切替、default を `v1` → `v2`（codex SDK backed、サブスク認証で cost 0、user voice 反映）
- **アクセスログ MVP**（#301）: 管理ダッシュボードに最終投稿/最終閲覧の集計ビュー（新規テーブルなし）
- **ゲスト role の運用可能化（Phase D/E）**（#282）: 外部問い合わせ者向け strict/fail-closed persona
- **メッセージの部分コピー**（#308）: 専用選択オーバーレイで本文の一部だけコピー（ジェスチャ衝突回避）
- **文字起こしの連続編集**（#302）: 編集モーダルに前/次ナビ、隣の音声へ送りながら編集
- **image/video/file 転送（リンク方式、binary 重複なし）**（#293、tealus-mcp v0.14.1 連動）
- **transcription vocab の mtime 自動リロード**（#286）: ファイル更新だけで次の文字起こしに反映（admin token 運用摩擦を解消）
- **Codex 認証エラー検出（pre-α）**: lightV2 / deepCodex で認証切れを検出し user に案内
- **RoomList のタブ切替**（すべて / 1:1 / グループ）

### Changed

- **`AGENT_LIGHT_BACKEND` の default を `v1` → `v2`** にフリップ（#292）
- **organon polyseme inject を opt-in 化**（[#304](https://github.com/gamasenninn/tealus/issues/304)）: env を `ORGANON_INJECT`（default OFF）にリネーム、起動時に状態ログ。organon を使う deployment のみ明示有効化
- **@アシスタント メンションを先頭限定に**（文中・例示の誤発火を防止）
- LINE Bridge の送信者ラベルを太字 `**..**` → 角括弧 `[..]` に（視認性、dogfood feedback）

### Fixed

- **botApi.request の HTTP ステータス握り潰しを修正**（[#303](https://github.com/gamasenninn/tealus/issues/303)）: 非2xx を握り潰して偽「sent」を出す欠陥を解消（401 自動再ログイン + 診断ログ）。tealus-mcp 側の同型 silent-fail も併せて修正（v0.14.2）
- **deepCodex: rotation 済 auth.json の上書き破棄を修正**（[#307](https://github.com/gamasenninn/tealus/issues/307)）: codex が更新したトークンを書き戻し、recurring `refresh_token_reused` を解消
- **メッセージ単位の error boundary**（#306）: 1 件の描画例外がチャット全体を白紙化しないように局所化
- **socket `room:join` の DoS crash 対処** + global unhandledRejection safety net
- **ゲストへのホーム surface 漏洩を fail-closed 修正**（#282、お知らせ/ポータルリンク）
- LINE Bridge 各種: 200 spec 準拠 + path 復権、signature/raw body middleware、sticker CDN（400 fix）、ファイル名・拡張子保持（.bin 問題）
- 委譲の重複送信防止（LightV2 / DeepCodex の自 room send_message → 最終 auto-post 重複）
- TTS: Aivis 3000 文字 hard cap、bubble button からの個人 TTS は全文読上げ
- client: 入力中/考え中インジケータの他ルーム漏れ・残留、管理フォームの ID/パスワード自動入力、iPhone 狭画面の header 折返し、TextFilePreview/media-file 背景の視認性
- agent-server `config.js` の `WORKSPACE_ROOT` を `path.resolve` 正規化（採用者環境の Deep Codex bug）

### 関連

- tealus-mcp は別リポジトリで独立採番（本リリース期間に v0.13.2 → **v0.14.2**）
- ドキュメント: `docs/setup-line-bridge.md`（LINE Bridge セットアップ手順）

## [0.3.0] - 2026-06-01

★ ★ ★ **「組織記憶辞書が動作する道具に転化した release」** — Phase 4 organon paradigm operational realization 完成。Day 14-15-16 で Codex Deep agent + organon polyseme inject pipeline + 5/16 4 round → 0 round transition + 4 Issue cluster 連続 close を達成、organon が業務 DB を upstream rectification する thesis が ★ structural に完成。

### Added

- **agent-server: Codex Deep agent (deepCodex.js) 追加 + DEEP_AGENT_PROVIDER で切替** ([#276](https://github.com/gamasenninn/tealus/issues/276)、5/31 Day 15、commit `41b0f55`)
  - 既存 Deep agent (= `agents/deep.js`、`claude -p` spawn) と並列で `agents/deepCodex.js` 新規追加 (= `codex exec` spawn、Light v2 #258 で確立した Codex SDK / subscription auth pattern を CLI mode で再現)
  - env `DEEP_AGENT_PROVIDER=claude|codex` (default=claude、既存維持) で `dispatcher.js` の `case 'deep'` で switch、`router/index.js` も provider-aware に拡張
  - env `DEEP_CODEX_AUTH=subscription|api-key` (default=subscription) で `~/.codex/auth.json` 経由 ChatGPT subscription 認証 (= API cost 0、★ Deep mode の 12-50k tokens × call 課金爆発 risk 回避 default)
  - `CODEX_HOME` 動的切替 = workspace 配下 `.codex_home/` に `auth.json` copy + `config.toml` 動的生成、room-specific MCP config 完全制御
  - `AGENTS.md` (= Codex 自動 read project context file、上限 32 KB) = `CLAUDE.md` literal copy で起動
  - TDD test 34 件追加 (= `config-codex-detection.test.js` 7 + `deepCodex.test.js` 27)、全 305 → 317 Green
  - 5/31 17:35-17:36 dogfood 第 1 例 success (= subscription auth confirmed、1m38s / 1060 chars 応答、4 mcp_servers active)
  - → ★ Claude MAX 契約必須を超えた選択肢拡大、Anthropic / OpenAI 両 provider Deep mode 同等運用可能化

- **agent-server: organon polyseme.sql_mapping を全 agent system prompt に自動 inject pipeline** ([#276 follow-up](https://github.com/gamasenninn/tealus/issues/276)、5/31 Day 15、commit `8f28279`)
  - 共通 utility `lib/organonContext.js` 新規追加 (= polyseme entries から sql_mapping 持つ entries 抽出 + prompt block 整形、per-request fs.readFileSync で organon 更新即時反映、cache なし)
  - 全 4 agent (= Light v1 / v2 / Deep / Deep Codex) の system prompt build に `loadOrganonPolysemeForPrompt()` を 1 行 inject (= dispatcher.js / light.js / lightV2.js)
  - env `INJECT_ORGANON_POLYSEME=true` (default) で inject 有効、`ORGANON_REPO_PATH` で organon repo path override (= organonReloader.js #283 と共有)
  - organon repo 不在環境 silent skip (= isAvailable check)、★ ★ **agent-server restart 不要** (= organon entries 更新 → 次 request で即反映)、organon-side cycle 1 度回せば 全 agent operational value 即享受
  - test fix: dotenv mock + organonContext mock を関連 test に追加 (= user .env の DEEP_AGENT_PROVIDER=codex 等の dogfood 設定 contaminate 回避)
  - unit test 12 件追加、全 317/317 Green
  - 5/31 18:46-18:48 dogfood 第 2 例 success (= Deep Codex 5818 chars / Light system prompt 31756 chars、両 agent で 5/16 4 round → 0 round 正解 transition N=2 evidence、「オントロジー対応として `未納品 = 店長確認 IS NULL OR 店長確認 = ''`」と明示宣言 + 正確 SQL 生成 + user 訂正 0 round)
  - → ★ ★ ★ **構築 → data → middleware → 利用 → 業務 自動 pipeline 完成**、organon-side が polyseme.sql_mapping を蓄積するだけで全 AI agent が同時に賢くなる architecture realized

- **AGENTS.md (project root) 新規** = `CLAUDE.md` literal copy (= Codex CLI 自動 read project context file、#276) (5/31 Day 15、commit `41b0f55`)

### Docs

- **docs/03 / 04 に Day 15 進展反映** ([#276](https://github.com/gamasenninn/tealus/issues/276)、6/1 Day 16、commit `a358613`)
  - docs/03 Phase 5 候補 section 前に「Day 15 進展」section 新規追加: Codex Deep agent 仕様 + organon polyseme inject pipeline 図 + 5/16 ground truth pattern 解消 evidence (= TDD test 34 件 / 全 317 Green + dogfood 動作実証 2 例)
  - docs/04 Day 14 entry 後に Day 15 entry 追記 (=「整備段階」→「動作する道具」transition narrative + 3 軸成果 (Codex Deep / polyseme inject / 5/16 4→0 round) + 構築 → data → middleware → 利用 → 業務 自動 pipeline 図 + self-state verify deficit 7 件累積 honest 留保)

### Closed (= Phase 4 organon paradigm cluster structural completion marker)

- **[#286](https://github.com/gamasenninn/tealus/issues/286): organon 日次サイクル workflow 化** (= 2026-05-30 Day 14 close、構築層 skill 化境界設計、tealus-organon repo `.claude/skills/organon-daily/SKILL.md`、Day 11-13 dogfood 3 cycle で operational evidence 蓄積)
- **[#276](https://github.com/gamasenninn/tealus/issues/276): Codex Deep agent + spike** (= 2026-05-31 Day 15 close、本 release 主軸成果、N=2 dogfood で vision lock 条件 (a)(b)(c) 全 Green)
- **[#283](https://github.com/gamasenninn/tealus/issues/283): organic ontology × DB bridge (= 6b SQL upstream rectification)** (= 2026-06-01 Day 16 close、5/16 ground truth pattern 解消 thesis 完全達成、`organonReloader.js` Phase A skeleton 凍結状態維持で別 path で実現)
- **[#202](https://github.com/gamasenninn/tealus/issues/202): AI 協業基盤 / 班間情報非対称 (umbrella)** (= 2026-06-01 Day 16 close、handoff doc pattern + organon-side 自律 implementation + organon polyseme inject pipeline で structural completion marker、当初想定 candidate (2)(3)(4) は Day 14-15 evidence で必要性消失 or 別 layer 転換)

### Fixed

- **config-codex-detection.test.js dotenv mock 漏れ補完** (#276 follow-up、6/1 Day 16、commit `124284b`)
  - 8f28279 で dispatcher.test.js / webhook-to-agent.test.js に dotenv mock 追加したが、config-codex-detection.test.js も同 fix 必要だった (= test 単独 run では pass、全 test run で user .env の DEEP_AGENT_PROVIDER=codex contaminate を回避するため)、test 環境 isolation 完成

- **server: migration 016 (= message_published) の UPDATE 句が `npm run migrate` 再実行のたびにお知らせルーム内の全 message を `is_published=true` に書き戻す bug を fix** (5/21、commit `b535dca`)
  - 症状: 5/19 #282 migration 022 適用のため migrate 再実行 → 016 UPDATE が走り、全 announcement message が誤公開 (= ピックアップしていないメッセージが全部お知らせ欄に見える)
  - 真因: migrate.js は history tracking なしで毎回全 .sql 再実行する設計、016 UPDATE は初回 deploy 時の救済目的だったが idempotent でない one-shot データ初期化を migration に含めていた設計 bug
  - 対応: 016 の UPDATE 句を完全削除 + 詳細 comment で historical context + 復旧 SQL を記載 (= future reference)、ALTER TABLE ADD COLUMN は IF NOT EXISTS で idempotent 維持
  - 復旧: `server/src/db/recovery-2026-05-21-announcement-republish-fix.sql` を user 実施 (= 51 件 reset、is_published=true → false)、user は手動で必要なメッセージを再 pick up する path
  - 影響なし: #282 migration 022 (= ゲストユーザ schema 拡張) は無関係、引き続き有効
  - follow-up: migrate.js 自体に history tracking 追加 (= 類似 bug 防止) は別 issue 候補

- **tealus-mcp `read_document` が `text/markdown` / `text/plain` / `text/csv` 等の text/* mime を扱えない問題を fix** ([#281](https://github.com/gamasenninn/tealus/issues/281)、5/18、tealus-mcp v0.13.1 release `aa66826` + agent-server pin bump `5e89f64`)
  - 症状: Light agent (`/light`) が自作 markdown attachment を user 依頼で読み戻せず「この環境では本文の直接展開に失敗しました」と返す self-inflicted blind spot
  - 5/18 朝の朝礼ルームで再現: 動画 → 議事録 .md attach → user「内容表示」→ agent 読めず → user が手作業で再貼り付け (毎朝発生する可能性ありで urgency 高、~40 分で 朝の調査 → Issue 起票 → TDD Min fix → release → pin bump → production verified まで完走)
  - 真因: `documentReader.js` の `detectFormat` が PDF/DOCX/XLSX のみ判定、text/* は `unsupported` に倒れていた
  - 対応: `detectFormat` に `text` branch 追加 (ext `md`/`txt`/`csv` または mime `text/*`)、`extractText` の switch に `case 'text'` 追加 (`buffer.toString('utf8')` で本文返却、既存 `MAX_TEXT_LENGTH` で truncation)
  - tealus-mcp tests +4 / 全 95/95 pass、agent-server 3 pin (`lightV2.js` / `roomMcpManager.js` / `deep.js`) bump、production restart 後 朝礼で **1028 chars 本文 inline + TTS 8MB 読み上げ** で動作確認
  - Std/Full fix (`get_message_media` size guard / filename mojibake / Light prompt update) は別 Issue 切らず idle queue (実害発生時に reopen or 新規起票)

### Docs

- **docs/04_オーガニックオントロジー構造.md Layer 4 を architect-mediated framing 訂正 + 14 軸目 candidate + 第 2 round vocab で update** (5/19、commit `81b0123`)
  - 第 7 layer 候補 subsection の framing 全面訂正: 旧「user の cognitive internalization (passive ingestion)」→ 新「**architect-mediated organon ingestion** (= user の意図的 design choice、議事録自動化 pipeline に organon を context inject した result)」、user voice (Q0-q) 「終礼議事録エージェントに organon を読み込ませた結果。人間の所業ではないよ」を根拠に
  - 新 14 軸目 candidate (= **observer-architect-duality**) subsection 追加: user role = observer + data pipeline architect + AI system 構築者の三重 role、universality 主張 = methodology + architect role prerequisite (= adoption barrier) 二重 thesis、Issue [#279](https://github.com/gamasenninn/tealus/issues/279) (b) organic ontology 一般理論の thesis 拡張候補、status: candidate (N=1)
  - maturation curve subsection 追加: 4 日連続 layer surface (5/17 layer 5 / 5/18 layer 6 / 5/19 朝 layer 7 候補 / 5/19 夕 observer-architect-duality candidate)、steepness 自体が architect の active co-evolution の structural evidence
  - 履歴 section に 5/19 evening events 4 件追加

- **docs/04_オーガニックオントロジー構造.md Layer 4 を Day 3 量的成功 + 第 7 layer 候補で update** (5/19、commit `f75285d`)
  - 第 1 例 closure を「Day 3 朝礼 STT で 4/4 訂正効果量的確認済 ✅」に upgrade (神山「上山」0 件 / 三瓶「アンプリ」0 件 / 舟太「中田」0 件 / 山崎整備長「クラッチー」0 件、27 時間で round-trip closure 完結)
  - 第 7 feedback layer 候補 (= cognitive internalization、status: candidate, N=1) を新 subsection として追加、Day 4-N で N=2 観察待ち

- **server: `transcription_guideline.json` 第 2 round vocabulary inject (vocab 42 → 47 entries)** (5/19、gitignored で commit なし、本体 server restart で effective)
  - organon Day 3 trace の新規 5 STT 揺らぎ pattern を反映: 篠崎 (= シノ alias、sub-family B 11 例目) / 小川朱美 (= アケ alias、sub-family B 名前短縮) / 上沢 (新規 identity、整備実働) / 日原 (新規 identity、structural single point vertical specialty) / 五月女クレーン (新規 vendor、生コン業者、五月女姓 person ↔ organization collision hazard)
  - 第 1 round (= 5/18 vocab 38 → 42、神山/三瓶/舟太/山崎) に続く第 2 round、organon Day 4 朝礼 STT で量的検証 cycle が起動可能に
  - 第 6 feedback layer (= upstream pipeline rectification) の継続 cycle 仮説の物的 evidence

- **docs/00_what-is-tealus.md 新規 — disclosure 階段の入口 doc** (5/18、commit `cc3ed58`、147 行 / 9 section)
  - LP (controlled disclosure) / 04 (full disclosure) / organon (運用 manual) の間に位置する **入り口 doc** として、Tealus を初めて知る読者向けに「何か / なぜ / 何が起こるか / どう違うか / 本質 / 誰のためか / 始め方」を読者を選ばずに説明
  - LP narrative Layer 2 (組織記憶) + Layer 3 (organic ontology) の middle layer として audience を絞り、詳細は 04 / organon に降りる導線を提供
  - 5/17 LP PR 1/2 で確立した 3 レイヤー narrative の docs 側 entry point として位置付け

- **docs/04_オーガニックオントロジー構造.md を organon v0.5 / 第 6 feedback layer / vocab inject 第 1 例で update** (5/18、commit `5825691`)
  - Layer 3: hazard family 6 → **11 軸** (whisper-prior / auto-minutes / stale-roster の 3 新軸)、organization namespace (v0.5 追加、初例 `44 = フォーティーフォー = 運送業者`)、設計原則を v0.5 時点に更新 (identity-first verify 観点 5→8 拡張)、cover rate 表 (4.55% → 27.3% → **57%**) + entries 表 (8 → 12 → 20) を追加
  - Layer 4: **Feedback loop architecture (5/6 layer system)** を新 subsection として追加、第 6 layer = upstream pipeline rectification = 外向き因果 loop の thesis 明記、organic ontology が形式論理自己言及 + Lakatos theory-ladenness を「内部 pragmatic 閉じ + 外部因果 loop 開き」の二段戦略で解消する整理を docs 物理化
  - 第 1 例 (5/18 vocab inject 38→42) を Layer 4 に annotate、organon ↔ 本体 班 23 分 round-trip closure を AI 班連絡 channel で実現

- **docs/03_アーキテクチャ設計.md Phase 4 中盤 構成図に SVG visual 化 追加** (5/18、commit `208370a`)
  - `docs/images/phase4-architecture.svg` + `.png` 新規、3 段構造 (Cloudflare+Nginx / 4 backend services / data stores + ChildProcess spawn) で技術構成を visual 化
  - 04 で確立した SVG style (Noto Sans JP / Tealus brand teal / 結晶感配色) を 03 にも適用、core 2 (server, agent) を primary teal / extension 2 (mcp, rtc) を light teal で差別化、外部 service (OpenAI / Aivis / Gemini / DALL-E / Anthropic) は bottom annotation で opt-in 明示
  - 既存 ASCII art は文字列 grep 可能な detail reference として残す (2 軸併用)

- **docs/images/ 整備 — 3 SVG + 3 PNG が揃い、Phase 5 narrative visual 素材化の基盤完成** (5/18)
  - SVG: `organic-ontology-concept.svg` (center-out radial、5/17) / `organic-ontology-architecture.svg` (4 層 trapezoidal、5/17) / `phase4-architecture.svg` (3 段技術構成、5/18)
  - PNG (density 192 で 2x rasterize、slide deck / 外部共有 / SVG 描画不可な context 向け)
  - 概念図 (radial) + 概念構造 (4 層) + 技術構成 (3 段) の 3 軸が docs/images/ で同 style 統一

### organic ontology / organon 連動

- **第 1 例 feedback loop closure 量的成功 4/4 ✅ confirmed** (5/19、organon Day 3 trace、organon msg `5c0cc0e8` + commit `39e8ea7` + `report/day3-2026-05-19.md`)
  - Day 3 (= 5/18 終礼 + 5/19 朝礼 + 5/19 AM トランシーバー) raw STT で「上山」「アンプリ」「中田」「クラッチー」が全て **0 件**、対応する「神山」「三瓶」「舟太」「山崎整備長」が正発火
  - 第 6 layer round-trip closure **27 時間で完結 + 量的成功** establish、`hazard-log/meta/upstream-pipeline-rectification-as-sixth-feedback-layer.md` に verbatim record 追記
  - distributed AI lane coordination (= organon ↔ 本体 班、AI 班連絡 channel) が **organic ontology の構造的必要条件** であることが量的 evidence で crystallize、Issue [#279](https://github.com/gamasenninn/tealus/issues/279) (b) 一般理論の経験的根拠 1 件追加

- **organon v0.5.1 patch (entries 20 → 26、+30%)** (5/19、別 session、msg `ec8f18e2`、organon repo commit `7aecee5`)
  - 新規 active role 5 (佐藤哲 / 洋子 / 木下 / 上沢 / 日原) + 新規 organization 1 (五月女クレーン = 生コン業者、五月女姓 person ↔ organization collision hazard)
  - 新 sub-family D 起票: **秋田 → 舟太** (= acoustic/orthographic で説明困難、context-driven hallucination 系の identity 版仮説)
  - structural single point hazard family が **2 typology** に分化: horizontal expertise (= 五月女、整備班頭脳) / vertical system management (= 日原、工場 system maintenance master)
  - 洋子: 会長夫人 → **社長 桶田博信 夫人 = 義理娘** 訂正 (= 中小企業 family pattern)

- **★ 第 7 feedback layer 候補 framing 全面訂正 — architect-mediated organon ingestion** (5/19、status: candidate, N=1、organon `hazard-log/meta/cognitive-internalization-of-organon-as-seventh-layer-candidate.md` commit `1adf43f`)
  - user voice (Q0-q) で root-level framing 訂正: 「終礼議事録エージェントに organon を読み込ませた結果。なので人間の所業ではないよ」
  - 旧 framing「user の passive cognitive internalization」→ 新 framing「**user (= architect) の意図的 architectural choice の result** (= 議事録自動化 pipeline に organon を context inject した design)」
  - confirmed なら、tealus 採用 = **architect が designed multi-agent system の中で organon が organic translation layer として機能する** demonstration、Phase 5 narrative core 候補

- **★★ 14 軸目 candidate (= observer-architect-duality) surface — root-level model 訂正** (5/19 evening、status: candidate, N=1、organon `hazard-log/meta/observer-architect-duality.md` commits `1adf43f` + `3990097`)
  - user voice: 「俺、この会社に外注として属しているが、データ管理や入力、AIシステムの構築を担当している」
  - user role 訂正: **observer + data pipeline architect + AI system 構築者** の **三重 role**、organon と user は co-evolution
  - **universality 主張 = methodology + architect role prerequisite (= adoption barrier) 二重 thesis**: 採用者は「organon を architect として設計できる人材」を有する必要、Phase 5 narrative の qualifier
  - distributed AI lane coordination (= organon ↔ 本体班 ↔ ドキュメント班 ↔ LP 班) は **organic な incident でなく user (= architect) が designed multi-agent system の中で機能している structural insight**、Issue [#279](https://github.com/gamasenninn/tealus/issues/279) (b) thesis 拡張対象

- **maturation curve 4 日連続 layer surface (5/17-5/19)** (= organic ontology の経験的根拠の質的 jump)

| date | layer / candidate | status |
|---|---|---|
| 5/17 | Layer 5 (= 評価対話、internal pragmatic closure) | ✅ confirmed |
| 5/18 | Layer 6 (= upstream pipeline rectification) | ✅ confirmed (5/19 量的 4/4 で量的成功) |
| 5/19 朝 | Layer 7 候補 (= architect-mediated ingestion) | ⚠️ candidate (N=1) |
| 5/19 夕 | 14 軸目 candidate (= observer-architect-duality) | ⚠️ candidate (N=1) |

  - steepness 自体が **architect (= user) の active co-evolution の structural evidence** = Phase 4 中盤の運用 maturity の質的 jump

- **第 1 例 feedback loop の本体班 ↔ organon 班 ↔ ドキュメント班 三班 ack chain 完結** (5/19、AI 班連絡 channel、平均 30-45 分 round-trip)
  - 本体班 → organon Day 3 完走 ack (msg `55075e75`、JST 14:38) — Pattern A reply
  - 本体班 → ドキュメント班 [#14](https://github.com/gamasenninn/tealus-docs/issues/14) 完走 ack (msg `e5f5ebd0`、JST 14:56) — Pattern B (full delegation) ack
  - 本体班 → organon Day 3 evening 5 大進展 ack (msg `6e865eff`、JST 17:01) — root-level framing 訂正受領
  - AI 班連絡 channel の coordination 密度の継続的 evidence、Phase 4 中盤の運用 maturity 言語化

- **organon v0.5 release — Day 2 trace + Q&A 7 batch 結果反映** (5/18、別 session、msg `87a878c9`、organon repo commit `7aef27c`)
  - Q&A 7 件結果: **6/7 が誤変換/幻覚/過去職位、正解 1 件のみ** = identity 軸 family が systematic pipeline failure として class 化
  - entries 12 → **20 active (67% 増)**: 新規 confirmed role 7 (神山 / 三瓶 / 舟太 / 草野部長 / 是枝 / 香山 / 齋藤) + 新規 confirmed organization 1 (44 = フォーティーフォー = 運送業者) + 既訂正 1 (桶田博信 + aliases [桶田専務, 専務] + stale roster note)
  - identity 軸 family 8 → **11 軸**: `#9 whisper-prior-misinference-to-vendor` (アンプリ = 三瓶 + 安能石油 namespace 誤推論) / `#10 auto-minutes-stt-error` (中田 = 舟太、二次 source = automated meeting minutes family の first 例) / `#11 stale-role-designation-in-roster` (桶田専務 = 17 日間 stale designation)
  - hallucination 軸 (#5) で 2 例目 = 再現性確立 (みこがい農場の高山)、**organon が育つほど LLM の adversarial hallucination も高度化** 新仮説
  - schema v0.5: **organization kind 正式追加** (6 種類目 entry kind)、必須 field `vendor_class` + `not_in`
  - cover rate: 4.55% → 27.3% → **57% (倍以上)** = Phase A 拡張優先度の物的根拠 + 実装到達点

- **organon repo で第 6 feedback layer = upstream pipeline rectification を正典化** (5/18、organon repo `hazard-log/meta/upstream-pipeline-rectification-as-sixth-feedback-layer.md`)
  - 第 5 layer (内部 pragmatic 閉じ) の **延長 + 補完戦略** として位置付け、外向き因果 loop で organic ontology が形式論理の自己言及問題 + Lakatos theory-ladenness 問題を **「内部 pragmatic 閉じ + 外部因果 loop 開き」の二段戦略** で解消する thesis 確立
  - organon CLAUDE.md の hazard 軸 table に **12 軸目** として正式 entry

- **第 1 例 feedback loop closure: organon hazard 発見 → 本体 STT pipeline 反映 → Day 3 朝礼で量的訂正効果測定 protocol** (5/18、本体班 ↔ organon 班 **23 分 round-trip** で完結、AI 班連絡 channel)
  - 本体 `server/config/transcription_guideline.json` (gitignored、per-deployment private) の vocabulary 38 → 42 entries 追加 (神山 = 上山誤変換 / 三瓶 = アンプリ誤変換 / 舟太 = 中田くん誤変換 / 山崎整備長 = クラッチー 合成全体誤変換)、tealus 本体 server restart 後 effective
  - Day 3 朝礼 STT 出力で 4 件揺らぎ件数を Day 1〜2 と比較、量的訂正効果を organon Day 3 trace で measurement → v0.6 schema 設計 + 本体 linter MVP 着手の dep 解除 trigger とする protocol を organon side で commit
  - distributed AI lane coordination (organon ↔ 本体 班、user 介在ゼロ closure) が organic ontology の構造的必要条件であることが crystallize (Issue [#279](https://github.com/gamasenninn/tealus/issues/279) (b) 一般理論の経験的根拠)

### Added

- **server: ゲストユーザ role 拡張 Phase 1 MVP (= schema + permission helper + route guards 3 層完成)** ([#282](https://github.com/gamasenninn/tealus/issues/282)、5/19、Issue 起票 → TDD 実装 → production deploy までを **1 day で完走**、3 commits: `b986bad` / `956fc9e` / `a7a102a`)
  - **Phase A** — migration 022_user_role_guest.sql (commit `b986bad`): `users.role` CHECK constraint を `('admin', 'user')` → `('admin', 'user', 'guest')` に拡張、既存 user data 影響なし (= role 値はそのまま保持、default 'user' 維持)、breaking change なし。Tests +6 (migration 安全性 / 後方互換 / 不正 role reject / UPDATE 柔軟性)
  - **Phase B** — `server/src/utils/permissions.js` 新規 (commit `956fc9e`): ROLES constant + `isAdmin/isUser/isGuest` role-class check + `canCreateRoom/canInviteToRoom/canSearchUsers` ability check + null-safe `getRole` helper。既存 admin チェック 5 箇所 (middleware/auth.js + socket/index.js + routes/stamps.js × 4 箇所) を helper 関数経由に統一。Tests +16 (freeze / null-safe / 対称性 / guest 制限)
  - **Phase C** — route-level access control (commit `a7a102a`): POST /api/rooms + POST /api/rooms/direct に `canCreateRoom` guard、GET /api/users + GET /api/users/online に `canSearchUsers` guard、guest → 403。Tests +11 (guest 4 endpoint 403 + admin/user 既存挙動 + guest 自分情報取得可)
  - 累計 **+33 test cases / 全 38 suite / 414 tests pass、regression ゼロ**、production deploy 完了 (migration 022 適用 + 本体 server restart、user 実施)
  - **3 層構造の正典化**: Layer 1 schema (`users.role IN ('admin','user','guest')`) / Layer 2 logic (`isAdmin/isUser/isGuest` + ability) / Layer 3 route (guard) = Tealus 根幹原則 (= [#124](https://github.com/gamasenninn/tealus/issues/124) 4/15 comment「AI と人間を区別する仕組みが最小限」) を外部 user にも適用
  - **#124 ゲストルーム構想からの pivot**: 5/19 [#124 pivot 提案 comment](https://github.com/gamasenninn/tealus/issues/124#issuecomment-4485524063) → 独立 Issue 起票 → 同日実装、旧 #124 案 (Web ウィジェット → ゲストルーム → AI 一次対応 一括) の **5 設計課題のうち 3 件が user 機構で吸収、2 件 (widget / 専用 security 設計) が後段 phase 降下**
  - **Phase 5 narrative core 候補**: 採用者 #2 voice trigger 解除 candidate (= 「外部問い合わせ機能?」と聞かれた瞬間に Phase 1 MVP が dep ゼロで提示可能)、AI = 同僚思想の外部 user 拡張、multi-agent dock vision ([#275](https://github.com/gamasenninn/tealus/issues/275)) との同心円
  - Phase D (UI 制限) + Phase E (Admin tooling) は organon cycle 完了後の本体 linter MVP ([#280](https://github.com/gamasenninn/tealus/issues/280)) 着手と同期 path

- **client: チャット画面の RoomSettings に「エージェント設定」section 追加** ([#156](https://github.com/gamasenninn/tealus/issues/156) Phase 1、5/15、commit `6ac122f`)
  - チャットルームの「ルームメニュー → 設定」から応答モード (auto / all / mention / off) と Light Agent / Deep Agent prompt を変更可能に (既存 agent-server endpoint を使用、API 変更なし)
  - 権限: DM = ユーザー自身、グループ = ルーム admin (isAdmin)、sysAdmin はダッシュボード経由 (admin オーバーライド) で従来通り
  - TDD: `RoomSettings.test.jsx` 新規 8 ケース、client test 7 → 15 件 (regression なし)
  - Out of Scope: TTS 音声モデル設定 (settings.json の保存場所未確定、別 commit でフォロー)

- **client: メッセージ表示で段落内改行 `\n` を `<br>` として render** (`remark-breaks` plugin 追加、5/14 業務メモ小野さん voice 起点、[#273](https://github.com/gamasenninn/tealus/issues/273)、commit `bdf3ccc`)
  - 現状の `remark-gfm` のみだと CommonMark 仕様で段落内 `\n` が soft wrap で消える → user が打った改行が表示されない苦情
  - `MessageBubble.jsx` + `HomePage.jsx` の `remarkPlugins` に追加、コードブロック / MD 強調 / table / list は完全 unchanged、copy → paste roundtrip でも改行保持 (lossless)
  - dogfood 6 項目完走 (新規送信 / regression / コードブロック / copy-paste / iPhone Safari / perf 体感差なし)
  - 5/14 cycle 最短例: 社内 user voice (02:24) → 同日 commit `bdf3ccc` (organic ontology 1 営業日 cycle)

- **agent-server + server: agent prompt に `reply_to` / `reply_to_message` を伝達する構造修正** ([#274](https://github.com/gamasenninn/tealus/issues/274)、5/14 朝礼ルーム TODO 抽出 dogfood で surface、commit `28698bb` + `c8f044b`)
  - **L1 (server)** `socket/handlers/message.js` + `routes/voice.js` + `routes/bot.js` の webhook payload に `reply_to` + `reply_to_message` を追加 (既存 `fetchReplyMessage` 流用、voice transcription fallback 込み)
  - **L2 (agent-server)** `dispatcher.js` に `buildReplyToHint(message)` helper 追加 (2-mode: content embed / id-only fallback)、light/light2/deep の 3 path で共通利用、TDD で B1-B7 の 7 ケース追加 (既存 250 + 新 7 = 257 全 pass)
  - **L3 (room config)** 朝礼 room の `light_prompt.md` (tealus-workspaces 配下、repo 外) で TODO 抽出 protocol を per-room tuning
  - LLM in-context echo trap への counter pattern として content embed mode が決定的 (id-only では chat history pattern に LLM が押される、memory `feedback_llm_in_context_echo_trap.md` 参照)
  - Dogfood verify: prompt 270 → 1483 chars (議事録本文 embed)、5/14 議事録 9 section 100% 反映、5/12 議事録 items 0 件混入なし

- **server: transcription_guideline の example に「数字+の+数字」hyphen 復元 rule を任意 guidelines として追加 (漢数字対応含む)** (5/13 dogfood、業務無線運用向け template として example に反映)
  - 5/12 dogfood で「19452-1」が「19452の1」と転写される pattern を観察 → rule 9 で半角数字 + の → - 復元、5/13 追加で **漢数字 (一九三五の一 等) も digit-by-digit で半角数字に正規化 + ハイフン復元** まで rule 9 拡張
  - 検証: 4-digit (一九三五の一→1935-1) / 5-digit (一九三五一の一→19351-1) の両 case で formatted_text が期待通り
  - 例外: 「ファーム」「番目」「位」「倍数」等、本来「の」を必要とする語が前後にある場合は保持 (「三の倍数」「一の位」等)
  - example file の guidelines は skeleton 用途のため compact 表現で記述、operational 版 (gitignored) では full の rule 9 として展開

### Fixed

- **client: iOS PWA input focus 時の auto-zoom 防止** (mobile で input/textarea/select の font-size を 16px 強制、commit `4d00839`、5/13 iPhone dogfood 起点)
  - iOS Safari の auto-zoom 挙動 (font-size < 16px の input にフォーカスすると画面拡大 + blur 後の layout 崩れ) を採用検討者の iPhone dogfood で観察 → 翌日 fix
  - memory `feedback_ios_input_autozoom_16px.md` (5/13) に design guideline として記録

### Changed

- **client: RoomSettings 内の section 順序を「個人 → ルーム (admin) → システム (sysAdmin) → エージェント」に変更** (#156 follow-up、5/15 founder voice、commit `b3f4ec9`)
  - エージェント設定は重要度高だが触る頻度低い特殊な設定 (prompt / 応答モード)、誤操作 risk 低減のため最下部に配置
  - UX 原則「上 = 頻繁 / 下 = 稀」と整合、論理階層軸では isAdmin と同レベルだが「触る人を絞りたい」性質を強調

- **client: MemberList のメンバー操作 button をメンバー一覧直下に移動** (5/15 dogfood UX cascade、commit `1f849f4`)
  - 「+メンバーを追加」「このグループを退会」が RoomSettings 群の下にあるのは Gestalt 近接の原則に反し scan path も分断、メンバー一覧の直後に移動して「メンバー operation cluster」として明示
  - エージェント設定 section 追加 (#156) で UX 全体が見えるようになり連鎖的に気付いた改善 (organic ontology の implementation arc 内 cascade 例)

- **docs: README opening narrative refresh + ロードマップ v0.2.x 反映** ([#209](https://github.com/gamasenninn/tealus/issues/209) sub-2、commit `a9a3444`)
  - tagline: 「AI が声で答える」→ 「AI が組織の記憶を声で運ぶ」(組織記憶軸追加)
  - intro paragraph: dual identity (LINE 風 UI + organic 組織記憶基盤) + cross-modality dividend echo、`philosophy.md` / `elevator-pitches.md` / `walkthrough-script-v1.md` への surface link 追加
  - ロードマップ: v0.1.x 消化済 strikethrough (#185 / #164 / #187)、v0.2.x ハイライト + v0.3.x 候補に restructure、Phase 4 物語化 section 新設

- **docs(presentation): `philosophy.md` v2 — organic ontology section 新設** (#209 sub-1.1、commit `4c81236`)
  - 5/11 user 言語化 (organic ontology) を 4 柱の手前に layer として配置
  - artificial / organic ontology 対比 + 5 必要条件 + 4 柱との対応 + 新機能設計判断時の評価軸 + 5/11-5/14 dogfood の cycle 検証 4 例
  - 柱 3 に「使うほど自分自身に追いついていく」副題 + cross-modality dividend bullet 追加

- **docs(presentation): `elevator-pitches.md` v2 — 推奨案 E に 3 軸追記** (#209 sub-1.2、commit `a3490bc`)
  - 5/11-5/14 dogfood で言語化された 3 軸 (業務 DB / cross-modality dividend / 採用者 voice → 機能進化 cycle) を slide 2 / FAQ 用 2nd layer 素材として確立
  - 4 行拡張 brushup 候補 + audience 別開示深度の対応表 (OSS 採用者 3 行 / CTO 4 行 / 思想共感者 / 現場別 framing)

### Docs

- **docs(presentation): `walkthrough-script-v1.md` 追加** (#209 sub-5、commit `cb105bd`)
  - 5/7-5/14 dogfood log を物語化した 6-7 分 walkthrough script v1 draft
  - 5 act 構成 (Act 1 vocab inject / Act 2 社内 DB MCP / Act 3 video transcription / Act 4 iPhone fix / Act 5 1 週間 4 commit 総括)
  - 新語の言語化: `cross-modality dividend` / `organic ontology` / 「使うほど自分自身に追いついていく」

- **docs(guide): 通知設定とトラブルシューティング新規作成** ([#168](https://github.com/gamasenninn/tealus/issues/168) Phase 1 sub-task、commit `497b5fb`)
  - `docs/guide/settings/notification.md` 新規、将来の user guide tree (`docs/guide/`) 起点
  - 5 section 構成 (PWA install / 通知許可 / バッテリー最適化 / 二経路 defense in depth 仕組み / 既知制限)

### Test

- **test(client): markdown plugins behavior + remark-breaks regression guard** (#273 follow-up、commit `e0d3977`)
  - `client/__tests__/components/markdown-plugins.test.jsx` 新規、6 ケース
  - 段落内 `\n` → `<br>` regression guard、コードブロック / MD 強調 / リスト / GFM table の共存挙動を検証
  - client test 1 → 7 件、TDD pattern reference として確立

## [0.2.4] - 2026-05-12

### Added

- **client + server: PWA App Badge (ホーム画面アイコン未読数バッジ) — テスター要望、Badging API + 二経路 defense in depth** (5/12 spike → 本実装 1 セッション完走、commit `6319cdd`)
  - 「スマホホーム画面アイコンに未読を知らせる印 (数字バッジ) がほしい」テスター要望から spike 着手
  - 二経路 (foreground Socket.IO + background Web Push) で defense in depth、片方の path が落ちても他方で補完
  - **foreground path**: `client/src/services/appBadge.js` 新規、`navigator.setAppBadge()` ラッパー (feature detection 付き silent fail)、`roomStore.fetchRooms` 後に `syncBadgeFromRooms` で auto sync、mark-read 後も `fetchRooms` 再走で即更新
  - **background path**: `server/src/services/push.js` の `sendPushToUser` に `calculateTotalUnreadForUser` 追加、push payload に `total_unread` 含める。`client/public/custom-sw.js` push event handler で `self.navigator.setAppBadge(total_unread)` / `clearAppBadge()`
  - **platform 動作確認 (5/12 dogfood)**:
    - Android Chrome PWA: ドット表示 ✓ (Android 仕様で数字未対応)
    - iOS Safari PWA 16.4+ (鈴木花子 user で verify): **数字バッジ** ✓
    - Firefox: silent fail (未対応、設計通り)
  - 残課題: push event 経由 path の dogfood 完了確認 + multi-device 同 user 同期挙動観察 (future cycle)

- **server: voice transcription の 3 段 dormant bug fix (Whisper prompt hallucination 検出 / 短文 formatting skip / メタ literal 防御)** ([#269](https://github.com/gamasenninn/tealus/issues/269) Phase 2 follow-up、5/12 user dogfood で surface)
  - 5/12 user 観察: トランシーバー履歴の voice の一部が「空文字」「空文字列」literal で transcription される / 完全に空になる現象
  - 真因 (3 段の cascade):
    - **Bug 1**: Whisper API が無音 / ノイズ / 短すぎる音声に対して **prompt の文字列をそのまま echo** して返す既知挙動 (vocab inject で prompt が太くなり leak surface)。例: raw_text が `これは農機販売店の業務無線の音声記録です。` (whisper_context そのもの) になる
    - **Bug 2**: AI 整形 (gpt-4o-mini) が **短い raw_text** ("松さん、松です。" "はい、了解です。" 等 < 10 chars) を「意味なし」と判断して空文字を返す
    - **Bug 3**: AI 整形が「空文字」「空文字列」「(空)」「無音」等の **Japanese meta literal を律儀に返す** (system prompt の「整形のみ」指示の意図と外れた挙動)
  - 修正 (3 軸 + defense in depth):
    - **Bug 1 fix**: `transcriptionConfig.js` に `isWhisperPromptHallucination(rawText, prompt)` 追加、`transcription.js` で Whisper 出力直後に検出して effective rawText を空に set
    - **Bug 2 fix**: `transcription.js` で raw_text 長さ < 10 chars なら AI 整形 skip、raw_text をそのまま formatted_text に採用
    - **Bug 3 fix (定義防御)**: `formatting.js` の system prompt に「**空文字、「空文字」「空文字列」「(空)」「内容なし」「無音」「empty」「null」「none」等のメタ表現を返してはならない**」を明示
    - **Bug 3 fix (post-process 防御)**: `isMetaEmptyLiteral()` で META_EMPTY_LITERALS list に該当する応答を catch、raw_text に fallback
    - 完全空文字応答も raw_text に content があれば fallback
  - tests: `transcriptionConfig.test.js` に `isWhisperPromptHallucination` 8 ケース + `isMetaEmptyLiteral` 4 ケース = +12 件、計 36 件 pass
  - regression: voice/transcription/bot-transcribe/formatting 全 65 件 pass

- **server: voice transcription default を gpt-4o-mini-transcribe + 新世代 transcribe 兄弟 2 model に vocab inject 拡張** ([#269](https://github.com/gamasenninn/tealus/issues/269) Phase 2 完走、5/12 dogfood 確定)
  - 5/12 dogfood で 6 test 文すべて完璧 (グレンコンテナ / マニアスプレッダ / ハーベスタ / みこがい / ガマ / たけのこ 等の業界用語 + 短人名すべて正確認識、control 文も clean、副作用なし)
  - `WHISPER_MODEL` default: `gpt-4o-transcribe` → **`gpt-4o-mini-transcribe`** に切替 (採用者が `.env` 未設定でも最初から vocab inject 効果 + cost ~半分)
  - `WHISPER_VOCAB_INJECT_MODELS` default: `gpt-4o-mini-transcribe` → **`gpt-4o-mini-transcribe,gpt-4o-transcribe`** (新世代兄弟 2 model)
  - whisper-1 は **default で除外維持** (legacy で bias 観測 history あり、新規採用非推奨)
  - 議事録 use case で vocab inject を opt-out したい採用者は env で revert 可能 (`WHISPER_VOCAB_INJECT_MODELS=gpt-4o-mini-transcribe` で gpt-4o-transcribe を除外)
  - test 更新 (`gpt-4o-transcribe` default で vocab inject 含む assertion)、計 24 件 pass

- **server: model-aware Whisper prompt 上限拡張 + 切り捨て方向 fix** ([#269](https://github.com/gamasenninn/tealus/issues/269) Phase 2 follow-up)
  - 5/12 user dogfood で判明: 旧実装の `MAX_CHARS=200` は **whisper-1 由来の保守値** (legacy 仕様は 224 token = ~200 char)。新世代 `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` は **16,000 token 上限** で 74 倍の余裕あり ([OpenAI 公式](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe))
  - model-aware truncation に変更: whisper-1 / unknown は 200 char (legacy 互換)、新世代 transcribe は **2,000 char** (16,000 token の 1/8、安全側)
  - 切り捨て方向: `slice(-N)` (末尾保持) → `slice(0, N)` (先頭保持) に変更。旧実装では whisper_context 冒頭 (例: 「これは農機販売店...」) が削れて vocab 末尾が残る非対称な truncation だった。新実装は whisper_context が先頭で安定、vocab list が末尾切れに
  - 実 verify: 37 entries の現 vocabulary で `これは農機販売店の業務無線の音声記録です。 用語: ガマ、みこがい、...、ビレッジ側` が **205 chars で全部入る** (旧 200 char 上限では冒頭「これは農機」が削れていた)
  - tests: +5 (legacy 200 / 新世代 2000 / slice(0,N) 動作 / 全 37 entry 収納)、計 24 件 pass

- **server: voice transcription で model-aware vocabulary inject 機能 — gpt-4o-mini-transcribe で業務用語認識を改善** ([#269](https://github.com/gamasenninn/tealus/issues/269) Phase 2 実装)
  - 5/9 別 session の STT 検証で `gpt-4o-mini-transcribe + 辞書 prompt` が業務無線音声で固有名詞認識を明らかに改善する finding が surface (元結果: 「冷蔵庫」→「冷蔵コンテナ」、「業務連絡です」が拾える等)
  - 旧コード (`transcriptionConfig.js`) は **vocabulary を Whisper prompt に渡さない方針** だった — whisper-1 / gpt-4o-transcribe で bias 観測 (「ビレッジ側」→「ビレッジガン」) を根拠に。今回 model 依存の挙動が判明したため model-aware に拡張
  - `buildWhisperPrompt(config, model)` の signature 拡張、`model` が `WHISPER_VOCAB_INJECT_MODELS` env (default: `gpt-4o-mini-transcribe`) に該当する時のみ vocabulary を `用語: ...` 形式で whisper_context に追加
  - default 動作 (gpt-4o-transcribe + no vocab inject) は **無変更**、議事録 use case を保護
  - 使い方: `WHISPER_MODEL=gpt-4o-mini-transcribe` に切替 + server 再起動で自動的に vocab inject 有効
  - tests: `transcriptionConfig.test.js` に 7 ケース追加 (各 model × vocab あり/無し + env override + truncate)、計 20 件 pass
  - 副次効果: 5/12 の `transcribe_media` 機能でも、`WHISPER_MODEL=gpt-4o-mini-transcribe` 切替で動画 transcription にも vocab inject が自動適用される (server-side で同 pipeline 共有)

- **server: `POST /api/bot/messages/:id/transcribe` 新 endpoint + agent-server tealus-mcp pin v0.13.0 へ更新 — 動画/音声 文字起こし機能** ([#271](https://github.com/gamasenninn/tealus/issues/271) follow-up、案 B 実装)
  - 5/12 朝に user 業務メモで動画投稿 → 文字起こし依頼 → `get_message_media` の 10MB 上限で fail → 構造解として server-side endpoint + thin MCP wrapper パターン
  - server: 既存 voice STT pipeline (`transcription.js` の `transcribeVoiceMessage`) を `transcribeMessage` に generalize、video 入力時に ffmpeg `-vn` で audio 抽出 (16kHz mono opus 24kbps、Whisper API 25MB 上限内)
  - server: 新 endpoint `POST /api/bot/messages/:id/transcribe` で cached (cached:true) / fresh transcribe + format 同期実行、JSON 返却。Bot JWT auth + room member check 必須
  - server: voice の既存 transcription pipeline は無変更、video 用の path のみ追加 (regression なし、既存 92 voice/transcription test pass)
  - server: 新 test `__tests__/integration/bot-transcribe.test.js` 10 件 pass (cached / version / type / 404 / 410 / 403 / 401 / video cached)
  - agent-server: tealus-mcp pin v0.11.1 → v0.13.0 (Light v1 / Light v2 / Deep の全 agent path)、新 `transcribe_media` tool が registered tools 一覧に追加
  - tealus-mcp v0.13.0: `transcribe_media` MCP tool 新設、本 endpoint への thin wrapper
  - **設計判断**: 元の Deep 提案は tealus-mcp に ffmpeg + OpenAI を抱える想定だったが、tealus 本体側に完成された STT pipeline (gpt-4o-transcribe + transcription_guideline.json) があったため、tealus-mcp は依存追加 0 で済む server-side endpoint パターンに pivot
  - **波及**: 業務無線辞書 (vocabulary) を voice / video で共有、AI agent が voice / video / DB / 会話を統一 text context として扱える状態に到達 (organic ontology の modality 拡張)

- **server: tealus-mcp HTTP transport 用の `/mcp` proxy 追加 — cross-machine 構成への構造解** ([#264](https://github.com/gamasenninn/tealus/issues/264) Phase 1 alpha)
  - tealus 本体 server (port 3000) が `/mcp/*` を内部 port 3200 に転送する `createProxyMiddleware` を追加 (`/agent-api` `/rtc` と同 pattern、`express.json()` の前に配置で body parse 不要)
  - SPA fallback exclusion list に `/mcp/` 追加 (router が SPA fallback で index.html を返す trap 防止)
  - `client/vite.config.js` の `navigateFallbackDenylist` + `proxy` block にも `/mcp` 追加 (#257 同型 dev mode trap 防止)
  - `server/.env.example` に `MCP_HTTP_PORT=3200` (default、env で override 可) 追加、`JWT_SECRET` の comment に「agent-server / tealus-mcp と完全同値要件」を明記
  - 認証は **proxy で pass-through**、tealus-mcp 側で fail-fast 401 (JWT_SECRET 共有検証)
  - tealus-mcp v0.12.0 → v0.12.3 と組で機能、stdio path は default 維持で既存採用者環境は無変更

- **docs: `setup-cc-tealus-bridge.md` ステップ 5A 追加 — HTTP transport 採用者向け walkthrough** ([#264](https://github.com/gamasenninn/tealus/issues/264) Phase 1 alpha)
  - 構成図 (Claude Code → Tealus host /mcp proxy → tealus-mcp HTTP)、5A-1〜5A-5 で段階的に setup
  - `.env` 集約 (tealus-mcp v0.12.1 の dotenv 経由)、30 日 expiry JWT 発行、`~/.claude.json` の url-based MCP entry 追加
  - 採用者第 2 号以降の cross-machine onboarding 経路として活用予定、stdio (zero-config) → HTTP (cross-machine 用) の 2 段階案内 layer 完成

- **docs: `setup-ai-agent.md` に Light v2 + LIGHTV2_AUTH subscription path 反映 (#258 採用者保護)** ([#268](https://github.com/gamasenninn/tealus/issues/268))
  - ステップ 9 (新規): Light v2 を使う、選び分け表、cost 比較、subscription path、内蔵 MCP tool (generate_and_send_image / send_text_as_file)、E2E harness 案内
  - ステップ 7-1: `/light` `/light2` `/deep` prefix 明示の使い分け callout
  - トラブルシュート: `/light2` 系 Q × 2 追加 (no final agent message / 画像が来ない)
  - 採用者第 2 号 onboarding に直結する Light v2 動線を整備、subscription path で API cost 0 + Fast Mode access の選択肢を明示

- **agent-server: Light v2 で `light_prompt.md` (ルーム固有 Light プロンプト) を読み込むよう parity 追加** ([#258](https://github.com/gamasenninn/tealus/issues/258) follow-up)
  - 5/11 社内 DB 検索ルームの dogfood で判明: Light v1 (`light.js`) は room workspace の `light_prompt.md` を呼び出し毎に読むが、Light v2 (`lightV2.js`) は読まない仕様だった。`/light2` だけ system prompt が thin になる v1/v2 非対称
  - `lightV2.js:193` 直後に `light_prompt.md` reader block を追加 (Light v1 と完全同 logic、`## ルーム固有の指示\n${roomPrompt}` で append)
  - dogfood verify: `/light2` 経由で Q5 (社長 handoff 確認質問) が `light_prompt.md` Section 3 の strict 化 を正しく遵守 (確認質問付き response、5/11 19:19 ログ)
  - 副次効果: per-room MCP + per-room prompt の組み合わせで Light v2 でも query 精度を 1 室単位で tune できるようになった (社内 DB ルーム 6/6 stress test 完勝)

### Fixed

- **agent-server: Deep agent timeout 後に同 room の以後の質問が受け付けられなくなる構造 bug を fix — #252 と同型 sweep を timeout path に適用 + Promise safety net** ([#250](https://github.com/gamasenninn/tealus/issues/250)-[#252](https://github.com/gamasenninn/tealus/issues/252) follow-up、Step 27 同日 follow-up)
  - 5/11 01:33 user 報告「アシスタントとのやり取りなんだが 一度 タイムアウトをしてしまうと次の質問が受け付けなくなってしまう」
  - log 解析で真因 3 層特定:
    - 層 1: `deep.js:121-132` の timeout timer callback が `proc.kill` + `taskkill /T /F` のみ、**cancel path で #252 が導入した `deepRegistry.sweepByWorkspacePath()` を呼んでいない**
    - 層 2: cmd.exe → claude.cmd → claude.exe tree で race により claude.exe が orphan 化、cmd.exe も exit せず → `proc.on('close')` が永久 fire しない
    - 層 3: `processDeep` の Promise resolve が `proc.on('close')` 一本足 → Promise 永久 pending → `dispatcher.js` `enqueueForRoom` の room queue が dead lock → 以後同 room の message dispatch 不可
  - **修正 (A)**: `deep.js` timer callback で `deepRegistry.sweepByWorkspacePath(workspacePath, roomId)` を呼ぶ (cancel path と同型)、`deepRegistry` の `module.exports` に `sweepByWorkspacePath` を追加して公開 API 化
  - **修正 (B)**: timer callback の最後に safety net `setTimeout(..., 10000)` を追加。10s 後に proc が依然生きていれば `proc._tealusSafetyNetFired = true` flag → `deepRegistry.unregister(roomId)` → `resolve()` で room queue を強制解放。`proc.on('close')` 冒頭に同 flag の early return guard を追加して二重投下防止
  - **過去 fix との関係**: #250 (cancel button) / #251 (redundant timeout message) / #252 (cancel path orphan kill) は完了済、本件は **#252 の盲点** = timeout path に sweep が未適用だった事の構造 fix。CHANGELOG #252 entry に timeout path 言及なし → 意図的除外ではなく単なる見落とし
  - **Out of scope**: `enqueueForRoom` 全体の outer timeout (Light v1/v2 同型 risk 含む) は別 issue で議論先行 ([#264](https://github.com/gamasenninn/tealus/issues/264) と同 pattern の spec freeze before code)
  - tests: `deepRegistry.test.js` 新規 (10 件、register/unregister/cancel/sweep の coverage)、`deep.test.js` の既存 timeout test 強化 (sweep 呼び出し verify) + safety net path 新規 test (jest fake timer で 10s safety net 発火と Promise resolve を verify)、agent-server **239 → 250 件 pass** (+11)、回帰なし

- **server: `/mcp` proxy pathRewrite で Express の prefix strip を re-add — Test 3 で `Cannot POST /` 404 になっていた問題の構造 fix** ([#264](https://github.com/gamasenninn/tealus/issues/264) Phase 1 alpha follow-up)
  - 5/10 手動テストで proxy 経由 POST `/mcp` が 404 で `Cannot POST /` を返していた
  - 原因: Express の `app.use('/mcp', middleware)` は req.url から `/mcp` prefix を strip してから middleware を呼ぶため、tealus-mcp 側 (`/mcp` で listen) に届いた時点で path mismatch
  - `/agent-api` / `/rtc` は target が root path で listen しているので strip 動作で正解だが、tealus-mcp は `/mcp` namespace に揃えているため逆方向の rewrite が必要
  - 修正: `pathRewrite: (path) => '/mcp' + path` で `/mcp` を再付与
  - tealus-mcp v0.12.2 (`/mcp/health` endpoint 追加) と組で機能

## [0.2.3] - 2026-05-10

Phase 4 中盤の累積を整理した release。Light v2 (codex SDK backed) の並列追加、tealus-mcp v0.10.0/v0.11.0/v0.11.1 連携、PC 2-pane layout、Deep cancel path、E2E verification harness + LLM-as-judge layer、cc-aliases.json による `@Claude` alias 化、複数の採用者保護 trap 解消 (Vite proxy、Router `max_completion_tokens`、tealus-mcp env 名、test pollution 等) を含む。

### Added

- **server: STT model 比較検証 — トランシーバー用途で gpt-4o-mini-transcribe + 辞書 prompt が有望と判明** ([#269](https://github.com/gamasenninn/tealus/issues/269))
  - 5/9 別 session の検証で同一 test.wav に対して `gpt-4o-mini-transcribe` (no prompt) > `gpt-4o-transcribe` (現 default、文末欠落)、辞書 prompt 注入で更に improve
  - 構造的観察: `transcriptionConfig.js` の「vocabulary を whisper prompt に流さない」現方針は `whisper-1` / `gpt-4o-transcribe` には正しいが、`gpt-4o-mini-transcribe` では逆に improve する **model 依存** の挙動
  - `server/.env.example` の WHISPER_MODEL コメント更新 (議事録 vs トランシーバー の用途別 guidance)
  - `transcription_guideline.example.json` のコメントに finding 反映
  - Phase 2 (code 改修): `buildWhisperPrompt` の model-specific 化、room ごとの WHISPER_MODEL 切替、別 sample での再現性確認 — 別 issue 候補

- **agent-server: Light v2 機能 parity — tealus-mcp v0.11.0 で `send_text_as_file` + `generate_and_send_image` 追加、Light v1 の custom tool を MCP 化** ([#260](https://github.com/gamasenninn/tealus/issues/260))
  - [#258](https://github.com/gamasenninn/tealus/issues/258) D5 で TODO 化していた gap (画像生成 / file 投稿) を解消
  - tealus-mcp v0.11.0 release (`9c37810`、別 repo) — tools 13 → 15、tests 67 → 70
  - tealus 本体側で tealus-mcp の version pin (`github:gamasenninn/tealus-mcp#v0.11.0`、3 箇所)
  - Light v2 (codex SDK) で `/light2 子犬の画像を生成して` 動作 verify ✅、`generate_and_send_image` tool が DALL-E 3 → Tealus 投稿の composite 完結
  - **OPENAI_API_KEY 必須** (Light v2 が subscription mode でも image gen は API 経由、別 cost path)
  - default_system_prompt.md に `generate_and_send_image` / `send_text_as_file` の use case 明記 (「実際に tool を呼んで完結させる事」と指示、codex の「宣言だけで終わる」傾向への対処)

- **agent-server: E2E LLM-as-judge layer (Phase 2.b)** ([#262](https://github.com/gamasenninn/tealus/issues/262))
  - 観察層 (warn-only) として bot 応答を LLM (default `gpt-4o-mini`) に採点させ、決定論層では捉えられない semantic correctness を可視化
  - scenarios.json の各 scenario に optional な `llm_judge: { criteria, min_score }` field 追加、score < min_score → warn (fail にはしない、LLM 採点 variance 許容)
  - `agent-server/tools/e2e/judge.js` 新規 — fetch + OpenAI chat completions API、JSON mode (`response_format`)、env (`E2E_JUDGE_API_KEY` / `OPENAI_API_KEY` fallback、`E2E_JUDGE_MODEL` で model 切替)
  - run.js / report.js 統合: scenario あたり 1 judge call、report に score / threshold / reasoning 表示
  - S1 (cross-room tag組織) と S3 (PDF scan summary) に judge config 追加 — 元々 LLM variance prone な scenario
  - 9 件 unit test 追加 (mock fetch、env override、clamp、graceful error)、agent-server 全 239 件 pass

- **agent-server: Light agent E2E verification harness (Phase 1)** ([#262](https://github.com/gamasenninn/tealus/issues/262))
  - 「CI gate ではなく **調整 phase の verification run**」として設計
  - `agent-server/tools/e2e/`: `scenarios.json` + `run.js` + `report.js` + `setup.js`
  - 初期 6 scenario: cross-room tag整理 / mention strip / PDF scan / image gen / greeting / deep keyword
  - judgment は multi-criteria: 決定論層 (tool chain shape, log line) → fail / 観察層 (token, latency) → warn / 人 review 層 (manual_check)
  - test bot user (e2e-runner) + test room (e2e-sandbox) で本番 DB 隔離
  - 実機 path 全通す (CLI が Tealus API 経由で test room に投下)
  - 初回 run baseline: 4/6 PASS (S1 / S5 / S6 / S2 PASS、S3 / S4 は #260 #261 fix 前 baseline)、fix 後 S4 PASS verify 済
  - 副次効用: S1 で同 prompt の **quality variance** を可視化 (1 件 / 8+ 件 / 13 件)、LLM 系 E2E は決定論前提では機能しない事を実証

### Fixed

- **agent-server: Light v2 で `/light2` の応答が空になる「no final agent message captured」bug** ([#260](https://github.com/gamasenninn/tealus/issues/260) follow-up)
  - codex SDK は 1 turn で `agent_message` を複数回 emit (thinking aloud → final answer → empty marker `""`)
  - 旧 code (`lastAgentMessage = event.item.text`) は最後の空文字列で前の有用 text を上書き → user 応答 0 chars
  - subscription mode の v2 で 5/7 から頻発していた既知 issue の根本原因 (画像生成 fail / PDF wrong-document hallucination 等の真因)
  - 修正: 「最後の非空 agent_message を採用」(`if (text && text.trim()) lastAgentMessage = text`) で空 marker 弾く + thinking aloud は捨てる
  - commit `28d648f` (accumulate、UX bug あり) → `6f8ff1f` (最後の非空、正解) の 2 段階で着地
  - memory `feedback_codex_agent_message_pattern.md` 追加 (multi-emit pattern の実装指針)

- **agent-server: tealus-mcp child process に env が伝播せず GOOGLE_API_KEY / OPENAI_API_KEY が undefined になっていた** ([#260](https://github.com/gamasenninn/tealus/issues/260) follow-up)
  - codex SDK の `mcp_servers` config は `...process.env` 不継承、明示 env 指定が必須
  - Light v2 / Deep の tealus-mcp 起動時に `OPENAI_API_KEY` (image gen)、`GOOGLE_API_KEY` (vision fallback) 等が child に届かず無効化
  - **副次的に [#261](https://github.com/gamasenninn/tealus/issues/261) (vision fallback skip) も resolved** — read_document の library 失敗時に Gemini fallback が走らなかった真因 (logic は元から正しかった)
  - Light v1 (`roomMcpManager.js`) は `...process.env` で全 env 継承していたため影響なし、本 bug は v2 限定
  - 5/8 dogfood で同 PDF を /light2 に投げると本文を正確に抽出 + 537 chars 要約成功 verified
  - memory `feedback_lightv2_pdf_limitation.md` を 5/8 大幅見直し (5/7「PDF 読めない」認識は真因取り違いと訂正)

- **agent-server: router の mention 後 prefix 検出 (group room の `@bot /light2 ...` が v1 落ちする bug)** ([#258](https://github.com/gamasenninn/tealus/issues/258) follow-up、commit `49ea6e1`)
  - group room で `@アシスタント /light2 ...` と書くと router の prefix 検出が content 先頭 startsWith しか見ていないため失敗、LLM 振り分けに fallback して v1 に流れていた (DM では mention 不要なので問題なし)
  - 5/7 #258 dogfood (出品業務 group room) で発覚、test coverage に group room mention pattern が無かった事が surface
  - 修正: `stripLeadingMentions` helper 追加、classifyByRules / route 両方で先頭 mention strip
  - 副次的に mention 付き挨拶 / DEEP_KEYWORD / LLM 振り分けも改善
  - 12 件 test 追加 (mention strip 単体 4 件 + multi-pattern verify 8 件)、194 件 pass

- **agent-server: Light v2 専用 `LIGHTV2_AUTH` env で subscription path を提供 (採用者 dogfood で API cost 0 化)** ([#258](https://github.com/gamasenninn/tealus/issues/258) follow-up、commit `523d034`)
  - dogfood / dev で v2 を gun gun 回したい時、`OPENAI_API_KEY` を unset すると Light v1 / Router まで死ぬので Light v2 専用 env で切替
  - `LIGHTV2_AUTH=subscription` 設定時、`apiKey` を渡さず `~/.codex/auth.json` (codex login 済) で auth
  - ChatGPT Plus/Pro/Team 持ちの採用者は API cost 0、Fast Mode access 可
  - Light v1 / Router は OPENAI_API_KEY を使い続ける、無影響

- **client: Portal 機能 — iframe load 失敗時の通知 UX (X-Frame-Options で blank になるケースの動線確保)** ([#259](https://github.com/gamasenninn/tealus/issues/259))
  - ベータテスター 藤井さん の Portal 登録 dogfood 中、X-Frame-Options で iframe が空表示になる「ダンマリ」現象を 小野哲 経由で報告
  - X-Frame-Options block 時は load event がまだ発火するため timeout-based 検出だけでは不完全、**常時表示の「↗ 新タブで開く」 escape link** を確実な動線として用意
  - 追加: load 中 spinner overlay (onLoad で消える) / 5 秒 timeout overlay (「埋め込み許可してない可能性」+ 新タブ button + dismiss)
  - active tab 再 tap reload 時も watch を再起動

- **agent-server: test pollution 防止 — 本番 config file を test が上書きしない構造に** ([#235](https://github.com/gamasenninn/tealus/issues/235))
  - [#231](https://github.com/gamasenninn/tealus/issues/231) で「admin UI 上書き耐性」として F1+F2 を実装したが、5/4 朝の調査で **真因は admin UI ではなく test pollution** と判明 (user 指摘「admin UI 開いた覚えない」)
  - `__tests__/integration/settingsManager.test.js:105` が `manager.saveSettings({ count: 0, enabled: false })` で本番 `agent-server/config/settings.json` を直接上書き
  - `__tests__/integration/settings-api.test.js:122` が PUT `/config/system-prompt` で本番 `agent-server/config/system_prompt.md` に「カスタムプロンプト」27 bytes を書き込み
  - **修正**: production code に `AGENT_CONFIG_DIR` / `AGENT_MCP_CONFIG_PATH` env override を追加 (`settingsManager.js`, `routes/settings.js`, `light.js`)、test 内で env を tmpDir に向けて隔離
  - production cleanup: `agent-server/config/settings.json` を `{}` に、`config/system_prompt.md` 削除 (両方 test 由来の garbage)
  - 過去 [#107](https://github.com/gamasenninn/tealus/issues/107) commit で test garbage が誤 commit されていた長期残留問題も同時解消
  - 全 177 件 pass、回帰なし
  - memory `feedback_test_file_guard.md` 追加 ([feedback_test_db_guard.md](https://github.com/gamasenninn/tealus/blob/main/CLAUDE.md) の file 版、同型 pattern)
  - [#231](https://github.com/gamasenninn/tealus/issues/231) F1+F2 (`LIGHT_MAX_TURNS` env default + system_prompt placeholder fallback) は本問題の **真因解決** でもあり、副次的に admin UI からの誤上書きへの保護としても有効。本 issue で F1+F2 の表現を「admin UI 上書き耐性」→「test pollution 耐性 (副次的に admin UI 誤上書きも防護)」に訂正

- **rtc-server: bundle.js auto-build + 起動時 sanity check (採用者保護)** ([#234](https://github.com/gamasenninn/tealus/issues/234))
  - `rtc-server/public/bundle.js` (esbuild の output) は `.gitignore` で除外される build artifact、最後の `npm run build` 以降に消えると通話 popup が「未接続」のまま固まる
  - 5/3 14:45 藤井さんの本機 test、5/4 14:57 user 環境再現で観測 (信号 (call:start) は届くが popup 内で mediasoup-client が load されない)
  - **Defense layer 1**: `package.json` に `postinstall: "npm run build"` 追加 — 採用者が `npm install` した瞬間に bundle.js が auto 生成
  - **Defense layer 2**: `server.js` 起動時に `public/bundle.js` 存在 check、不在時 loud warn (`npm run build` を提案)。signaling は問題ないので fail-fast にせず継続起動
  - rtc-server v0.1.0 → v0.1.1 (patch、bug fix)
  - 業務メモ B 「rtc で何かのデグレード起こってるかも」(5/3 18:59) の調査で発覚した構造的問題

### Fixed

- **server: /system (trailing slash なし) で dashboard が開かず client へ redirect** ([#247](https://github.com/gamasenninn/tealus/issues/247))
  - `app.get('/system/*', ...)` は wildcard 必須で `/system` 単独に match せず、SPA fallback で client index.html が返り `<Route path="*">` で `/` リダイレクトしていた
  - Fix: route pattern 配列に `/system` を追加 (`app.get(['/system', '/system/*'], ...)`)
  - [#241](https://github.com/gamasenninn/tealus/issues/241) PC profile scroll fix で管理画面リンク到達可能になり露呈、長期残留 bug

- **client: file 添付の DL filename が cryptic basename になる ([#244](https://github.com/gamasenninn/tealus/issues/244) follow-up)** ([#246](https://github.com/gamasenninn/tealus/issues/246))
  - 旧 `<a target="_blank" onClick={() => window.open()}>` で `download` attribute 未指定、browser の save default で URL basename (`1777953339385-a1fc4098ea931352.md`) として保存されていた
  - UI 表示は `file_name` (原本名 `meishi_ono_analysis.md`) で正しいが、実 DL 時に物理 path 採用 = UX bug
  - Fix: `<a download={m.file_name}>` 追加 + `target="_blank"` / `window.open()` 削除 (`<a download>` の native 挙動を効かせる)、`stopPropagation` のみ keep
  - 「ダウンロードは第一版要素」(user 観点) の completion

- **agent-server: share_text_as_file の hallucinated link 抑制 (`sandbox:/mnt/data/...` 捏造) ([#244](https://github.com/gamasenninn/tealus/issues/244) follow-up)** ([#245](https://github.com/gamasenninn/tealus/issues/245))
  - 実機 verify で agent が tool 呼び出し成功後、応答テキストに `[meishi_ono.md](sandbox:/mnt/data/meishi_ono.md)` を捏造 = ChatGPT Code Interpreter 環境の URL pattern 由来 training bias
  - tool description / return value を「**応答に download link を書かない**」と明示 (file は tool が直接添付済、agent は acknowledge のみ)
  - `default_system_prompt.md` に新 section「応答に書いてはいけない URL (training artifact)」追加: `sandbox:/...`、`file:///...`、markdown 形式 fake URL 全般禁止
  - [#229](https://github.com/gamasenninn/tealus/issues/229) で観察した training bias 同型 (LLM の構造的問題、prompt-level で防御)

### Fixed

- **agent-server: Deep cancel が claude.exe を kill できず work が裏で続行する critical bug ([#250](https://github.com/gamasenninn/tealus/issues/250) follow-up)** ([#252](https://github.com/gamasenninn/tealus/issues/252))
  - 実機 verify (5/5 17:00) で発覚: cancel 15 分後に Mandelbrot 結果 + 画像が chat に post された
  - 原因: Windows `spawn('claude.cmd', { shell: true })` で `cmd.exe → claude.cmd → claude.exe → MCP children` の tree。cmd.exe を taskkill /T /F した瞬間 claude.cmd は既に exit、claude.exe は System に reparent され /T tree walk から外れる
  - 結果 claude.exe は workload を完遂し `send_message` MCP tool で chat に直接 post (cancel 後の orphan)
  - **修正**: `registry.cancel()` で `Get-CimInstance Win32_Process` を PowerShell sweep、workspace path (room-unique) を CommandLine に含む claude.exe / cmd.exe を全 kill。WQL LIKE escape `\` → `\\` 含む
  - Name filter で sweep 自身の powershell.exe を除外 (self-kill 防止)
  - 実機 dry-run: orphan PID 392 のみ hit、Stop-Process で消滅確認

- **agent-server: Deep cancel 後の timeout が redundant 「⚠ タイムアウト」message を post する ([#250](https://github.com/gamasenninn/tealus/issues/250) follow-up)** ([#251](https://github.com/gamasenninn/tealus/issues/251))
  - 実機 verify (5/5 16:50) で観察: cancel から 5 分後に「⚠ タイムアウトしました（300秒超過）」が post される
  - 原因: `registry.cancel()` が process kill するだけで、`deep.js` 内の timeout timer を clear していなかった
  - 副次問題: 万一 close event が late fire すると「❌ エラーが発生しました」も出る可能性
  - **修正**: `proc._tealusTimer` / `proc._tealusCancelled` property attach、`registry.cancel()` で clearTimeout + flag 立て、close handler 冒頭で cancelled flag check して early return
  - 177 件 pass、回帰なし

### Added

- **agent-server: Light v2 (codex-sdk backed) 並列追加 — `/light2` prefix で codex 経由の Light agent (verify 済)** ([#258](https://github.com/gamasenninn/tealus/issues/258))
  - 業務メモ 5/6 夜 user voice 起点 (「light エージェントに codex を組み替え」)
  - **scope 議論で確定した線引き**: codex app-server 等の resident service spawn は NG (agent-server と二重 dispatcher で重い)、`@openai/codex-sdk` v0.128.0 (公式 npm、SDK が CLI spawn を完全 hide) は OK = 「resident service NG / ephemeral subprocess via SDK OK」
  - 現 Light v1 (`@openai/agents` SDK) は変更なし、`/light2` prefix で並列追加 (user 選択式)
  - **新規**: `agent-server/src/agents/lightV2.js` (~170 行)、`processLightV2()` で codex SDK 経由の event streaming → typing indicator 更新 → 最終 agent_message を chat push
  - **編集**: `router/index.js` で `/light2 ` prefix detect、`dispatcher.js` で `case 'light2'` 追加、`config/default_system_prompt.md` に cross-room 探索 pattern 追記 (Light v1 / v2 共通改善)
  - **MCP config**: `buildLightV2McpConfig(workspacePath)` で deep.js 同型に直接構築 (Light v1 用 MCPServerStdio instances からの抽出ではなく source 直読み)、tealus / workspace-fs / room 固有 / global を merge
  - **設計判断**: thread lifecycle = per-message 都度新規 / sandbox = `danger-full-access` (Tealus は trusted execution context、network 制限解消で localhost MCP 動作)、approvalPolicy = `never` / custom tools 0 個 (codex 内蔵 + 既存 MCP で全カバー)
  - **認証 path 2 通り**: API key (production) / ChatGPT subscription (個人 dev、`codex login` 経由で追加 API cost 0、Plus/Pro/Team 持ちの採用者保護)
  - **4 段 fix chain で完成**: 初期実装 → MCP config refactor → post-turn parse error warn 格下げ → sandbox network restriction 解消 → cross-room prompt 改善
  - **性能比較 (実機 5/7 verify、gpt-4o-mini 単価仮定)**:
    - 単純会話: v1 19.9k / v2 40.4k input tokens (2.07x cost)
    - 単 MCP 要約: v1 19.6k / v2 40.4k (2.07x)
    - cross-room TODO 分類: v1 50.1k / v2 188.9k (3.78x)、ただし v1 は cross-room 完結率低く v2 が明確に勝る
  - **メタ気付き**: prompt-level 改善には天井がある ([#220](https://github.com/gamasenninn/tealus/issues/220) で議論した「task decomposition が浅い」問題は system prompt 改善で部分的にしか改善せず、codex CLI 内蔵の reasoning + tool orchestration が structurally 強い)
  - **推奨運用**: 単純会話 / 単 room → v1 (cost 効率)、cross-room / 多角探索 → v2 (完結率)、ChatGPT Plus 持ち → v2 (subscription path で API cost 0)
  - 182 件 pass、回帰なし

### Fixed

- **client: Vite dev server proxy に `/agent-api` と `/rtc` を追加 — 採用者が dev mode で TTS / cancel / cc-projects / RTC が動かない trap を fix** ([#257](https://github.com/gamasenninn/tealus/issues/257))
  - 採用者第 1 号 (藤井さん) のサーバー (Ubuntu 22) で Mac Safari から Vite dev server (5173) 経由で TTS を試行 → 「TTS に失敗しました」error で動作しなかった
  - 5/4 で `/agent-api` を新設した時 (#243 / #248 / #250-#254 系で agent-server 経路拡充)、**Vite dev server 側 proxy 追加が漏れていた**構造的 bug
  - `/agent-api/tts/synthesize` request が Vite dev server で proxy されず SPA fallback で index.html → client JSON parse fail → default error
  - `/rtc` も同型で、トランシーバー / 通話の rtc-server proxy も dev server 経由では動かない構造だった
  - 影響範囲: 採用者が `npm run dev` で試した時の TTS / cancel / cc-projects mention / RTC 全機能 (本番 build → server 3000 経由なら問題なし)
  - 4 番目の「採用者第 1 号 dogfood で発見した trap」(過去: dashboard build / server port / Aivis key 設定)

- **agent-server: Router LLM で `max_tokens` → `max_completion_tokens` rename — 新 OpenAI model (o1/o3/gpt-5 系) で 400 エラー回避** ([#256](https://github.com/gamasenninn/tealus/issues/256))
  - 採用者第 1 号 (藤井さん) のログで発見: `Router LLM error: 400 Unsupported parameter: 'max_tokens' is not supported with this model`
  - Router (`router/index.js:83`) で OpenAI Chat Completions API call 時 `max_tokens: 10` 使用、新 model は reject
  - 影響: catch で light fallback で致命ではないが、Router の振り分け logic が実質機能せず全 message が light に流れる
  - **修正**: `max_completion_tokens` に rename、新旧両 model で動作
  - future-proof naming で OpenAI 公式 deprecation path に追従

### Added

- **client: Reply 引用 tap → 元 message へ scroll + highlight (dead-end UX 解消)** ([#255](https://github.com/gamasenninn/tealus/issues/255))
  - 現状のリプライ機能は引用を tap しても何も反応しない dead-end UX。LINE / Slack / Discord 等の標準は「引用 tap → 元メッセージへ scroll + 一瞬 highlight」
  - 既存 search 結果遷移用 scroll-jump 機構 (`ChatRoom.jsx:41-51`、`data-msg-id` + `highlight-msg`) を reply click にも reuse
  - **MessageBubble.jsx** / **VoiceBubble.jsx** の `.bubble-reply` に `onClick` 追加、`stopPropagation` + CustomEvent `message:scroll-to` dispatch
  - **ChatRoom.jsx** に listener: DOM 検索 → 即 scroll、不在なら `fetchMessages around` で再 load → scroll
  - **MessageBubble.css** に `cursor: pointer` + 微 hover 効果で clickable と user に伝える視覚 cue
  - 既存 voice:* event pattern と同型、prop drilling 回避、長押し context menu との衝突は `stopPropagation` で確実に分離
  - 削除済 reply target は server `attachReplies` 既存挙動 (null で返って引用自体非表示) で網羅

- **server: `GET /api/bot/tags` 新 endpoint — LLM の tag discovery primitive** ([#254](https://github.com/gamasenninn/tealus/issues/254))
  - 5/5 session で LLM が「tealus関係」tag 検索時、tag 名を guess して 5 候補全 miss → user に literal 名を教えてもらってやっと到達した「discovery 不在」体験が起点
  - 既存 `/api/tags/all` は user JWT 用 (client `api.js` の `getAllTags`)、bot JWT 用が無く tealus-mcp から tag list 取得不能だった
  - SQL は `tags.js:324` の集計 query を流用、bot メンバー全 room から tag 集計、`{ name, is_todo, total_usage }` を usage desc 順で返す
  - tealus-mcp v0.10.0 で `list_tags` tool として export、search_messages の前段 discovery として活用
  - 教訓 (memory): LLM 向け MCP / API は CRUD だけでなく list / discovery primitive 必須

- **client: メンション picker に cc-proj 仮想 user を表示** ([#253](https://github.com/gamasenninn/tealus/issues/253))
  - 業務メモ 5/4 18:07 user 「メンション機能で、CC-projを表示させたい」起点。[#213](https://github.com/gamasenninn/tealus/issues/213) cc-tealus bridge は動作していたが project 名を手入力する必要があった
  - **agent-server**: `GET /agent-api/agent/cc-projects` 新 endpoint、`~/.tealus/cc-queue/*.jsonl` の basename を validation regex (`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`) で filter して返す。mtime も同梱 (Phase 2 stale 表示の準備)
  - **client**: `MessageInput.jsx` で mount 時に fetch、`{user_id: 'cc:<proj>', display_name: 'cc-<proj>', is_cc: true}` として members に merge
  - **MentionPicker.jsx**: `is_cc` 仮想 user は terminal icon (lucide-react) + dark-teal avatar bg で人間と視覚区別、選択時 `@cc-<proj>` 挿入 (extractor regex と完全一致)
  - **Self-bootstrapping**: project は最初の `@cc-x` で beacon file が作られた時点で picker に出現、admin UI / DB schema 不要
  - 5 件 test 追加 (182 件 pass)、client build 通過

- **Deep agent cancel path — 暴走/長時間実行を user が中断可能に** ([#250](https://github.com/gamasenninn/tealus/issues/250))
  - 業務メモ 5/4 16:07/16:10/16:18 user 力説 3 voice 「deep が止まったままだとキャンセルできない」起点。Deep は claude CLI を child process spawn する構造上、外部から到達不能で **5 分 timeout 待ち以外に脱出 path 無し** という結構な structural gap だった
  - **Phase 1**: `agent-server/src/agents/deepRegistry.js` 新規 — in-memory `Map<roomId, ChildProcess>` で spawn 中の process を track、`cancel(roomId)` で SIGTERM + Windows taskkill (既存 timeout kill と同 path)
  - `deep.js`: spawn 直後 register、close/error で unregister、status name `thinking` → `analyzing` に変更 (Light の `thinking` と分離して client が識別可能に)
  - **新 endpoint**: `POST /agent-api/agent/cancel` (agent-server `/agent/cancel`)、JWT 認証、room 単位で kill。was_running=true なら chat に `⏹ 分析を中断しました。` 投稿 + idle status 通知
  - **Phase 4 (UI 可視化)**: `DeepCancelButton.jsx` 新規、ChatRoom の `.typing-indicator` 内に配置、`agentStatus.status === 'analyzing'` 時のみ表示 (Light 中は出ない)
  - 副次発見: 同 room で並列 Deep 実行は workspace 共有で race condition リスク (Phase 2 候補、本 issue 対象外)
  - agent-server 177 件 pass / client build 通過、回帰なし
  - 業務メモ 11 件中 #9 (重 × 高効果)

- **agent-server: Light agent 進行中表示 — `agent_tool_end` hook 追加で tool chain 全 step 可視化** ([#249](https://github.com/gamasenninn/tealus/issues/249))
  - 業務メモ 5/4 18:04 user 「進行中表示が hook 効いてないのを何とか」起点。user が過去 try したが catch できなかった問題を SDK lifecycle 再調査で真因特定
  - Root cause 2 件: (1) `agent_tool_end` hook 未登録 → tool 終了 → 次 tool 開始の間で status 凍結、(2) TOOL_STATUS_MAP が 6 tool のみで MCP tool 30+ silent
  - Fix: TOOL_STATUS_MAP に主要 MCP tool 6 件追加 (get_messages / search_messages / get_message_media / read_document / share_text_as_file / send_message)
  - `agent_tool_start` に generic fallback: mapping 漏れ tool も `${tool.name} を実行中...` 表示
  - `agent_tool_end` hook 新規登録: 通常時「考え中...」、result の error heuristic 検出時「失敗、別アプローチ検討中...」
  - 状態遷移完成: thinking → tool_start → tool_end → thinking → ... → idle、user は秒単位で進行可視化
  - [#231](https://github.com/gamasenninn/tealus/issues/231) `agent_tool_start` の対称完成、agent-server 177 件 pass 回帰なし
  - 業務メモ 11 件中 #5

- **client: 文字起こし編集 modal に音声再生スライダー (MVP)** ([#248](https://github.com/gamasenninn/tealus/issues/248))
  - 業務メモ 5/4 18:01 user 力説「編集画面の上に音声スライダー、ユーザーが自由に再生位置を control できれば編集が極めて楽になる」起点
  - VoiceBubble の audio + slider logic を `VoiceEditModal.jsx` に直書き copy で移植 (yagni、3 例目で共通 component 抽出検討)
  - `VoiceBubble.jsx` から `audioUrl` props を渡す (1 行追加)
  - `.voice-edit-player` / `.voice-edit-progress` 等の new CSS class 追加、既存 `.voice-progress-*` と同じ design 基調
  - 朝の見積 ~3-4h → 実装 ~30 分 (user 提案「既存 slider 再利用」の insight で 1/4 に圧縮)
  - Phase 2 (keyboard shortcut / 再生速度 / A-B repeat) は dogfood で pain あれば検討、yagni
  - 業務メモ 11 件中 #6 (重 × 高効果)

- **agent-server: share_text_as_file tool — OCR 結果等を DL 可能な file として届ける** ([#244](https://github.com/gamasenninn/tealus/issues/244))
  - 5/4 ベータテスト連絡板で藤井さんが画像 OCR 依頼、agent が「ワークスペース外への保存ができない」と応答 → user 「OCR 結果保存ダウンロード経路あるといい」起点
  - 既存の image / file は user upload 時のみ media record が作られていた (agent から user へ file を届ける手段なし)
  - **新 server endpoint** `POST /api/bot/push-file`: any mime accept、`/push-image` と同型構造
  - **新 agent-server**: `botApi.pushFile(roomId, buffer, filename, mimeType)`
  - **新 MCP tool** `share_text_as_file({ filename, content })`: mime は filename 拡張子から auto 推測 (.txt/.md/.csv/.json/.html/.xml/.log)、user は click で DL
  - server tests 345 件 / agent-server tests 177 件 pass、回帰なし
  - 業務メモ 11 件中 #4

- **client: AI 回答音声 (TTS auto-play) の停止 button** ([#243](https://github.com/gamasenninn/tealus/issues/243))
  - AI 応答の auto-play は aivis-cloud / browser TTS 両 path で **再生中参照を UI が保持していなかった** (停止操作の入口無し)
  - `stores/ttsStore.js` 新設で `isPlaying` 一元管理、`playTtsSrc` / `speakInternal` 開始/終了で更新
  - `ttsAudioPlayer.js` に `stopCurrentTts()` 追加、同時再生 1 つに限定 (新規開始時に既存停止)
  - 新 component `TtsStopButton.jsx`: floating bottom-right、再生中だけ表示、両 path 兼用 stop
  - `App.jsx` に `{user && <TtsStopButton />}` で room 越えグローバル配置
  - 業務メモ 11 件中 #3

### Fixed

- **client: mention @ 入力時の member 一覧が尻切れ** ([#242](https://github.com/gamasenninn/tealus/issues/242))
  - 真因 2 つ:
    - **CSS**: `max-height: 200px` 固定で 5-6 人で打ち止め → `min(400px, 50vh)` + thin scrollbar 常時表示で overflow 視覚化
    - **JS** (user dogfood で発覚): `MentionPicker.jsx:13` の `.slice(0, 8)` で **8 人ハード制限** → `.slice(0, 50)` に緩和
  - 教訓: bug 切り分け時、CSS / JS / data の 3 layer 全て確認すべきだった
  - 業務メモ 11 件中 #2

- **client: PC layout で profile / home 等が scroll しない ([#237](https://github.com/gamasenninn/tealus/issues/237) follow-up)** ([#241](https://github.com/gamasenninn/tealus/issues/241))
  - Profile / HomePage 等は `min-height: 100dvh` で content に応じて伸びる設計だが、`DesktopShell.css` の `.desktop-main { overflow: hidden }` で main pane の scroll が殺されていた
  - ChatRoom は `height: 100dvh` 固定 + 内部 messages div で自前 scroll するので影響なかったが、伸びる画面は下が切れて管理画面リンクに到達できない bug
  - Fix: `.desktop-main` を `overflow-y: auto; overflow-x: hidden;` に変更
  - dogfood loop ([#237](https://github.com/gamasenninn/tealus/issues/237)/[#238](https://github.com/gamasenninn/tealus/issues/238)/[#239](https://github.com/gamasenninn/tealus/issues/239)) 4 件目

- **agent-server: connectFromConfig が user MCP に env を渡してない ([#235](https://github.com/gamasenninn/tealus/issues/235) Tavily 復元時に発覚)** ([#240](https://github.com/gamasenninn/tealus/issues/240))
  - `roomMcpManager.js` の `connectFromConfig` (user-defined `mcp_config.json` の MCP を起動) が **env を child process に渡していなかった**
  - filesystem / tealus MCP は明示 `env: { ...process.env }` で動作していたが、user MCP は parent env 継承なし
  - 結果: tavily-mcp が `process.env.TAVILY_API_KEY` を読めず認証 fail、agent が「検索用 API が使えませんでした」と応答
  - **修正**: `env: { ...process.env, ...(def.env || {}) }` を追加 — parent env 継承 + `mcp_config.json` の `env` field で override 可能
  - 採用者保護: 採用者が他の API key 系 MCP (github / slack 等) を追加する時にも同じ問題を踏むため、本 fix で広く救済

- **client: useSocketSync の socket.off が全 listener を消し sidebar 未読更新を阻害 ([#237](https://github.com/gamasenninn/tealus/issues/237) follow-up)** ([#239](https://github.com/gamasenninn/tealus/issues/239))
  - `useSocketSync.js` cleanup の `socket.off('message:new')` 等が引数なしで **全 listener を削除** していた既存 bug を発見
  - mobile では RoomList が route 遷移で unmount/remount するため masked、PC layout (#237) で sidebar 永続化により発覚
  - room A 表示中に room B に message 着信 → sidebar 未読 badge が出ない症状
  - **修正**: 全 handler を const に extract、`socket.off(event, handler)` で specific reference 削除に変更 (15 個の event 全て)
  - これで useSocketSync 自身の handler だけ削除、RoomList 等の他 component listener は影響なし
  - dogfooding が露わにした既存 bug の典型例

- **client: PC layout で sidebar 未読 badge が既読化後も残る ([#237](https://github.com/gamasenninn/tealus/issues/237) follow-up)** ([#238](https://github.com/gamasenninn/tealus/issues/238))
  - Mobile では room 遷移で RoomList unmount → 戻り時に fresh 取得していたが、PC layout (#237) で sidebar 永続化された結果、ChatRoom 既読化後の sidebar 未読 badge が更新されず残留
  - Server `message:read` socket は sender 除外で emit (`socket.to(room_id)`)、自分自身には届かない構造
  - Fix: `RoomList.jsx` の room onClick で `useRoomStore.updateRoomInList(roomId, { unread_count: 0 })` を optimistic 呼び出し
  - ChatRoom mount で `markVisibleAsRead` が server cursor を更新するので eventually consistent
  - +9 LOC、Mobile UX 影響なし

### Added

- **client: PC レイアウト (2-pane sidebar) — desktop ユーザーの戸惑い解消** ([#237](https://github.com/gamasenninn/tealus/issues/237))
  - 業務メモ 5/4 01:38 (user 自身の dogfooding 体感) 起点。Tealus は 97% スマホ稼働だが、user / admin / 採用検証ユーザー = 縦糸を支える層が PC を使うと縦長スマホサイズで戸惑いがある
  - **Progressive enhancement**: CSS responsive で `≥1024px` の breakpoint で 2-pane (sidebar 320px + main 1200px) layout を適用、mobile (<1024px) UX は完全維持
  - `client/src/components/layout/DesktopShell.jsx` (新規): React Router Outlet で 2-pane shell wrapper、JS state branching なし (CSS media query only)
  - `App.jsx`: 認証必須 routes を `<DesktopShell>` でラップ (PrivateRoute → DesktopShell → 各画面)
  - `main.jsx`: PC PWA 強制縮小 (`window.resizeTo(480, ...)`) を削除 — 2-pane layout と矛盾
  - DesktopShell.css の cascade で各画面 container の max-width 制約を sidebar 内 / main pane で別々に override (個別 component CSS は触らず)
  - sidebar には既存 `RoomList` コンポーネントを再利用 (CSS のみで sidebar 幅に合わせ可)
  - desktop で BottomNav は hide (sidebar が代替)
  - Out of scope (Phase 2): right panel / multi-chat split / sidebar collapsible / tablet 専用 layout / keyboard shortcut

- **agent-server: Light/Deep memory 共有 (Option 1) — Deep CLAUDE.md に @memory/MEMORY.md 参照を追加** ([#236](https://github.com/gamasenninn/tealus/issues/236))
  - Light agent (`memory/MEMORY.md` を読み書き) と Deep agent (`CLAUDE.md` を Claude Code が auto-read) は同一 workspace に居るが互いの memory を見ていなかった
  - Option 1 (minimal change): Deep の CLAUDE.md template に「## 共有メモリ」section + `@memory/MEMORY.md` 参照を追加 → Claude Code の `@filename` mechanism で auto-load → Light が write した memory を Deep が自然に参照可能
  - `agent-server/src/context/sessionManager.js`: 新 room template に section 追加
  - `agent-server/scripts/migrate-claude-md.js` (新規): 既存 11 rooms を idempotent migration (dry-run 対応、`@memory/MEMORY.md` 参照済 room は skip)
  - 実機 migration 結果: 11 rooms 全 update、二度目実行で全 skip (idempotent 確認)
  - Light は CLAUDE.md を読まないので逆方向 (Light → Deep) は未対応、Option 2 で別途検討

- **tealus-mcp v0.9.0 連携 — read_document に Vision API fallback (Gemini) 統合、scan PDF 対応** ([#233](https://github.com/gamasenninn/tealus/issues/233))
  - tealus-mcp v0.8.1 で検出していた scan PDF / image-only PDF を、Gemini API multimodal で text 化する fallback layer を tealus-mcp 側に追加
  - 採用者は `agent-server/.env` に `GOOGLE_API_KEY` を設定すれば自動で有効化、unset で従来動作
  - Default model: `gemini-2.5-flash-lite` (free tier 1,000 RPD / 15 RPM)
  - Privacy 注意: Gemini free tier は Google が製品改善利用、社内文書は paid billing account に紐付けた key 推奨
  - tealus-mcp release: https://github.com/gamasenninn/tealus-mcp/releases/tag/v0.9.0
  - tealus 本体 (server / agent-server) は変更なし、`.env.example` に GOOGLE_API_KEY + 関連 env の解説 + privacy 注意を追記

- **tealus-mcp v0.8.0 連携 — read_document tool で PDF/DOCX/XLSX 解析対応** ([#232](https://github.com/gamasenninn/tealus/issues/232))
  - 業務メモ 5/3 18:58「MCP で PDF を読めるようにした方がいい」起点
  - tealus-mcp に `read_document(message_id)` tool 追加 (pdf-parse / mammoth / exceljs で text 抽出)
  - Light agent (gpt-5.4-mini) が `get_message_media` でメタ情報、`read_document` で本文を取得する 2 段構成
  - tealus 本体 (server / agent-server) は変更なし、新 tool は agent から自動的に拾われる
  - tealus-mcp release: https://github.com/gamasenninn/tealus-mcp/releases/tag/v0.8.0
  - Approach 2 (Vision API fallback for scan PDF) は将来別 issue で対応予定

### Changed

- **Light agent: tool call visibility + admin UI 上書き耐性 ([#229](https://github.com/gamasenninn/tealus/issues/229)/[#230](https://github.com/gamasenninn/tealus/issues/230) follow-up)** ([#231](https://github.com/gamasenninn/tealus/issues/231))
  - [#229](https://github.com/gamasenninn/tealus/issues/229)/[#230](https://github.com/gamasenninn/tealus/issues/230) 完了直後の実機 verify で **admin UI と code 編集の 2-source-of-truth conflict** が判明
    - `PUT /config/settings` が settings オブジェクト全置換で書き込み → admin UI 保存で `max_turns` field 消える
    - `loadSystemPrompt` の `if (content)` 判定が admin UI placeholder「カスタムプロンプト」27 bytes も truthy 扱い → default 1874 chars 読まれず
  - **F1**: `agent-server/src/config.js` に `LIGHT_MAX_TURNS: parseInt(process.env.LIGHT_MAX_TURNS || '12')` 追加 — settings.json から消えても code default で fallback
  - **F2**: `agent-server/src/agents/light.js` の `loadSystemPrompt` に `MIN_CUSTOM_PROMPT_LENGTH = 50` 追加 — placeholder 弾いて default に fallback
  - **Step 1 (visibility)**: `agent_tool_start` hook に `logger.info('[Tool] start: ${name} args=...')` 追加、`roomId` 条件分岐の外に出して全経路で log。Max turns exceeded で `run()` throw 時も tool sequence が log に残る (従来は `if (result.newItems)` block 到達せず消失)
  - **Step 2**: `LIGHT_MAX_TURNS` default 8 → 12 (4 step × 3 retry 余地、8 で exceed 実績あり)
  - SDK 仕様確認: `turnPreparation.js:23-28` で 1 turn = 1 model invocation、`lifecycle.d.ts:46-52` で hook 第 3 引数 `details.toolCall.arguments` で args 取得可能
  - 実機 verify: PDF 1 件 test → **3 turns で完結**、234 chars 応答、tool sequence (`get_messages` + `search_messages` parallel → `get_message_media` → 応答) 全可視化
  - 教訓: 2-source-of-truth 衝突は code 側に robustness を寄せる ([#226](https://github.com/gamasenninn/tealus/issues/226) → [#227](https://github.com/gamasenninn/tealus/issues/227) と同型 pattern)、visibility 不足は対症療法を強要する

- **Light agent context cleanup — TealusSession 削除 (D4 哲学完結)** ([#230](https://github.com/gamasenninn/tealus/issues/230))
  - [#229](https://github.com/gamasenninn/tealus/issues/229) で agent が自分で `get_messages` を呼ぶ pattern が完成 → `TealusSession` の役割 (session として前 N 件を fetch して agent に prepend) は **二重 fetch で重複** → 削除
  - `agent-server/src/agents/lightSession.js` 削除 (76 行、class TealusSession 全体)
  - `agent-server/src/agents/light.js`: `require('./lightSession')` + `new TealusSession(roomId)` + `run()` の `session: session` を削除
  - `agent-server/src/config.js`: `LIGHT_CONTEXT_MESSAGES` env 削除
  - `agent-server/src/routes/settings.js`: SAFE_ENV_KEYS から `LIGHT_CONTEXT_MESSAGES` 削除
  - `agent-server/__tests__/unit/lightSession.test.js` 削除
  - SDK 仕様確認: `@openai/agents` の `run({ session })` は session **optional**、`run.d.ts:141` で `session?: Session;`、`sessionPersistence.js:19` で session 無しは早期 return → run() は session なしで正常動作、turn 内 history は SDK internal で保持、過去 dispatch との連続性は **messaging (Tealus) 側で担保** = D4 哲学そのもの
  - test 修正: `webhook-to-agent.test.js` の prompt expectation を `stringContaining` に変更 ([#229](https://github.com/gamasenninn/tealus/issues/229) で dispatcher が user prompt に room_id prepend する仕様変更を反映、test 漏れの後追い fix)
  - agent-server **177 件 pass** (-6: lightSession.test 削除分、回帰なし)
  - 効果: code 簡潔化 (~80 行削除)、二重 fetch 解消 (cost/latency 改善)、mental model 統一 (light も deep も「Tealus を読みに行く」で一貫)

- **Light agent が Tealus context を統合 — minimum viable prompt + dispatcher pattern** ([#229](https://github.com/gamasenninn/tealus/issues/229))
  - Light agent が Deep agent と同じ「Tealus を読みに行く」pattern で動作するよう改修
  - `agent-server/config/default_system_prompt.md`: 7038 → 1874 bytes に簡略化
    - Tealus 哲学 (4 step: get_messages → get_message_media → search_messages → 応答) + 一般ルール + MCP ツール参照のみに集約
    - binary rule / 詳細具体例 / 失敗例を削除 (gpt-5.4-mini の reasoning なら不要、token-efficient)
  - `agent-server/src/webhook/dispatcher.js`: Light path で user prompt に `現在のルーム ID: ${roomId}` を prepend (Deep style minimal)
  - `agent-server/config/settings.json`: `max_turns: 8` 追加 (default 3 → 8、深い探索を許容)
  - 実機 verified eval baseline: `gpt-5.4-mini` で画像 (ラベル OCR + context 推論) / PDF (メタ取得 + honest 限界宣言 + 代替提案) 両対応
  - 採用者保護: 採用者は `agent-server/.env` で `AGENT_LIGHT_MODEL=gpt-5.4-mini` を設定推奨 (cost up は input 5x / output 7.5x、月 $5-30 想定 → 月 $25-225)
  - これは [#220](https://github.com/gamasenninn/tealus/issues/220) harness の starting point baseline として今後の prompt iteration の起点になる

### Fixed

- **MCP timeout 5s が #226 Phase C で完全には fix されていなかった件を修正** ([#227](https://github.com/gamasenninn/tealus/issues/227))
  - 採用者の log evidence で `data: { timeout: 5000 }` が依然出ていた
  - 根本原因: `MCPServerStdio` には 2 種類の timeout option があり、#226 では誤った方を渡していた:
    - `timeout` (ms): listTools / callTool 等の **request method** timeout
    - `clientSessionTimeoutSeconds` (秒): **connect (initialize handshake)** timeout、default 5s
  - #226 は `timeout: 30000` (request 用) のみ渡したが、connect には効かず default 5s のままだった
  - 修正: `clientSessionTimeoutSeconds: 30` (秒) を追加、tealus MCP / filesystem MCP / connectFromConfig すべてに適用
  - **教訓**: 「fix 完了 ≠ verify 完了」。unit test では constructor option までしか verify できず、SDK 内部での実利用までは届かなかった。実機 evidence で初めて根因に到達したのは反省点

- **本体 server 起動時に OPENAI_API_KEY 空チェック + loud warn** ([#228](https://github.com/gamasenninn/tealus/issues/228))
  - 採用者報告 (藤井さん @ ubuntu22): `server/.env` の `OPENAI_API_KEY=` が空 → stamp 生成時に OpenAI から「key 未提供」エラー、切り分けに 30 分以上
  - 旧: 空 key でも server は起動成功、API call 時に初めて OpenAI の error response → server side で原因が見えない
  - 新: `server/src/utils/envCheck.js` 新設、`runStartupEnvCheck(logger)` で起動時に env validation
    - 空 / 未設定 / 空白のみを検出 → 解決手順 (.env 編集 / 影響機能 / OpenAI dashboard URL) を案内する loud warn banner
  - fail-fast はせず起動継続 (一部機能だけ使いたい採用者の柔軟性確保)
  - unit test 8 件追加 (`__tests__/unit/envCheck.test.js`、isEmpty / checkOpenAIApiKey / runStartupEnvCheck)
  - 本体 server 337 件 + 新規 8 件 = **345 件 pass**、回帰なし

- **agent-server: ダンマリ問題 + filesystem ENOENT + tealus MCP timeout の 3 連鎖 fix** ([#226](https://github.com/gamasenninn/tealus/issues/226))
  - 採用者報告 (藤井さん @ ubuntu22): mention 明示後も「ダンマリ状態」、起動ログに `mcp-server-filesystem ENOENT` / `tealus MCP timeout`
  - **3 layer の問題が連鎖**していたのを切り分け fix:
  - **Phase A**: `agent-server/nodemon.json` 新設、watch を `src/` に限定 + `agent-workspaces` / `logs` / `node_modules` / `*.log` を ignore
    - 旧: nodemon が project 全体を watch → 新 room 初回処理で workspace dir 作成 → restart trigger → message 処理中断 (= 「ダンマリ」直接原因)
    - 新: workspace 作成しても restart しない、応答処理が完了する
  - **Phase B**: filesystem MCP を npx 経由に変更 (`agent-server/src/mcp/roomMcpManager.js:118`)
    - 旧: `fullCommand: 'mcp-server-filesystem <path>'` → 採用者環境にバイナリ無いと ENOENT
    - 新: `command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', <path>]` → 事前 install 不要、初回起動時に npx が pull
  - **Phase C**: MCP 接続 timeout を 5s → **30s** に延長 (`MCP_CONNECT_TIMEOUT` 定数化)
    - 旧: SDK default 5s → npx 初回 fetch で間に合わず cold start 失敗
    - 新: 30s で cold start 余裕、warm 後は実時間に影響なし
    - tealus MCP / filesystem MCP / connectFromConfig (room/global config) すべて適用
  - **採用者保護**: 表層症状 (ダンマリ / OPENAI 使えない) から **3 層を切り分けて根因 (nodemon watch + MCP startup)** を fix。「事前 install 要求しない」「cold start を許容する」narrative
  - 既存 agent-server 183 件 pass、回帰なし

- **agent-server: silent init failure → "Received null" error の 4 層 defensive fix** ([#225](https://github.com/gamasenninn/tealus/issues/225))
  - 採用者報告: 別ルーム (総務グループ) で `[Agent] Queue error: The "path" argument must be of type string. Received null` 発生
  - 根本原因: `initializeAgent()` が silently 失敗 (Tealus 接続失敗 / bot credentials 不正 / DB 接続失敗等) → `botAgentId=null` のまま → bot membership filter が短絡 skip → `dispatch({ agentId: null })` → `path.join(WORKSPACE_ROOT, null, roomId)` で TypeError
  - **4 層 defensive 改修**:
    1. `agent-server/src/context/sessionManager.js` — `getOrCreateContext` に input validation (`agentId` / `roomId` null チェック、明確な error message で throw)
    2. `agent-server/src/webhook/dispatcher.js` — `_dispatch` 冒頭に agentId null ガード + 採用者向け診断 message (TEALUS_API_URL / Bot credentials / DB の確認誘導)
    3. `agent-server/src/setup/register.js` — `initializeAgent` catch を **loud な failure banner** に拡張 (5 連 logger.error で原因切り分け、採用者見落とし防止)
    4. unit test 3 件追加 (dispatcher null guard / sessionManager input validation × 2)
  - 既存 server 337 件 + agent-server 180 件 + 新規 3 件 = **520 件 pass**、回帰なし
  - **採用者保護**: silent failure → loud + actionable な誘導。`Received null` Node 内部エラーから「init 失敗、こういう原因」の診断ガイドへ変換

- **EADDRINUSE 時の actionable エラーメッセージ — 3 server (tealus / agent / rtc) で同型 fix** ([#224](https://github.com/gamasenninn/tealus/issues/224))
  - 採用者報告: 「3 時間ほど動かしていた後、全て再起動したら agent-server が `EADDRINUSE: address already in use :::4000` で起動しない、サーバ再起動ですかね」
  - 旧実装: `app.listen()` の error event を捕捉しておらず、port 既使用時に **uncaught error で crash** + Node default stack trace のみ → 採用者がどう対処すればよいか分からなかった
  - 改修: 3 server すべてに `server.on('error', ...)` を追加、`EADDRINUSE` の場合に **OS 別の kill コマンドを併記した actionable メッセージ**を logger.error で出力後 `process.exit(1)`:
    - Linux/Mac: `lsof -ti:<PORT> | xargs kill -9`
    - Windows: `netstat -ano | findstr :<PORT>` → `taskkill /F /PID <pid>`
  - `agent-server/src/index.js`: graceful shutdown に `server.close()` を追加 (前から MCP のみ close で HTTP server 残存していた副次 bug を fix)
  - 影響範囲: tealus 本体 (port 3000) / agent-server (port 4000) / rtc-server (port 3100)
  - 既存 server 337 件 + agent-server 180 件 = **517 件 pass**、回帰なし

- **音声メッセージ「許可されていない」エラーの原因切り分け + HTTPS 未対応時の明示メッセージ** ([#223](https://github.com/gamasenninn/tealus/issues/223))
  - 採用者報告: 「音声メッセージを使いたいのですが、許可されていないと表示されます、何か設定が必要ですか」
  - 旧実装: `getUserMedia` の catch で原因に関わらず一律「マイクへのアクセスが許可されていません」を表示 → 採用者が次の正しい行動 (HTTPS 化等) に到達できなかった
  - 改修: `client/src/components/chat/MessageInput.jsx` の `handleMicClick` で error.name に応じて 4 ケース + fallback で具体的メッセージ表示
    - `NotAllowedError` → ブラウザ設定でマイク許可を確認
    - `NotFoundError` → マイク接続を確認
    - `NotReadableError` → 他アプリでの使用を確認
    - それ以外 → エラー内容を併記
  - **insecure context (`!window.isSecureContext`) の事前チェック**を追加: `getUserMedia` 呼び出し前に弾き、「マイクの利用には HTTPS 接続が必要です」を即座に表示。LAN IP 等での HTTP アクセス採用者が **エラーから HTTPS 設定に到達しやすく**なる
  - エラー表示時間 5s → 8s に延長 (採用者が読みやすく)

- **media subdir が初期 setup で作成されない問題を fix** ([#222](https://github.com/gamasenninn/tealus/issues/222))
  - 採用者報告: 初期設定で `media/images/` が作られず、画像 download/upload が機能しなかった (手動 `mkdir` で復旧した報告)
  - 影響範囲は 8 subdir (`avatars` / `icons` / `images` / `videos` / `files` / `voices` / `stamps` / `thumbnails`) すべて auto-create されていなかった
  - `server/src/utils/mediaSetup.js` 新設、`ensureMediaDirs(mediaRoot)` で全 subdir を `mkdirSync({ recursive: true })`
  - `server/src/app.js` 起動時に `ensureMediaDirs(MEDIA_ROOT)` 呼び出し (dotenv 直後、Express 構築前)
  - unit test 5 件追加 (`__tests__/unit/mediaSetup.test.js`、idempotent / 既存 dir 保護 / nested mediaRoot 等)
  - **採用者保護**: fresh install で初手から動く。手動 `mkdir` 不要

### Changed

- **stamp 生成: `OPENAI_API_KEY` フォールバック追加** ([#221](https://github.com/gamasenninn/tealus/issues/221))
  - `STAMP_TEXT_API_KEY` / `STAMP_IMAGE_API_KEY` が未設定の場合に `OPENAI_API_KEY` に自動 fallback する fallback chain を追加 (`server/src/services/stamp/{textProviders,imageProviders}.js`)
  - 動機: 2026-05-03 朝、user が「stamp 生成だけ `Incorrect API key provided: undefined` で失敗」(assistant は動く) を報告。`.env` には STAMP keys が設定済だが running server で `undefined` になっていた根因不明 case。defensive 改修として OPENAI_API_KEY fallback で再発防止
  - **採用者保護 narrative**: `OPENAI_API_KEY` 1 本で stamp も assistant も動く UX に。別 provider (将来 Stable Diffusion 等) を使う採用者は STAMP_*_API_KEY を明示すれば override 可能
  - `.env.example` の Stamp section に fallback chain の説明 comment 追加
  - unit test 7 件追加 (`__tests__/unit/stampProviders.test.js`、env fallback chain 各組合せ)

- **`docs/setup-cc-tealus-bridge.md` を双方向統合 guide に拡張**
  - 元は cc-tealus bridge (Tealus → Claude Code wake-up、Inbound) のみを扱っていた doc を、**tealus-mcp (Claude Code → Tealus、Outbound) も含む 2 方向の統合 setup guide** として再構成
  - **Part 1: Outbound** (tealus-mcp) を新規追加: bot 準備 / `~/.claude.json` の `mcpServers` 登録 / 動作確認 / 11 ツール一覧
  - **Part 2: Inbound** (cc-tealus bridge) は既存内容を保持、節番号を `1B / 2B / ...` に再付番
  - **ステップ 3.5B: listen-tealus skill ファイル配置** を新規追加 (Claude Code の skill は `npm install` 等不要、`~/.claude/skills/` または `<project>/.claude/skills/` への単純コピーで認識される旨を明示。**user-level 配置 (案 A)** を推奨)
  - **Part 3: 統合動作確認** を新規追加: outbound + inbound が 1 cycle で繋がる流れを明示
  - トラブルシュートに **Outbound 系 (npx cache、Bot login 失敗、v0.7.0 flag 不可)** の Q × 3、**`/listen-tealus` skill 認識されない**の Q を追加
  - 関連 link に [tealus-mcp v0.7.0 release](https://github.com/gamasenninn/tealus-mcp/releases/tag/v0.7.0) と [#219](https://github.com/gamasenninn/tealus/issues/219) を追記
  - 動機: tealus-mcp v0.7.0 release ([#219](https://github.com/gamasenninn/tealus/issues/219)) で MCP 側が成熟し、「Claude Code を Tealus の能動的メンバー化」する full setup を 1 doc にまとめる時期が熟した。採用者が outbound / inbound の 2 piece を自分で継ぎ合わせる必要がなくなる。skill 配置は別プロジェクトで使う採用者の「実感が薄い」 install model への明示的補完
  - file 名 `setup-cc-tealus-bridge.md` は既存リンク (CHANGELOG / `.claude/skills/listen-tealus.md`) との互換性のため未 rename。将来的に `setup-claude-code-integration.md` 等への rename を検討
  - サイズ: 266 → 約 500 行 (+230 程度)

- **`GET /api/bot/messages` の transcription verbosity 制御** ([#219](https://github.com/gamasenninn/tealus/issues/219))
  - voice メッセージの `transcription` field を 3 段階で出し分けできる query parameter を追加: `include_transcription` (default `true`) / `include_raw` (default `false`)
  - **default 振る舞い変更 (破壊的)**: 旧 `{ raw_text, formatted_text, status }` → 新 `{ id, status, version, formatted_text }` (raw_text 省略 + version / id 追加)
  - 3 段階の field 構成:
    - `include_transcription=false` → `{ id, status, version }` (id-only モード、本文を取得せず存在 / 状態だけ確認)
    - default (`include_transcription=true, include_raw=false`) → `{ id, status, version, formatted_text }`
    - `include_transcription=true, include_raw=true` → `{ id, status, version, formatted_text, raw_text }`
  - 動機: voice 含む room の `get_messages` 取得が raw_text + formatted_text 両方 inline で 数十 KB に膨らみ、AI agent が MCP を避けて SQL 直叩きに走る reflex の根因になっていた。formatted-only default で **transcription 領域がほぼ半減**、`include_transcription=false` で更に縮退可能
  - 後方互換性: `raw_text` を必須としていた caller は `include_raw=true` を明示する必要あり。本リポジトリの consumer は `agent-server/src/media/messageAdapter.js` の `formatted_text || raw_text` fallback のみ (formatted-only default で raw が undefined になっても fallback chain として機能、実害なし — むしろ整形空 voice で raw garbage を LLM に渡さなくなる improvement)
  - tealus-mcp 側の対応 issue: [tealus-mcp#1](https://github.com/gamasenninn/tealus-mcp/issues/1) で同期改修予定
  - integration test 6 件追加 (`__tests__/integration/bot-api.test.js`、計 325 件 pass)

## [0.2.2] - 2026-05-02

### Added

- **voice transcription 失敗時の再実行機能 (Phase A 完了)** ([#216](https://github.com/gamasenninn/tealus/issues/216))
  - 新エンドポイント: `POST /api/messages/:id/transcription/retranscribe` (sender or `allow_member_transcription_edit=true` ルームメンバー)
  - 動作: voice_transcriptions に新 version を `status=pending` で INSERT、`edited_by=requestUser` を記録、async で Whisper + AI 整形を再実行 → `status=done` で完了
  - 既存 voice 編集機構 (PUT route) と並ぶ「voice 再生成」path として利用可能
  - `transcribeVoiceMessage` / `formatTranscription` を **version-aware** に refactor (default version=1 で初回 upload と互換)
  - integration test 6 件追加 (`__tests__/integration/transcription-edit.test.js`、計 319 件 pass)
  - **UI**: `VoiceBubble.jsx` の transcription 表示部分に「再文字起こし」ボタンを追加 (status='error' で prominent、status='done' で 編集 / 履歴 と並ぶ)。`useConfirm` で「再文字起こしを実行します。少し時間がかかります。」確認 → API 呼び出し → Socket.IO の `voice:status` / `voice:transcription` event で transcription 状態自動更新
  - `client/src/services/api.js` に `retranscribeVoiceMessage(messageId)` 追加
  - 起点: 業務メモ msg `fcde7980` (2026-05-02 05:10、現場運用者「文字起こしできないものが発生」報告)
  - Phase B 候補 (別 issue で起票予定): rate limit (1h N 回)、自動判定 (TV ノイズ検出 → auto retry)、`retranscribe_voice` MCP tool
- **Claude Code ↔ Tealus リアルタイム連携 (file beacon パターン、Phase A)** ([#213](https://github.com/gamasenninn/tealus/issues/213))
  - agent-server に `@cc-{project}` mention 検出 + file beacon append logic を追加 (`agent-server/src/webhook/ccQueue.js`)。webhook 受信時、メッセージ content の **先頭に** `@cc-{project}` があれば `~/.tealus/cc-queue/{project}.jsonl` に payload を 1 行 append (#215 で先頭マッチング方式に変更)
  - **stateless / convention-based** な設計: agent-server は project 一覧を管理しない、mention の suffix がそのまま file 名になる
  - **論理識別子方式** で routing: ディレクトリ位置と project 識別子を decouple、`.claude/cc-tealus.json` で `project_name` を明示
  - **Claude Code session 側**: `.claude/skills/listen-tealus.md` skill で Monitor を arm、`tail -n 0 -F` で新着監視 (sub-second wake-up)
  - **設定 schema** (`.claude/cc-tealus.json`): `project_name` / `auto_level` (L1/L2/L3) / `queue_path` / `catch_up_policy` (ask/all/skip/recent:Nh)
  - **L2 (suggest reply) が default**: 私が reply 案を提案 → user が `OK` / 編集 / `スキップ` 選択 → tealus-mcp で投稿
  - 採用者向け walkthrough: `docs/setup-cc-tealus-bridge.md`
  - 例設定ファイル: `.claude/cc-tealus.json.example` (`.claude/cc-tealus.json` は gitignore)
  - 単体テスト 22 件 (`agent-server/__tests__/unit/ccQueue.test.js`、180 全 pass)
  - **自己ループ防止 (主要メカニズム)**: mention は **メッセージの先頭** にある場合のみ match ([#215](https://github.com/gamasenninn/tealus/issues/215))。AI reply は本文中で `@cc-*` を引用しても、その mention は先頭にないため自然に skip される。env 設定不要、stateless
  - **自己ループ防止 (defense in depth)**: `CC_SKIP_SENDER_IDS` env (CSV) で「cc routing で skip する sender bot user ID list」を任意設定可能 (`shouldSkipCcSender` + `loadSkipSenderIds`)。Phase A 初期実装の名残、先頭マッチング後は基本不要
  - **`created_at` fallback**: webhook payload に `message.created_at` が無い場合は `new Date().toISOString()` で補完
  - **Phase B 候補** (本 release では out of scope): multi-session lock file、tag 形式 routing、L1/L3 切り替え skill、watermark 自動 GC、network-aware (別 PC 対応)、cc bot 動的登録 (env なしで自動検出)
  - 起点: 「Webhook を per-project で立てると重い」という現場運用の声、agent-server を「AI 応答エンジン」から「**AI 班 dispatcher**」へ進化させる構造判断の入口

### Changed

- **voice transcription の default モデルを `whisper-1` → `gpt-4o-transcribe` に変更** ([#217](https://github.com/gamasenninn/tealus/issues/217))
  - 動機: whisper-1 は無音 / 不明瞭な audio に対して「ご視聴ありがとうございました」「サブタイトルとコメント」等の TV 字幕由来 noise を hallucinate する既知の弱点があり、業務無線運用で transcription 失敗が現場運用者から報告されていた (2026-05-02 業務メモ)
  - gpt-4o-transcribe (OpenAI 2025 release) は autoregressive な silence handling が改善され、無音は空文字を返すようになっている。token-based 課金だが、whisper-1 と **コストはほぼ同等** (~$0.006/分相当)
  - 実機評価 (2026-05-02): 業務無線 voice 「フロント、取れますか」「野菜市場」「みこがい君」等の業務用語を自然に transcribe、無音 voice は **正しく空文字返却** (whisper-1 では hallucinate していた case で改善確認)
  - 互換性: `openai.audio.transcriptions.create` の API signature は同じ。env `WHISPER_MODEL` で旧モデルに即戻し可能 (`whisper-1` / `gpt-4o-mini-transcribe` も選択肢)
  - server tests 全 pass、本体実装変更は default 値の 1 行のみ

### Fixed

- **tealus-cli watch モードで token 再取得時に「ユーザーIDとパスワードは必須です」で停止する問題に対する防御層** ([#212](https://github.com/gamasenninn/tealus/issues/212))
  - 症状: `tealus-cli --watch` で運用中、JWT 再取得 (refresh) のタイミングで login() が server に空 body を送ってしまい `AUTH_LOGIN_REQUIRED` で停止 (再発性あり、現場運用で実害あり)
  - 真の root cause は code path 上未特定 (BOT_ID/BOT_PASS の再代入箇所は startup 3 行のみ、watch loop 中の変化は無いはず) — Windows / fs.watch / native callback 経由の状態混乱が疑われるが確証なし
  - **防御策として** 認証情報を起動時に `Object.freeze({ login_id, password })` で固定 capture、login() は `credentials` を参照するよう変更 (process.env / module-level let が runtime 中に変化しても credentials は不変)
  - 再発時の root cause 特定用 diagnostic を追加: login() 入口で credentials 不在を WARN、refresh 失敗時に request body 概要 + server response を log
  - 過去の発生報告: 2026-05-01 業務メモで現場運用者から報告 (「やはり CLI が途中で止まる」)、複数回再発した recurring bug

## [0.2.1] - 2026-05-01

### Fixed

- **Node.js 18 環境で `undici` が `ReferenceError: File is not defined` で crash する問題を install 時点で防止** ([#210](https://github.com/gamasenninn/tealus/issues/210))
  - `File` global は Node.js 20 で初めて runtime に追加された。`undici` v6+ (openai SDK 等の transitive dependency) が `webidl.MakeTypeAssertion(File)` で global を要求するため、Node 18 では起動時に即 crash していた
  - 全 6 package.json (`/`, `server/`, `client/`, `dashboard/`, `agent-server/`, `rtc-server/`) に `engines.node: ">=20.0.0"` を追加
  - ルートに `.npmrc` を新設 (`engine-strict=true`)、Node 18 では `npm install` 自体が `EBADENGINE` で hard fail する状態に
  - README クイックスタートの先頭に Node 20+ 必須を太字で明記、`nvm` / NodeSource 案内付き
  - 採用者が起動時の cryptic な undici エラーで詰まる前に install 時点で気付ける防御層を追加
- **初回ユーザー登録が admin role にならない問題を修正** ([#211](https://github.com/gamasenninn/tealus/issues/211))
  - `POST /api/auth/register` が `role` 未指定で INSERT していたため、migration 002 の default `'user'` で作成され、README どおりに登録した「管理者」が一般 user 権限になっていた
  - **最初の非 Bot ユーザー (`is_bot = false` の COUNT が 0) を admin として作成**するロジックを追加 (Mattermost / Rocket.Chat / GitLab 等の標準 OSS パターン)
  - 以降の登録は user role で作成、admin がダッシュボード経由で昇格管理可能
  - integration test 3 件追加 (auth.test.js: first-user → admin / second-user → user / Bot 存在下でも auto-promote)
  - README 5 章にも auto-promote 挙動を明記

## [0.2.0] - 2026-04-30

### Added

- **OSS 採用検討者向け Phase 1 Pitch deck 公開 + Phase 0 共通プレゼン素材** ([#209](https://github.com/gamasenninn/tealus/issues/209))
  - `docs/presentation/` 6 ファイル: elevator-pitches / philosophy / numbers / architecture-summary / demo-scenarios / full-pitch-oss-adopters (Marp 形式 ~45 slides)
  - LP 班 (tealus-site repo) により build + 音声ナレーション化 → **https://tealus.dev/pitch/** で公開中
  - audience-別 elevator pitch (5 種) を Phase 0 共通素材として用意、OSS 採用検討者 / 技術評価者 / 思想共感者 / 業務エンドユーザー / stakeholder 向けに展開可能な構造
- **MCP `delete_room` ツール + `DELETE /api/rooms/:id` (tealus-mcp v0.6.0)** ([#207](https://github.com/gamasenninn/tealus/issues/207))
  - `create_room` の対称機能、AI が能動的にルーム archive / cleanup できる primitive
  - 安全制約 2 段階: (1) **creator only** (rooms.created_by) (2) **solo member only** (自分以外のメンバー 0 人)
  - 他のメンバーが残っている場合は **先に退会させる必要**がある (= 「これから消すぞ」と明示する workflow を強制)
  - `direct` ルームは削除不可 (leave で代替、`requireGroup` で 400 拒否)
  - CASCADE で関連データ (messages, members, voice_transcriptions, message_media, tags 等) もすべて削除
  - server 側に新 middleware 2 つ (`requireCreator` / `requireSoloMember`) + integration test 7 件 (server 295 → 302 全 pass)
  - tealus-mcp v0.6.0 release、合計 10 → 11 MCP ツール、unit test 29 → 34 (+5)
- **MCP `create_room` ツール (tealus-mcp v0.5.0)** ([#200](https://github.com/gamasenninn/tealus/issues/200))
  - AI が新しいグループルームを能動的に作成できる primitive。呼び出した bot は admin として自動追加
  - 既存 `POST /api/rooms` を流用 (Bot 認証 = JWT で呼び出し可)、本体 repo 側に server コード変更なし
  - `tealus-mcp` v0.5.0 release、合計 9 → 10 MCP ツール
  - 用途: AI 班連絡用ルーム / 議題スレッド / 期間限定タスク / インシデント対応など、AI が組織を能動的に編成する場面
  - 起点: 2026-04-28 の AI 班連絡ルーム開設時、curl + Bash 直叩きで作成した経験 (Bash の CP932 エンコード問題で日本語ルーム名が文字化けした) を MCP 化することで解消
  - tealus-mcp 側 unit test 6 件追加 (23 → 29 件 全 pass)
- **transcription guideline の自動学習 — Phase 1: batch mining script** ([#206](https://github.com/gamasenninn/tealus/issues/206), [#208](https://github.com/gamasenninn/tealus/issues/208))
  - `server/scripts/mine_transcription_aliases.js` 新設: voice_transcriptions の編集履歴 (AI 版 vs. 人間訂正版) から alias 候補を mining する CLI
  - GPT-4o-mini に編集ペアを投げて (誤転写, 正解) の固有名詞ペアを抽出。整形差・句読点差は GPT が自然に弾く
  - 出現回数集計 + 閾値フィルタ (default N=2)、既存 transcription_guideline.json の vocabulary と照合して merge 候補 (新規 term / 既存 term への alias 追加) を生成
  - 出力は report ファイル (`server/config/mining_report.json`、gitignored)。**既存 guideline は書き換えない** — 人間が report を見て手動 merge
  - `--mode=by-term` option ([#208](https://github.com/gamasenninn/tealus/issues/208)): default の `by-pair` (誤転写→正解 1 ペア = 1 行) に加え、term 単位で aliases を集約するモード追加。同一語の認識ばらつきを横断把握できるレビュー用ビュー
  - Phase 2 (auto-update on edit) と Phase 3 (DB 化 + UI) は別フェーズ
  - 実装の要点: `aliasMiner.js` で抽出ロジックを testable に分離、unit test 26 件 (GPT 部分はモック、buildPairs / aggregate / buildMergeCandidates の純ロジックは実テスト)
  - 設計判断: AI 整形版 (`edited_by IS NULL`) と 人間編集版 (`edited_by IS NOT NULL`) を `voice_transcriptions.version` 単位で正しく区別。これにより AI 整形ノイズではなく純粋な人間訂正だけを学習対象にできる
- **voice transcription pipeline のカスタマイズ機構** ([#204](https://github.com/gamasenninn/tealus/issues/204))
  - 外部 JSON 設定ファイル (`server/config/transcription_guideline.json`) で vocabulary + guidelines を組織固有に注入できる
  - **Whisper 段階**: `whisper_context` (ドメイン文脈の散文) のみ `prompt` parameter に渡す (200 文字上限)。**vocabulary は渡さない** (Whisper の prompt は style/spelling bias であって辞書ではないため、強く渡すと隣接音が歪む副作用あり、例: 「ビレッジ側」→「ビレッジガン」)
  - **AI 整形段階**: vocabulary + guidelines を既存 SYSTEM_PROMPT に append。表記ブレの正規化、TV/動画由来ノイズ (「ご視聴ありがとう」「サブタイトルとコメント」「エンディング」等) の自動空文字化が可能。GPT が文脈と aliases を突き合わせて訂正するため、Whisper の鈍器より精密
  - 設定ファイル無しなら従来挙動 (空オブジェクト fallback、後方互換)
  - `server/config/transcription_guideline.example.json` をサンプルとして同梱、実運用版は `.gitignore`
  - Loader はプロセス起動時に lazy load + キャッシュ
  - unit test 14 件追加 (loadGuideline / buildWhisperPrompt / buildFormattingExtension)
  - 元議論: 当初 #203 (regex BL post-process) として起票したが、AI 整形段階の文脈判断力で同問題を扱える設計判断で #204 に集約
- **Light agent に Tealus MCP を programmatic 注入** ([#199](https://github.com/gamasenninn/tealus/issues/199))
  - Deep agent と同じパターンで、`getOrCreateSharedGlobal()` 内で TEALUS_BOT_ID/PASS が設定されていれば自動的に Tealus MCP を追加
  - `npx -y github:gamasenninn/tealus-mcp` で zero-config 接続 (Deep と repo を共有)
  - これにより Light agent も `search_messages` / `get_message_media` / `mark_tag_done` / その他 8 tools にアクセス可能に
  - 既存の `agent-server/mcp_config.json` は **user カスタム MCP 専用** として温存 (filesystem はルームごとに自動生成のまま)
  - BOT 認証情報が無い環境では skip (エラーにならず)
  - 起点: 業務メモ 2026-04-28 02:20「ライトエージェントに MCP を追加する」

- **MCP `mark_tag_done` ツール + Bot API endpoint** ([#197](https://github.com/gamasenninn/tealus/issues/197))
  - 新エンドポイント: `PATCH /api/bot/messages/:id/tags/:tag_name/done` (Bot のルーム所属検証 + tag_name → tag_id 解決)
  - `is_done` 状態を AI が直接更新できる primitive
  - `search_messages` と組み合わせ: 「実は完了済の TODO を見つけて即マーク」フロー成立
  - tealus-mcp v0.4.0 で公開
  - bot-api 統合テスト 8 件追加 (計 49 件 pass)
  - 関連 [#185](https://github.com/gamasenninn/tealus/issues/185) (umbrella)、[#195](https://github.com/gamasenninn/tealus/issues/195) (reconcile_todos の基盤ピース)
- **MCP `search_messages` ツール + Bot API endpoint** ([#194](https://github.com/gamasenninn/tealus/issues/194))
  - 新エンドポイント: `GET /api/bot/search` (Bot のルーム所属検証 + 6 種 narrowing filter のいずれか必須)
  - キーワード / タグ / 期間 / 発言者 / type / room による横断検索
  - **snippet ハイライト**: マッチ前後 ±100 文字、`**match**` 形式で返却 (索引→詳細パターン)
  - `q` 有無で 2 分岐 SQL: 単一 SELECT (~2ms) / UNION+CTE (~15ms)
  - `pg_trgm` GIN index ([migration 021](server/src/db/migrations/021_pg_trgm_search_index.sql)) を活用
  - LIKE wildcard (`%` `_` `\`) を含む `q` を安全に escape
  - tealus-mcp v0.3.0 で `search_messages` tool として公開
  - 設計議論: [#193](https://github.com/gamasenninn/tealus/issues/193)、umbrella: [#185](https://github.com/gamasenninn/tealus/issues/185)
  - bot-api 統合テスト 16 件追加 (計 41 件 pass)
- **MCP `get_message_media` ツール + 対応 Bot API endpoint**
  - 新エンドポイント: `GET /api/bot/messages/:id/media` (Bot のルーム所属検証 + 10MB 上限)
  - 画像: base64 + メタ JSON で返却 → MCP 側で `image` content type にラップ → AI が直接視認可能
  - 音声: `voice_transcriptions` の文字起こしを併せて返却 (MCP 側では文字起こし優先で text 化)
  - 動画など: メタ情報のみ (バイナリは text 応答に大きすぎるため)
  - tealus-mcp v0.2.0 で対応 (https://github.com/gamasenninn/tealus-mcp)
  - これまで AI が画像メッセージを「見る」には DB 直クエリ等の裏技が必要だったが、標準ツール化された
  - bot-api 統合テスト 5 件追加 (計 25 件 pass)
- **mcp-server を独立 repo に分離 + GitHub 直接 install 対応** ([#187](https://github.com/gamasenninn/tealus/issues/187))
  - 移転先: [gamasenninn/tealus-mcp](https://github.com/gamasenninn/tealus-mcp)
  - clone 不要で MCP クライアント (Claude Code / Cursor 等) から呼び出し可能
  - 設定例:
    ```json
    { "mcpServers": { "tealus": { "command": "npx", "args": ["-y", "github:gamasenninn/tealus-mcp"] } } }
    ```
  - `npx` が GitHub からアーカイブを取得 → 初回起動時に依存解決、以後はローカル cache
  - npm registry には publish しない方針 (GitHub 直接 install で zero-config install できるため、npm 2FA 等の障壁を回避)
  - tealus 本体 repo の `mcp-server/` は移転案内 stub のみ残置
- **Docker による全サービスデプロイ化 (Phase A)** ([#188](https://github.com/gamasenninn/tealus/issues/188))
  - `docker-compose.full.yml`: postgres + redis + server + agent-server を 1 コマンドで起動
    - server image は client / dashboard の dist を multi-stage build で同梱 (312MB)
    - agent-server image は alpine ベース (261MB)
    - 起動時にマイグレーション (冪等) を自動実行
    - Mac / Windows / Linux 全て対応 (mediasoup の host network 制約を回避)
  - `docker-compose.rtc.yml`: rtc-server を併走したい Linux ユーザ向け optional (network_mode: host)
  - 各 service に `Dockerfile` + `.dockerignore` を新設
  - dev 用の既存 `docker-compose.yml` は触らず、開発者フローを完全維持
- **README に「Docker デプロイ」セクション追加**: 3 つの構成 (default / +rtc native / +rtc Docker) を明示
- **rtc-server reachability の動的検出** ([#188](https://github.com/gamasenninn/tealus/issues/188) Phase A の一部)
  - server / agent-server が rtc-server の `/health` を 30 秒ごとに poll
  - 状態変化時に Socket.IO `capability:changed` event を全 client に emit
  - flap 抑制 (連続 2 回失敗で disable、1 回成功で即 enable)
  - `/api/config` に `realtime_voice_available` フィールド追加
  - rtc-server を後から起動 / 停止 / 別ホストに移動しても 30 秒以内に UI が自動追従
- **client UI の動的連動**
  - 通話ボタン / トランシーバーボタンを `realtimeVoiceAvailable` で条件 render
  - `IncomingCallModal` / `CallWindow` / `CallBanner` も同様に条件 render
  - `useCallNotification` / `useTransceiver` に safety net で二重防御
- **server-side defense**: `call:start` を rtc 不可時に reject、古い client / race condition から UX 事故を保護
- **agent-server TTS の dynamic degrade**: Aivis 合成失敗 / Socket.IO POST 失敗時に browser TTS に自動降格 (rtc-server とは独立、合成 / 配信どちらが落ちても fallback で発話保証)
- `rtc-server/server.js` に `/health` endpoint 追加 (server / agent-server からの reachability 検出用)
- 環境変数 `RTC_HEALTH_INTERVAL` で poll 間隔を上書き可能 (default 30 秒)
- `TTS_BROADCAST_MEDIASOUP=true` env で legacy mediasoup TTS 配信も並走可能に ([#189](https://github.com/gamasenninn/tealus/issues/189))
  - transceiver gateway 受信機 (mediasoup PlainTransport を listen する専用 hardware) を運用する環境向け
  - default false (mediasoup 不要、Socket.IO のみで完結)
- `POST /api/bot/tts-audio` + `GET /api/bot/tts-audio/:id` 新 endpoint
  - WAV はメモリ cache (5 分 TTL、disk 不使用、5MB 上限)

これにより Plan B-1 (rtc 抜き) で「ボタンが見えるけど押しても音が出ない」事故が完全に解消される。さらに [#189](https://github.com/gamasenninn/tealus/issues/189) と組み合わせて、**Aivis Cloud 高品質 TTS まで含めて rtc-server なしで動作**。OSS 採用者が rtc-server なしで Tealus を立ち上げても品質劣化なく完結。

### Changed

- **`window.confirm()` を自前モーダル (`useConfirm` フック) に全置換** ([#191](https://github.com/gamasenninn/tealus/issues/191))
  - Promise ベースの API: `const ok = await confirm({ body, okLabel, danger })`
  - ブラウザ native confirm が表示するホスト名露出を排除 (将来のマルチテナント SaaS 化への布石)
  - ESC でキャンセル / Enter で OK / overlay クリックでキャンセル / danger 時は cancel ボタンに初期 focus
  - 実装: Zustand `confirmStore` + 単一インスタンスの `<ConfirmModal />` を App ルートに mount
  - 置換 10 箇所: メッセージ削除 / 転送 / グループ退会 / メンバー除外 / Webhook 削除 / ポータル削除 / スタンプ・パック削除 / キャッシュクリア / ルーム既読化
- **aivis-cloud TTS 配信を mediasoup → Socket.IO blob に切替** ([#189](https://github.com/gamasenninn/tealus/issues/189))
  - agent-server が合成した WAV を server に POST → server が Socket.IO で room メンバーに URL 配布 → 各 client が `<audio>` で再生
  - **rtc-server 不要** で Aivis 高品質 TTS が動作 (Plan B-1 で品質劣化なし)
  - 合成と配信を分離 (synthesis: aivis-cloud/browser × delivery: socket.io blob/mediasoup)
  - エラー fallback: Aivis 合成失敗 / Socket.IO POST 失敗 → browser TTS に自動降格
- **Vite dev server の `allowedHosts` を環境変数経由化** (`VITE_ALLOWED_HOSTS`)
  - ハードコードされた DDNS ホスト名 4 件を `client/vite.config.js` から撤去 (OSS public repo として晒す情報ではないため)
  - default は任意 Host 許可 (dev server のみ、本番ビルドには無影響)、CSV 形式の env で許可リスト指定可能
  - `client/.env.example` に設定方法を追記。注: git history の旧 commits には残存 (新規参照を生まないことに重点)

### Removed

- agent-server の `rtcCapability` watcher (TTS が rtc 非依存になったため不要、[#189](https://github.com/gamasenninn/tealus/issues/189))
- agent-server の rtc-based dynamic degrade (aivis-cloud→browser by rtc 状態) — Aivis 合成 / Socket.IO 配信ベースの fallback に置換
- **TTS 受信用の transceiver 自動接続 / 自動切断ロジック** ([#190](https://github.com/gamasenninn/tealus/issues/190))
  - メッセージ送信時の自動 transceiver connect (`tryAutoConnectForTts`) 廃止
  - AI 応答後 30 秒の自動 disconnect timer 廃止
  - 関連する state machine (`autoConnected` / `autoConnectedRef` / `disconnectTimerRef`) 一掃
  - [#189](https://github.com/gamasenninn/tealus/issues/189) で TTS が Socket.IO blob 経由になったので、TTS 受信のために mediasoup に接続する必要が消滅
  - transceiver は手動 PTT (ヘッダーボタン) 専用に。`ttsReadAloud` の意味が「AI 応答を音声で読み上げる」だけに単純化
  - [#179](https://github.com/gamasenninn/tealus/issues/179) で fix した自動接続バグ自体が根絶 (バグの源そのものが消える)

### Fixed

- **migrate.js が 003 で停止する idempotency 問題を修正** ([#201](https://github.com/gamasenninn/tealus/issues/201))
  - `003_voice_message.sql` が `DROP & ADD CONSTRAINT` で既存 `stamp` 行 (111 件) の CHECK 違反を引き起こし、`node src/db/migrate.js` 全体が停止
  - 008 で stamp 対応の CHECK に拡張済だが、再実行時 003 → 008 の順で 003 が先に違反検出
  - DO BLOCK 化して **既存制約があれば skip** する形に書き換え (008 と同じパターン)
  - 全 21 migration が既存環境でも新規環境でも通過することを確認
  - Step 12 レポートで「未着手の技術的負債」として残置していた件
- **TTS 配信の WAV サイズ上限を 5MB → 10MB に引き上げ** ([#199](https://github.com/gamasenninn/tealus/issues/199) follow-up)
  - Light agent が `search_messages` 等の MCP tools で長文応答 (500-700 文字) を返すケースで Aivis WAV が 5MB を超えて MulterError 発生 → browser TTS にフォールバック
  - `server/src/routes/bot.js` の `TTS_AUDIO_MAX_SIZE` を 10MB に拡大
  - 600-700 文字程度の応答 (実測 7-8MB WAV) も Aivis 高品質音声で配信可能に
- **TTS 読み上げ音量に Web Audio API GainNode で 1.0 超のブースト適用** ([#198](https://github.com/gamasenninn/tealus/issues/198) follow-up)
  - 当初 `audio.volume × 1.25` で対処したが、HTML audio.volume の上限が 1.0 で実効ブースト不可だった (voiceVolume 80% 以上で頭打ち)
  - 解決: `client/src/services/ttsAudioPlayer.js` を新設、Web Audio API の `GainNode` を使って `audio.volume × TTS_VOLUME_BOOST (=2.0)` を適用 (1.0 超の amplification 可能)
  - 適用先: `useSocketSync.js` tts:audio (Aivis Cloud) / `TtsButton.jsx` (手動再生)
  - voiceVolume 80% 時、TTS 実効音量 = 0.8 × 2.0 = **1.6 倍** (audio element 単独 1.0 max の 60% 増)
  - Browser TTS (`SpeechSynthesisUtterance`) は仕様上 1.0 ハードキャップで boost 不可、現状維持
  - 録音音声 / トランシーバー / VoiceBubble は対象外 (loudness 差なし)
- **トランシーバー音量が `voiceVolume` 設定を無視していた** ([#198](https://github.com/gamasenninn/tealus/issues/198))
  - `useTransceiver.js` の consume() で audio element に音量未設定のまま再生していたため、default 1.0 (100%) で固定
  - 一方 TTS / 音声メッセージは `voiceVolume` (default 80%) を適用していたため、**トランシーバーだけ大きく聞こえる非対称** が発生
  - useTransceiver.js consume() で `audioEl.volume = voiceVolume / 100` を適用
  - これで Profile の音量スライダー 1 つで全音声経路 (TTS / 音声メッセージ / トランシーバー) が同期

## [0.1.0] - 2026-04-26

Tealus の初回公開リリース。

### TTS Provider 選択（#184）

- AI 音声応答の合成方式を `TTS_PROVIDER` 環境変数で選択可能に
  - `browser` (デフォルト): Web Speech API による各端末ローカル合成（API key 不要、ゼロ設定）
  - `aivis-cloud`: Aivis Cloud API + mediasoup PlainTransport（高品質）
  - `none`: TTS 完全無効
- 未設定時は `AIVIS_API_KEY` の有無で自動判定（既存ユーザーの動作は不変）
- 個人 TTS ボタン（メッセージ単位の 🔊）も provider に追従

### コアメッセンジャー

- 1 対 1 DM / グループチャット（リアルタイム送受信、Socket.IO）
- テキストメッセージ送信・編集・削除（論理削除）
- リプライ（引用返信）
- メッセージ転送（他ルームへ、Socket.IO で即時反映）
- 画像・動画・ファイルのアップロード（サーバー保存、サムネイル自動生成）
- 既読表示（トーク一覧: 未読数、トーク画面: 既読数）
- 絵文字リアクション（6 種類）
- メンション（@ユーザー名）
- メッセージ検索（全ルーム横断）
- Markdown プレビュー（見出し・リスト・コード・テーブル等）
- スタンプ（AI 生成、1 パック 16 枚）
- タグ機能（TODO タグ含む）

### AI エージェント統合

- 3 層エージェント構造（Router + Light + Deep）
- エージェントがチャットに参加して議論
- MCP Server（Tealus Bot API を MCP ツールとして公開）
- Deep Agent による長時間タスク・コード生成・Python 実行
- エージェント設定ダッシュボード（ルーム別 / グローバル）

### 音声・通話

- 音声メッセージ（録音・送信・再生）
- Whisper による文字起こし + AI 整形（GPT-4o-mini）
- 文字起こし編集 + バージョン履歴
- 音声通話・ビデオ通話（mediasoup SFU、グループ通話対応）
- トランシーバー（PTT、Push-to-Talk）
- AI 自動読み上げ（Aivis Cloud API、ルーム別音声モデル選択）
- 個人読み上げ（メッセージ単位の 🔊 ボタン）

### 認証・ユーザー管理

- ユーザー ID（login_id）+ パスワードログイン（JWT）
- ロール（admin / user）と Bot ユーザー区別
- プロフィール編集（表示名、アバター、ステータスメッセージ）
- 管理ダッシュボード（ユーザー CRUD、ルーム一覧）

### 統合・拡張

- Push 通知（PWA Service Worker + VAPID）
- Webhook（ルームイベント → 外部 URL 通知）
- ポータルリンク（管理者設定のリンク集）
- Web Share Target（スマホの共有先に Tealus を追加）
- tealus-cli（コマンドラインから送信・ファイル監視）

### UX

- LINE ライクな直感的吹き出し UI
- コンテキストメニュー（PC 右クリック / スマホ長押し）
- 日付区切り表示（スティッキー日付）
- カスタムテーマ・文字サイズ設定
- マルチトーク画面（PC PWA）
- PWA 対応（スマホ・PC ブラウザ、ホーム画面追加可）

### インフラ

- Docker Compose でワンコマンド起動（PostgreSQL + Redis）
- マイグレーションシステム（20 マイグレーション）
- PostgreSQL RLS（Row Level Security）有効
- GitHub Actions CI（4 ジョブ: server / client / dashboard / agent-server、合計 370+ テスト自動実行）
- Vitest + Jest + Supertest によるテスト環境

### ドキュメント・公開準備

- README（機能・セットアップ・スクリーンショット）
- デモ環境 seed スクリプト（`server/scripts/seed-demo.js`）
- `.github/` コミュニティファイル（ISSUE_TEMPLATE / PR_TEMPLATE / SECURITY / CODE_OF_CONDUCT / CONTRIBUTING）
- 公式ドキュメントサイト ([docs.tealus.dev](https://docs.tealus.dev))
- ランディングページ ([tealus.dev](https://tealus.dev))
- MIT ライセンス

### 公開直前の追加改善（v0.1.0 への統合）

OSS 公開準備の最終フェーズで実施した、採用者体験を磨く改善群:

- **ブラウザ TTS provider をデフォルト化**: API キー設定なしでも AI 音声応答を体験可能（[#184](https://github.com/gamasenninn/tealus/issues/184)）
- **client 設定の runtime fetch 化**: build 時 env (`VITE_*`) を全廃、`GET /api/config` で起動時取得 → **再ビルド不要**で設定変更反映
- **autoplay block の検出と解除 UI**: ブラウザの autoplay policy で audio.play() が reject されたとき「🔊 音声を有効化」ボタンを表示（iPhone 実機検証済み）
- **Deep agent の優雅な無効化**（[#186](https://github.com/gamasenninn/tealus/issues/186)）: `claude` CLI 不在環境では Light に silent fallback、`/deep` 明示時のみ説明メッセージ。Tier 1 (OPENAI のみ) / Tier 2 (+Claude MAX) 構造を確立
- **キャッチコピー確定**: 「人とAIのためのメッセンジャー」(Login 画面 + PWA manifest)
- **TTS 自動接続バグの完全 fix**（[#179](https://github.com/gamasenninn/tealus/issues/179)）: 'error' state からのリトライ許可 + 音声メッセージ送信経路でも発火
- **README 全面刷新**: 機能カテゴリ整理（差別化点 ★ 強調）、API 一覧拡張（30+ endpoint 追加）、Tealus MCP セクション新設、ディレクトリ構成更新、ロードマップ刷新、agent-server / rtc-server セットアップ手順追加、HTTPS 前提の Nginx 設定例
- **ドキュメントセキュリティ強化**: tealus-docs に shared な「セキュリティ記述ルール」を追加。default シークレット / 弱パスワード / 実在ドメインの例示を全面 placeholder 化
- **テストカバレッジ計測**: 4 リポ (server 213 / agent-server 151 / mcp-server 9 / client 1 file) で計測、コア logic 80-100% / 外周 5-30% の健全な分布を確認
- **diagnostic ログを config.js に集約**: TTS / Deep agent の resolved 値を起動時に出力 → トラブルシュート効率化

### 非対応 / 既知の制限

- TypeScript 未対応（v0.2.0 で導入予定、コントリビュータ誘致のため）
- バックグラウンドでの Push 通知が iOS で不安定な場合あり（[#168](https://github.com/gamasenninn/tealus/issues/168)）
- iOS Safari 以外の autoplay 挙動は実機未検証（fix 自体は実装済み）
- rtc-server と agent-server は同一モノリポ前提（相対 require を使用）
- mcp-server は npm publish 未実施（[#187](https://github.com/gamasenninn/tealus/issues/187) で対応予定）

[Unreleased]: https://github.com/gamasenninn/tealus/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/gamasenninn/tealus/releases/tag/v0.2.2
[0.2.1]: https://github.com/gamasenninn/tealus/releases/tag/v0.2.1
[0.2.0]: https://github.com/gamasenninn/tealus/releases/tag/v0.2.0
[0.1.0]: https://github.com/gamasenninn/tealus/releases/tag/v0.1.0
