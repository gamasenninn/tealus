# Tealus - プロジェクト指針

## プロジェクト概要

社内LINE代替メッセンジャー「Tealus」。PWA + Node.js + PostgreSQL構成。

## 設計書

実装・修正・議論の際は、必ず以下の設計書を参照すること：

- `docs/01_要件定義.md` — 背景・前提条件・フェーズ定義・技術スタック
- `docs/02_DB設計.md` — テーブル定義・ER図・RLS方針・既読の動作仕様
- `docs/03_アーキテクチャ設計.md` — システム構成図・データフロー・ディレクトリ構成
- `docs/05_実装ノート_不変条件と落とし穴.md` — **触ると壊れる非自明な約束事の索引** (ESM import 巻き上げ / テストの TDZ・machine 非依存 / io-registry / JWT guard 等)。テスト・起動・CI 周りを触る前に該当項を読むこと
- `docs/06_ルームトリガー設計.md` — 条件が満たされたら定型メッセージを投稿する仕組み (#382)。**作らないものを明示している**ので、拡張を提案する前に §9 を読むこと
- `docs/07_投稿経路と付随処理.md` — メッセージを作る 18 か所と、付随処理 4 つ (socket 配信 / プッシュ / AI 通知 / リンクプレビュー) の有無の地図 (#383)。**「AI が起動しない」「通知が飛ばない」を調べる前にここを引くこと** (grep で組み立て直すと結論が毎回変わる)
- `docs/08_会話モード設計.md` — 組織記憶に入れないための入口 (#389、設計のみ)。**目的は「声で話せること」ではない**ので §1.2 を先に読むこと (昇格が無いなら作らない、が成立条件)。**「音声を速くする」話を始める前に §2 の実測と §6.0 を読むこと** (律速は音声でなく毎ターンの文脈量。速さを後回しにできるのは主用途を壁打ちに置いたからで、雑談に戻すと判断が崩れる)
- `docs/tealus_voice_ui_wireframe.md` — 音声メッセージの UI 設計。「まず話そう、整えるのはあとでいい」の原則はここ。**その原則が会話では効かない**理由は `08` §6.1

設計書の内容と矛盾する実装をしないこと。設計変更が必要な場合は、まず設計書を更新してから実装に反映する。

## Claude Code skill の書き方

このプロジェクトで `/<name>` slash command (custom skill) を作る時は **`.claude/skills/<name>/SKILL.md`** (ディレクトリ構造) で配置すること。flat `.md` file (`.claude/skills/<name>.md`) は読み込まれない。詳細仕様 / トラブルシューティングは [`docs/claude-code-skills.md`](docs/claude-code-skills.md) 参照。

## ★ このディレクトリには tealus MCP が 2 本ある (#392)

本体班とサポート班は**同じリポジトリを別の角度で見る**ため、同じディレクトリから動く。
MCP のアカウント設定はディレクトリ単位なので、**サーバを 2 本置いて役割で使い分ける**。

| 役割 | cc project | 使う MCP | 投稿時の表示名 |
|------|-----------|---------|--------------|
| 本体班 | `tealus` | `mcp__tealus__*` | Claude |
| サポート班 | `support` | **`mcp__tealus-support__*`** | サポート班 |

**自分の `project_name` に対応する方を使うこと。**
間違えても投稿は成功するが、**部屋には別の班の名前で出る**。

★ **cc-queue の設定は役割別に分けてある** (2026-08-28)。`.claude/cc-tealus.json` は**置かない**:

```
.claude/cc-tealus.tealus.json    本体班    → /listen-tealus tealus
.claude/cc-tealus.support.json   サポート班 → /listen-tealus support
```

**役割を引数で指定する。** 引数なしで起動すると skill は 2 つ見つけて止まり、user に聞く
(既定を選ばない)。単一の `cc-tealus.json` を置き直すと、また片方の班が黙って
別の班の queue を監視する状態に戻るので、**戻さないこと**。

★ **投稿側 (MCP) の間違いは部屋のメンバーシップ (403) で気づけるが、受信側 (queue) は静かに外れる。**
2026-08-20〜08-28 に `support` のまま 8 日間放置され、本体班のセッションが
`@cc-tealus` を受け取れていなかった (未処理 5 件が滞留)。**「未処理 0 件」は正常の証拠にならない。**

★ **これは規約であって、構造で強制されていない。** 分離の本来の形は
Phronesis のようにディレクトリごと分けることだが、**サポート班は本体リポジトリを
直接読めることが仕事の価値**なので、別チェックアウト (worktree) にはしない判断をした。
経緯と他班の分離状況は [#392](https://github.com/gamasenninn/tealus/issues/392)。

★ **定義は `~/.claude.json` の `projects["C:\app\tealus"].mcpServers` に置くこと。`.mcp.json` に書いても読まれない。**
2026-08-25 に `.mcp.json` へ `tealus-support` を置いたが、**サーバ名すら出てこなかった**。実測:

```
C:/app/tealus          local mcpServers=["tealus", ...] (空でない)  → ★ .mcp.json 無効
C:/app/tealus-organon  local mcpServers=["tealus"]                  → ★ .mcp.json 無効
C:/app/tealus-apps     local mcpServers=[]                          → .mcp.json 有効
C:/app/tealus-site     local mcpServers=[]                          → .mcp.json 有効
```

**4 件とも `enabledMcpjsonServers` は空**なので、「未承認だから読まれない」では apps / site が説明できない。
相関しているのは **local scope の `mcpServers` が空でないこと**。機構は未確認なので、**このディレクトリでは
`~/.claude.json` 側に置く**を約束事として守る (`.mcp.json` を置いても静かに無視される = 気づけない)。

★ MCP は **Claude Code の起動時に解決される**。設定を変えたら**フル再起動**が要る (in-app の reload では
stdio の子プロセスが生き残るので不十分)。

★ `.mcp.json` は gitignore 済み (env に平文の資格情報が入る。この repo は PUBLIC)。

## 技術スタック

- 言語: TypeScript (全レイヤー、strict / ESM)。サーバは Node 24 native type stripping でビルドレス実行 (`node src/app.mts`)、クライアントは Vite。JS→TS 全面移行は #330 で完了 (`engines: node >=24`)
- フロントエンド: React + Vite (PWA、TS)
- バックエンド: Node.js (Express) + Socket.IO + TypeScript
- DB: PostgreSQL (RLS有効)
- キャッシュ: Redis
- コンテナ: Docker Compose
- テスト: サーバ/agent-server は Jest + @swc/jest (型検査は `tsc --noEmit` に分離)、クライアント/dashboard は Vitest

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

### テスト実行方法

```bash
# サーバーテスト（必ず npm test を使う）
cd server
npm test              # 全テスト（--runInBand --forceExit 付き）

# 特定テストのみ
npm test -- --testPathPattern="tags"
npm test -- --testPathPattern="search"
```

**重要: `npx jest` を直接実行しない。** テストスイートが並列実行されると DB セットアップが競合し `pg_type_typname_nsp_index` エラーが発生する。`npm test` は `--runInBand`（逐次実行）が設定されており、この問題を回避する。

### ルール

- 新機能は必ずテストを先に書いてから実装する
- テストなしのコードをマージしない
- テストDBはDocker Composeで専用インスタンスを用意する
- テスト実行時はテスト用の環境変数（.env.test）を使う

## Git運用

- Phase 1はブランチなし（main直接コミット）
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
