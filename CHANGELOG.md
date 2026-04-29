# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

### Added

- **MCP `create_room` ツール (tealus-mcp v0.5.0)** ([#200](https://github.com/gamasenninn/tealus/issues/200))
  - AI が新しいグループルームを能動的に作成できる primitive。呼び出した bot は admin として自動追加
  - 既存 `POST /api/rooms` を流用 (Bot 認証 = JWT で呼び出し可)、本体 repo 側に server コード変更なし
  - `tealus-mcp` v0.5.0 release、合計 9 → 10 MCP ツール
  - 用途: AI 班連絡用ルーム / 議題スレッド / 期間限定タスク / インシデント対応など、AI が組織を能動的に編成する場面
  - 起点: 2026-04-28 の AI 班連絡ルーム開設時、curl + Bash 直叩きで作成した経験 (Bash の CP932 エンコード問題で日本語ルーム名が文字化けした) を MCP 化することで解消
  - tealus-mcp 側 unit test 6 件追加 (23 → 29 件 全 pass)
- **transcription guideline の自動学習 — Phase 1: batch mining script** ([#206](https://github.com/gamasenninn/tealus/issues/206))
  - `server/scripts/mine_transcription_aliases.js` 新設: voice_transcriptions の編集履歴 (AI 版 vs. 人間訂正版) から alias 候補を mining する CLI
  - GPT-4o-mini に編集ペアを投げて (誤転写, 正解) の固有名詞ペアを抽出。整形差・句読点差は GPT が自然に弾く
  - 出現回数集計 + 閾値フィルタ (default N=2)、既存 transcription_guideline.json の vocabulary と照合して merge 候補 (新規 term / 既存 term への alias 追加) を生成
  - 出力は report ファイル (`server/config/mining_report.json`、gitignored)。**既存 guideline は書き換えない** — 人間が report を見て手動 merge
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

### Added

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

### Added

- `TTS_BROADCAST_MEDIASOUP=true` env で legacy mediasoup TTS 配信も並走可能に ([#189](https://github.com/gamasenninn/tealus/issues/189))
  - transceiver gateway 受信機 (mediasoup PlainTransport を listen する専用 hardware) を運用する環境向け
  - default false (mediasoup 不要、Socket.IO のみで完結)
- `POST /api/bot/tts-audio` + `GET /api/bot/tts-audio/:id` 新 endpoint
  - WAV はメモリ cache (5 分 TTL、disk 不使用、5MB 上限)
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

これにより Plan B-1 (rtc 抜き) で「ボタンが見えるけど押しても音が出ない」事故が完全に解消される。さらに [#189](https://github.com/gamasenninn/tealus/issues/189) と組み合わせて、**Aivis Cloud 高品質 TTS まで含めて rtc-server なしで動作**。OSS 採用者が rtc-server なしで Tealus を立ち上げても品質劣化なく完結。

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

[Unreleased]: https://github.com/gamasenninn/tealus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gamasenninn/tealus/releases/tag/v0.1.0
