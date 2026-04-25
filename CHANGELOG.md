# Changelog

すべての注目すべき変更はこのファイルに記録されます。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

`0.x` の間は API は不安定で、minor バージョンで破壊的変更が入ることがあります。
`1.0.0` 到達後は破壊的変更に major バージョンアップが必要です。

## [Unreleased]

### Changed

- **client 設定を runtime fetch 化**: client は build 時 env (`VITE_*`) を持たず、起動時に `GET /api/config` で取得する設計に変更（#184 follow-up）。
  - 真の情報源: `TTS_PROVIDER` は `agent-server/.env`、`VAPID_PUBLIC_KEY` は `server/.env`
  - server は内部で agent-server `/public-config` を proxy し、resolved な値を返す
  - 設定変更時の **client 再ビルドが不要**（OSS 採用者の体験向上）
  - agent-server 停止時は `tts_provider: 'browser'` に safe fallback

### Removed

- `VITE_TTS_PROVIDER` および `VITE_VAPID_PUBLIC_KEY` の build 時 env 参照を廃止
- `client/.env` は通常不要に（既存の `.env` は残置しても害なし）

## [0.1.0] - 2026-04-25

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
- メンション（@ユーザー / @all / @here）
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
- GitHub Actions CI（207 テスト自動実行、client/dashboard ビルド検証）
- Vitest + Jest + Supertest によるテスト環境

### ドキュメント・公開準備

- README（機能・セットアップ・スクリーンショット）
- デモ環境 seed スクリプト（`server/scripts/seed-demo.js`）
- `.github/` コミュニティファイル（ISSUE_TEMPLATE / PR_TEMPLATE / SECURITY / CODE_OF_CONDUCT / CONTRIBUTING）
- 公式ドキュメントサイト ([docs.tealus.dev](https://docs.tealus.dev))
- ランディングページ ([tealus.dev](https://tealus.dev))
- MIT ライセンス

### 非対応 / 既知の制限

- TypeScript 未対応（v0.2.0 で導入予定、コントリビュータ誘致のため）
- バックグラウンドでの Push 通知が iOS で不安定な場合あり（[#168](https://github.com/gamasenninn/tealus/issues/168)）
- TTS 自動読み上げ ON 時のトランシーバー自動接続が発火しないケース（[#179](https://github.com/gamasenninn/tealus/issues/179)）
- rtc-server と agent-server は同一モノリポ前提（相対 require を使用）

[Unreleased]: https://github.com/gamasenninn/tealus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gamasenninn/tealus/releases/tag/v0.1.0
