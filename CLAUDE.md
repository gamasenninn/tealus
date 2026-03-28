# Linny - プロジェクト指針

## プロジェクト概要

社内LINE代替メッセンジャー「Linny」。PWA + Node.js + PostgreSQL構成。

## 設計書

実装・修正・議論の際は、必ず以下の設計書を参照すること：

- `docs/01_要件定義.md` — 背景・前提条件・フェーズ定義・技術スタック
- `docs/02_DB設計.md` — テーブル定義・ER図・RLS方針・既読の動作仕様
- `docs/03_アーキテクチャ設計.md` — システム構成図・データフロー・ディレクトリ構成

設計書の内容と矛盾する実装をしないこと。設計変更が必要な場合は、まず設計書を更新してから実装に反映する。

## 技術スタック

- フロントエンド: React + Vite (PWA)
- バックエンド: Node.js (Express) + Socket.IO
- DB: PostgreSQL (RLS有効)
- キャッシュ: Redis
- コンテナ: Docker Compose

## 開発ルール

- Phase 1 (MVP) の機能を優先する
- LINEの完全コピーではなく、LINEライクな操作感を目指す
- AI連携（Python）はPhase 3で別モジュールとして追加。Phase 1ではNode.js一本

## TDD（テスト駆動開発）

本プロジェクトはTDDで開発する。実装の手順は必ず以下に従うこと：

### Red → Green → Refactor サイクル

1. **Red** — まず失敗するテストを書く
2. **Green** — テストを通す最小限のコードを書く
3. **Refactor** — テストが通る状態を保ちながらコードを整理する

### テストの種類と対象

| 種類 | 対象 | ツール |
|------|------|--------|
| ユニットテスト | 個々の関数・ロジック | Jest |
| 統合テスト | REST API エンドポイント | Jest + Supertest |
| WebSocketテスト | Socket.IOイベントの送受信 | Jest + socket.io-client |
| DBテスト | クエリ・RLSポリシー | Jest + テスト用PostgreSQL |
| フロントテスト | コンポーネント・hooks | Vitest + React Testing Library |

### テスト構成

```
server/
├── src/
└── __tests__/
    ├── unit/           # ユニットテスト
    ├── integration/    # REST API統合テスト
    ├── socket/         # WebSocketテスト
    └── helpers/        # テストユーティリティ（DB接続・テストデータ等）

client/
├── src/
└── __tests__/
    ├── components/     # コンポーネントテスト
    └── hooks/          # カスタムフックテスト
```

### ルール

- 新機能は必ずテストを先に書いてから実装する
- テストなしのコードをマージしない
- テストDBはDocker Composeで専用インスタンスを用意する
- テスト実行時はテスト用の環境変数（.env.test）を使う

## Git運用

- Phase 1はブランチなし（master直接コミット）
- コミットはStep単位で細かく刻む（Issue番号付き）
- Phase 2以降、複数人開発になったらブランチ運用に切り替える

## GitHub Issue運用

- Phase 1の各StepをIssue #1〜#9で管理している
- コミットメッセージにはIssue番号を含める（例: `#1 Docker Compose設定を追加`）
- 実装の節目ごとにIssueにコメントを残すこと：
  - 何を実装/変更したか
  - なぜその判断をしたか（設計上の理由、トレードオフ）
  - 詰まった点や注意点があれば記録
  - テスト結果のサマリ
- Issueのタスクチェックリストは完了したら都度チェックを入れる
- 全タスク完了後にIssueをcloseする
