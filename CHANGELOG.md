# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

### Added

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
- **agent-server TTS の dynamic degrade**: aivis-cloud 選択中でも rtc-server 不可なら browser に自動降格、復活時は aivis に戻る
- `rtc-server/server.js` に `/health` endpoint 追加 (server / agent-server からの reachability 検出用)
- 環境変数 `RTC_HEALTH_INTERVAL` で poll 間隔を上書き可能 (default 30 秒)

これにより Plan B-1 (rtc 抜き) で「ボタンが見えるけど押しても音が出ない」事故が完全に解消される。OSS 採用者が rtc-server なしで Tealus を立ち上げても自然な体験を得られる。

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
