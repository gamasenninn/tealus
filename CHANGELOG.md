# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

### Fixed

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

- **client: mention @ 入力時の member 一覧が尻切れ** ([#242](https://github.com/gamasenninn/tealus/issues/242))
  - `MentionPicker.css` の `max-height: 200px` 固定で 5-6 人しか表示できず、scroll bar が default styling で気付きにくく「尻切れ」体感
  - Fix: `max-height: min(400px, 50vh)` で viewport-relative + thin scrollbar 常時表示で overflow 視覚化
  - メンバー多 room では PC 400px / mobile 50vh、少 room では auto で空白なし
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
