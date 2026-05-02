# Tealus Numbers (Fact Sheet、Phase 0 共通素材)

audience 別 Full pitch / LP / 短尺資料すべてで引用される **客観数字**。pitch の「**Tealus は本物**」を支える証拠。

最終更新: 2026-04-30 (Step 14 終了直後)

---

## 機能 / プロダクト規模

| 指標 | 数 | 備考 |
|---|---:|---|
| MCP tools | **11** | tealus-mcp v0.6.0、Light/Deep agent 両対応 |
| Phase 達成 | **1-4** | Phase 5 (感謝経済) は vision、未着手 |
| Bot API endpoints | **20+** | server/src/routes/bot.js |
| DB migrations | **21** | Phase 1-4 の累積、すべて idempotent |
| 対応 OS / 環境 | NAS (Synology / QNAP / UGREEN) / Linux / Mac mini / Windows | Docker compose で起動 |
| サポート audio engine | OpenAI Whisper + Aivis (TTS) | カスタマイズ機構あり |

## コードベース規模

| 指標 | 数 |
|---:|:---:|
| GitHub issues 総数 (open + closed) | **209** (#1〜#209、closed 含む) |
| 自動テスト数 | **502+** (server 310 + agent-server 158 + tealus-mcp 34) |
| GitHub Actions CI | **4 jobs** all green (client-build / dashboard-build / server-test / agent-server-test) |
| project の commit 数 (累積) | 推定 **600+** (詳細は git log) |
| 開発期間 | 2026-04 〜 (現役、active development) |

## 開発の透明性

| 指標 | 数 / 状況 |
|---|---|
| **公開評価レポート** | **Phase 4 Step 4-14 まで 14 本** (`report/` 配下、内部報告だが project の自己批判履歴) |
| **公式 docs** | https://docs.tealus.dev (MkDocs、`mkdocs build --strict` warning ゼロ) |
| **設計書** | `docs/01_要件定義.md` / `02_DB設計.md` / `03_アーキテクチャ設計.md` (project 内 commit 済) |
| **CHANGELOG** | Keep a Changelog 形式、毎 commit に追従 |
| **Issue tracker** | open / closed 議論記録、philosophy 議論も含む |
| **handoff doc 文化** | AI 班間で構造化された引き継ぎ書を post する運用 ([#202](https://github.com/gamasenninn/tealus/issues/202)) |

## v0.1.x マイルストーン (Step 11-14、2026-04-26 〜 04-29)

| 期間 | 主要成果 |
|---|---|
| Step 11 (4/26) | Docker 化 (Phase A 完了)、TTS 配信切替、tealus-mcp 独立 repo 化 |
| Step 12 (4/27→4/28) | UI 整流 + MCP エコシステム拡張 (5 issue close、3 新 MCP tool 構想)、22 時間連続セッション |
| Step 13 (4/28) | AI 協業基盤の制度化 (AI 班連絡ルーム、handoff doc、tealus-docs Issue #7 完走) |
| Step 14 (4/29) | voice transcription pipeline カスタマイズ + 自己進化辞書、469 件のノイズ整理、create_room/delete_room、CI green |

**4 日間で 14 issue close、11 MCP tools 完成、500+ test green、umbrella #185 卒業。**

## 自己進化サイクル (実機実証済)

| 局面 | 数字 |
|---|---:|
| 初回 mining (Step 14 朝) | 4424 行 / 62 編集ペア / **8 alias 発見** |
| 2 回目 mining (--since=今日) | 18 行 / 4 編集ペア / **5 alias 抽出** |
| by-term mode (#208) | **同データから 28 件 (9.3 倍)** の alias を発見 |
| 結果 vocabulary 累積 | 0 → **37** (組織固有 alias) |
| guidelines 累積 | 0 → **9** (誤転写・正規化ルール) |

**「使うほど賢くなる」が **抽象** ではなく **実測** で確認された。**

## バルク data ops (Step 14 で実施)

| 内容 | 件数 |
|---|---:|
| トランシーバー履歴ルームのノイズ削除 | **474 件** (TV/動画 BGM 由来の Whisper 誤転写) |
| Phase A (純粋ノイズ → 空文字) | 368 |
| Phase B (末尾混在 → 業務発話保持で末尾トリム) | 36 |
| Phase A 補完 (variants / no period) | 65 |
| 個別 alias テスト編集 | 11 |

検索品質: **formatted_text のノイズパターン残存 = 0** (主要 4 種すべてクリア)。

## OSS としての配布

| 項目 | 状況 |
|---|---|
| GitHub repository | https://github.com/gamasenninn/tealus (public) |
| ライセンス | MIT (本体)、tealus-mcp も MIT |
| 副 repo | tealus-mcp (https://github.com/gamasenninn/tealus-mcp、v0.6.0)、tealus-docs (公式 docs) |
| Docker image 配布 | Phase A まで (local build、Phase B で GHCR 予定) |
| Docker compose | `docker-compose.yml` (dev) / `docker-compose.full.yml` (NAS) / `docker-compose.rtc.yml` (rtc-server) |
| 採用最低スペック | x86_64 / arm64 NAS、メモリ **4 GB 以上**、ディスク **50 GB 以上**、Docker 対応 OS (実測根拠: PostgreSQL 256-500 MB + Redis 100-200 MB + Node server 200-400 MB + agent-server 200-400 MB + mediasoup 200-500 MB + OS/Docker 500 MB-1 GB → アイドル 1.5-2.5 GB、RTC アクティブで 2-3.5 GB、30 ユーザで 4-5 GB ピーク) |

## 主要技術 stack

| 層 | 技術 |
|---|---|
| Frontend | React + Vite、PWA、Service Worker、Web Push |
| Backend | Node.js (Express)、Socket.IO、PostgreSQL (RLS)、Redis |
| AI | OpenAI Whisper (転写) + gpt-4o-mini (整形) + Claude Code CLI (Deep agent) + OpenAI Agents SDK (Light agent) |
| MCP | @modelcontextprotocol/sdk v1+、tealus-mcp v0.6.0 |
| 通話 | mediasoup SFU (rtc-server)、PlainTransport (TTS 配信) |
| Search | pg_trgm + GIN index (3 文字以上 query で 70-80x speedup) |

## 「ここまでで一区切り」の signal

- ✅ MCP エコシステム 11 ツール完成 (Step 14、2026-04-29)
- ✅ umbrella #185 卒業 (initial concept から派生実装 8 件で達成、close 済)
- ✅ self-improving cycle 実機実証 (#206 Phase 1 + #208 by-term mode で 9.3 倍効率向上)
- ✅ CI all green (4/4 jobs)、502+ test pass
- ✅ docs (`tealus-docs`) v0.1.x 完全追従 (Issue #7 Phase 1/2/3 全 commit)

→ **次は外部発信フェーズ** (本 issue #209)。

---

## 改訂履歴

- 2026-04-30 v1: Step 14 終了時点の数字を集約。次回更新は v0.1.1 release 後。
