# Tealus へのコントリビュート

Tealus にコントリビュートしていただきありがとうございます。以下のガイドラインを参照してください。

## はじめる

### 環境構築

[README](./README.md) の「セットアップ」に従ってローカル環境を構築してください。

- Node.js 18+
- Docker / Docker Compose
- Git

### 設計書を読む

実装・変更の前に、以下の設計書に目を通してください:

- `docs/01_要件定義.md` — 背景・前提条件・フェーズ定義・技術スタック
- `docs/02_DB設計.md` — テーブル定義・ER 図・RLS 方針
- `docs/03_アーキテクチャ設計.md` — システム構成・データフロー

設計書の内容と矛盾する実装は避けてください。設計変更が必要な場合は、設計書を更新する PR を先に出すか、Issue で議論してください。

## 開発フロー

### TDD（テスト駆動開発）

本プロジェクトは **TDD で開発します**。実装の前にテストを書いてください。

```
Red (失敗するテストを書く) → Green (テストを通す最小限のコードを書く) → Refactor (整理する)
```

### テスト

| 種類 | 対象 | ツール |
|------|------|--------|
| ユニットテスト | 関数・ロジック | Jest（server） / Vitest（client） |
| 統合テスト | REST API | Jest + Supertest |
| WebSocket テスト | Socket.IO イベント | Jest + socket.io-client |
| DB テスト | クエリ・RLS | Jest + PostgreSQL |
| フロントテスト | コンポーネント・フック | Vitest + React Testing Library |

### テスト実行

```bash
# サーバーテスト（必ず npm test を使う — 並列実行で DB が衝突するため）
cd server
npm test

# 特定のテストのみ
npm test -- --testPathPattern="tags"

# クライアントテスト
cd client
npm test
```

**重要**: `npx jest` を直接使わないでください。`npm test` は `--runInBand`（逐次実行）が設定されており、並列実行時の DB セットアップ競合を回避します。

## ブランチ運用

- **Phase 1（現在）**: master 直コミット。小さな変更は直接コミット可
- **大規模変更・破壊的変更**: フィーチャーブランチを切って PR を出す
- **将来の複数人開発時**: 全変更をブランチ + PR 運用に切り替え予定

### ブランチ命名

- 機能追加: `feat/<短い説明>` または `feat/<issue-number>-<説明>`
- バグ修正: `fix/<短い説明>`
- リファクタ: `refactor/<短い説明>`
- ドキュメント: `docs/<短い説明>`

## コミットメッセージ

### フォーマット

```
#<issue-number> <種別>: <概要>

<詳細な説明。何を、なぜ変えたか>

Co-Authored-By: <共同作業者がいれば>
```

- Issue 番号は可能な限り付ける
- 種別: `feat`, `fix`, `refactor`, `docs`, `test`, `chore` など（必須ではない）
- 概要は 50 文字以内を目安に
- 本文は **「なぜ」** を重視。「何を」はコードと diff で見える

### 例

```
#166 メッセージ転送機能: コンテキストメニューから他ルームへ転送

- forwarded_from カラム追加（messages テーブル）
- 転送元メッセージのフォワードバブル表示
- 即時反映のため Socket.IO 経由で送信、REST フォールバック

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

## Pull Request

### 提出前チェックリスト

- [ ] `cd server && npm test` が全件パス
- [ ] 新機能・変更に対するテストを追加
- [ ] 設計書との整合を確認
- [ ] 環境変数を追加した場合、該当の `.env.example` を更新
- [ ] 破壊的変更がある場合、PR 本文で明記

### PR テンプレート

PR 作成時に [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) が自動で展開されます。

## コードスタイル

### JavaScript / React

- 関数・変数名は意味が伝わる命名
- コメントは **WHY**（なぜ）を書く。WHAT（何を）はコードで明らか
- マジックナンバーは定数化
- エラーハンドリングは境界でのみ（内部コードは framework guarantees を信頼）

### SQL

- マイグレーションは `IF NOT EXISTS` を使う（べき等性）
- 破壊的変更（DROP COLUMN 等）は事前に議論

### コミット単位

- 「1 コミット = 1 つの論理的な変更」を目指す
- 無関係な変更を混ぜない

## 質問・相談

- 仕様の不明点: [GitHub Discussions](https://github.com/gamasenninn/tealus/discussions)
- バグ報告: [Issue Tracker](https://github.com/gamasenninn/tealus/issues/new?template=bug_report.md)
- 機能提案: [Issue Tracker](https://github.com/gamasenninn/tealus/issues/new?template=feature_request.md)
- セキュリティ脆弱性: [SECURITY.md](./SECURITY.md)

## 行動規範

本プロジェクトは [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md) を採用しています。参加することで、この規範を遵守することに同意したものとみなします。

## ライセンス

コントリビュートされたコードは、プロジェクトのライセンス（[MIT](./LICENSE)）の下で公開されることに同意いただいたものとみなします。
