---
marp: true
theme: default
paginate: true
header: 'Tealus — 人と AI が同じテーブルで働く社内 messenger'
footer: '2026 / OSS / MIT License'
---

<!--
Full Pitch: OSS 採用検討者向け (Audience 1)
想定尺: 30-45 分 (本編 35 分 + Q&A 10 分)
想定 audience: 個人開発者、SMB の技術者 (CTO / アーキテクト含む)、社内 IT 担当
想定場面: tech meetup / 採用説明会 / プライベート紹介
スライド構成: ~45 slides

引用元 (Phase 0 共通素材):
- elevator-pitches.md (主軸メッセージ)
- philosophy.md (Section 1-2 の思想)
- numbers.md (Section 8 の数字)
- architecture-summary.md (Section 4 のアーキ)
- demo-scenarios.md (Section 3 の Demo)
-->

# Tealus

## 人と AI が同じテーブルで働く社内 messenger

### Docker 1 台で NAS にデプロイ、OSS、自社運用可能

<!--
[スピーカーノート]
最初の 5 秒で「Tealus とは何か」を渡す。
- 「人と AI」: 既存 messenger は人 vs 人、Tealus は **対等な混合チーム**
- 「同じテーブル」: 別レイヤーではなく、同じ messenger に並んで働く
- 「自社の NAS で動く」: SaaS ではなく、データは手元
- 「OSS」: 透明、自分達でいじれる、信頼

Audience の関心軸 = 「自社で運用できる、AI 標準装備の messenger」
-->

---

## 自己紹介と項目

- Tealus = OSS の社内 messenger
- 設計起点: **AI ネイティブ + 自社運用 + Self-improving**
- 開発期間: 2026-04 〜 (active development)
- v0.1.0 公開: 2026-04-26
- 本日時点 (2026-04-30): v0.1.x マイルストーン進行中

### 今日のお話 (35 min)

1. なぜ Tealus が必要か (5 min)
2. Tealus の 4 つの設計柱 (5 min)
3. **Demo** (10 min)
4. アーキテクチャ (4 min)
5. 競合比較 (3 min)
6. 採用方法とコスト (4 min)
7. Roadmap (2 min)
8. 数字と透明性 (2 min)

---

# 1. なぜ Tealus が必要か

---

## 既存社内 messenger の 3 つの限界

| | LINE WORKS / LINE | Slack / Teams | Mattermost / Rocket.Chat |
|---|:---:|:---:|:---:|
| データ主権 | ❌ | △ | ✅ |
| AI ネイティブ設計 | ❌ | △ (後付け bot) | ❌ |
| 使うほど賢くなる | ❌ | ❌ | ❌ |

→ **どれかが必ず欠けている**

---

## 限界 1: データ主権の不在

- 業務メモ、音声、議論はすべて **SaaS のサーバー上**
- AI 連携も「**SaaS が AI に渡す**」形式
- 自社のデータが学習素材になる構造から逃げられない
- SaaS が outage、ポリシー変更、値上げした時、止まる

**自社のデータは自社で持ちたい**

---

## 限界 2: AI が後付け

- 既存 messenger は **人と人のコミュニケーション**のために設計
- AI は **bot として接続される後付けの存在**
- 設計の最初から AI を考慮していない
- AI と人が対等に働く設計にはなっていない

**AI ネイティブな messenger が必要**

---

## 限界 3: 進化が買い替え依存

- 既存 messenger は **使い込むほど蓄積するが、賢くなりはしない**
- タグ付け、整理、議事録は手動
- AI 連携も「便利だが永続的に賢くなる」構造を持たない
- 「賢く」したいなら別 SaaS、別 tool、別 messenger に乗り換え

**使うほど成長する messenger が欲しい**

---

# 2. Tealus の 4 つの設計柱

---

## 4 つの柱

```
柱 1: Self-hosted   (データ主権)
柱 2: AI-Native     (AI と人の対等)
柱 3: Self-Improving (使うほど賢くなる)
柱 4: Phased Evolution (Phase 1-5 の連続進化)
```

これらが **同時に揃っている** messenger は他にない。

---

## 柱 1: Self-hosted (データ主権)

- **自社の NAS / Linux / Mac で動く**
- Docker compose 1 コマンド (`docker-compose -f docker-compose.full.yml up`)
- 対応: Synology / QNAP / UGREEN / 一般 Linux / Mac mini
- メッセージ・音声・AI 連携すべて手元で完結
- SaaS に依存しない、SaaS の outage で止まらない

---

## 柱 2: AI-Native

- 設計の最初から **AI を前提**
- MCP (Model Context Protocol) で **11 ツール** が統一 interface
- **Light agent** (gpt-4o-mini) と **Deep agent** (Claude Code) 両方統合
- 業務メモは **AI の組織記憶**、過去議論を AI が引ける
- AI が組織を能動的に編成 (`create_room` / `delete_room`)

→ **AI が「対等なメンバー」として messenger 内で働く**

---

## 柱 3: Self-Improving (使うほど賢くなる)

- 文字起こしの編集履歴 = **無料のラベル付き訓練データ**
- AI が編集ペアから **組織固有 alias** を自動学習
- vocabulary / guidelines は外部 JSON、組織ごとに自然進化
- 「使うほど」が **抽象**ではなく **実測**で確認 (9.3 倍効率)

→ **時間とともに organization-specific に育つ**

---

## 柱 4: Phased Evolution

```
Phase 1: 人と人がメッセージを交換する
Phase 2: より豊かに (スタンプ、音声、リアクション、文字起こし)
Phase 3: AI が対等なメンバーとして参加する
Phase 4: 声で繋がる (通話、トランシーバー、TTS)
Phase 5: 感謝を交換する (感謝経済、ブロックチェーン token)
```

各 Phase は **同じ messenger / 同じ DB / 同じ思想**で連続。
→ 買い替えではなく **1 つの project が成長**する。

---

# 3. Demo

## Scenario: 業務無線 → AI 文字起こし → 検索 → 自動学習

---

## Setup

- 農機販売店の業務メモルーム
- 過去 1 ヶ月の業務無線が文字起こし済
- vocabulary 37 件、guidelines 9 件 (Step 14 まで蓄積)

---

## Phase 1: 録音 (live)

🎤 「**ガマさん、ビレッジ側の田植機を取りに来てください**」

```
[業務メモ ルーム]
12:34:59 [小野] 🎤 voice
            "カナさん、ヴィレッジ側のタウン駅を取りに来てください"
                ↑ raw_text (Whisper の素直な転写)
            ↓ ~5秒 AI 整形
            "ガマさん、ビレッジ側の田植機を取りに来てください"
                ↑ formatted_text (vocabulary 適用後)
```

---

## Phase 2: vocabulary なし vs あり

| | Whisper raw_text | AI 整形 formatted_text |
|---|---|---|
| 人名 | カナさん ← 誤認 | ガマさん |
| 地名 | ヴィレッジ側 | ビレッジ側 |
| 機材 | タウン駅 ← 完全に外す | 田植機 |

**Whisper は汎用、Tealus は組織固有 vocabulary で正規化**

---

## Phase 3: 検索 (search_messages MCP)

```
> @tealus search_messages q="田植機" since="2026-04-01"

→ 30+ 件の発話、すべて formatted_text で正規化された
   「田植機」でヒット、snippet ハイライト付き
```

vocabulary なしだと「タウン駅」「耐雨機」「タオル液」等で散らばって、
**検索しても引けない**。

---

## Phase 4: 自動学習サイクル

```
1. 新誤転写: 「タウン液」 (Whisper の新ブレ)
2. user が手動編集 → 「田植機」に修正
3. 編集履歴が voice_transcriptions に記録
4. mining script (--mode=by-term) で自動発見
5. vocabulary に追加
6. 次回から「タウン液」も自動正規化
```

→ **編集 = 訓練データ、organization が messenger を育てる**

---

## Phase 5: 1 年後

- vocabulary は数百件、guidelines は数十件まで成長
- 組織の独自語彙が **辞書として永続化**
- 新人が入っても、**先輩の語彙を AI が記憶**
- 「**人と AI の混合チーム OS**」の core

---

# 4. アーキテクチャ

---

## システム構成

```
[PWA (React)] ──── [Nginx] ──── [Node.js (Express + Socket.IO)]
                                         │
                ┌───────────┬─────────────┼─────────┐
                ▼           ▼             ▼         ▼
          [PostgreSQL]  [Redis]    [OpenAI API] [Aivis (TTS)]
                                  Whisper, gpt-4o-mini
                                         │
              ┌──────────────────────────┼─────────────┐
              ▼                          ▼             ▼
       [Light Agent]              [Deep Agent]   [tealus-mcp]
       (agent-server)             (Claude Code)  11 MCP tools
```

**標準 web stack に AI / MCP を統合した clean な構成**

---

## 技術 stack — 「特殊技術ゼロ」

| 層 | 技術 |
|---|---|
| Frontend | **React + Vite**、PWA、Service Worker |
| Backend | **Node.js (Express + Socket.IO)** |
| Database | **PostgreSQL** (RLS で行単位制御) |
| Cache | **Redis** (WebSocket Pub/Sub、在席状態) |
| AI | **OpenAI API** + Claude Code + MCP |
| Deploy | **Docker** (NAS / Linux / Mac) |
| 通話 (任意) | **mediasoup SFU** |

→ **OSS 採用者が手元で動かしやすい、自社改造もしやすい**

---

## Docker 構成 (3 種)

| compose | 起動内容 | 用途 |
|---|---|---|
| `docker-compose.yml` | Postgres + Redis のみ | 開発者環境 |
| **`docker-compose.full.yml`** | + Node サービス全部 | **NAS / 本番採用者** |
| `docker-compose.rtc.yml` | + rtc-server (mediasoup) | 通話まで含む完全構成 |

**1 ファイル paste & build** で立ち上がる、NAS UI 親和性◎

---

## MCP エコシステム (11 ツール)

```
Read tools:        Write tools:
- send_message     - mark_tag_done
- send_image       - create_room
- get_messages     - delete_room
- get_message_media
- list_rooms       Other:
- search_messages  - join_room
                   - mark_read
```

**`npx -y github:gamasenninn/tealus-mcp`** 1 行で導入。
Light/Deep agent 両対応。

---

# 5. 競合比較

---

## 機能比較表

| 観点 | LINE WORKS | Slack / Teams | Discord | Mattermost | **Tealus** |
|---|:---:|:---:|:---:|:---:|:---:|
| 自社運用 | ❌ | △ (Enterprise) | ❌ | ✅ | **✅** |
| AI ネイティブ設計 | ❌ | △ (後付け) | ❌ | ❌ | **✅** |
| AI と人の対等性 | ❌ | ❌ | ❌ | ❌ | **✅** |
| 使うほど賢くなる | ❌ | ❌ | ❌ | ❌ | **✅** |
| 業務無線統合 | ❌ | ❌ | ❌ | ❌ | **✅** |
| Phase 1-5 連続設計 | ❌ | ❌ | ❌ | ❌ | **✅** |
| OSS | ❌ | ❌ | ❌ | ✅ | **✅** |

→ **Tealus は「△」が一つも無い** = 同時達成は他に存在しない

---

## 採用判断軸別の優位性

### Mattermost を検討した人へ
- 自社運用 OSS なら Mattermost と並列 → **AI ネイティブ + Self-improving** が Tealus 優位

### Slack の AI 機能を検討した人へ
- AI 後付けで満足するなら Slack でも → **データ主権 + 自社運用** が Tealus 優位

### LINE / LINE WORKS で困っている人へ
- 業務効率化したいなら → **すべての軸**で Tealus 優位

---

# 6. 採用方法とコスト

---

## 導入手順 (~30 分)

```bash
# 1. clone
git clone https://github.com/gamasenninn/tealus

# 2. .env 設定 (PostgreSQL / Redis / OpenAI API key)
cp server/.env.example server/.env
vim server/.env

# 3. NAS / Linux / Mac で立ち上げ
docker-compose -f docker-compose.full.yml up -d

# 4. Claude Code から MCP 統合
npx -y github:gamasenninn/tealus-mcp

# 完了
```

---

## 必要環境

| 項目 | 最低 | 推奨 |
|---|---|---|
| OS | Linux / Mac / NAS | NAS (Synology / QNAP) |
| メモリ | **4 GB** | **8 GB+** |
| ディスク | **50 GB** | **1 TB+** (50 ユーザ × 3 年メディア蓄積想定) |
| ネット | 100 Mbps | 1 Gbps |
| API key | OpenAI (任意) | OpenAI + Aivis (TTS) |

---

## コスト感 (SMB 規模、月額)

| 項目 | コスト |
|---|---|
| NAS 電気代 | ~500 円 |
| OpenAI API (Whisper + gpt-4o-mini) | ~1,000-2,000 円 |
| Aivis (任意、TTS) | ~500-1,000 円 |
| **合計** | **~1,500-3,500 円/月** |

vs Slack 有料プラン: **1,000 円/user × 10 user = 月 10,000 円**

→ **3-7 倍安い**、しかも **全機能フル** (実数: 10,000 / 1,500 = 6.67 倍 〜 10,000 / 3,500 = 2.86 倍)

---

## tealus-mcp 統合例 (Claude Code)

```json
{
  "mcpServers": {
    "tealus": {
      "command": "npx",
      "args": ["-y", "github:gamasenninn/tealus-mcp"],
      "env": {
        "TEALUS_API_URL": "https://your-tealus.example.com",
        "TEALUS_USER_ID": "AI_BOT",
        "TEALUS_PASSWORD": "..."
      }
    }
  }
}
```

→ **Claude Code が Tealus の 11 ツールをすべて使える**

---

# 7. Roadmap

---

## 現状 (v0.1.x、active development)

- ✅ Phase 1-4 完了 (messenger 基本 + AI + 通話)
- ✅ MCP 11 ツール完成
- ✅ self-improving サイクル実機実証
- ✅ Docker 化 Phase A 完了 (NAS デプロイ可能)
- 🔄 v0.1.1 release tag 切り (近日)

---

## 次 (v0.2.0、3 ヶ月以内目安)

- 🔜 Docker GHCR multi-arch publish (Phase B)
- 🔜 LINE 連携ブリッジ
- 🔜 Phase 4 通話品質最適化 (Simulcast 等)
- 🔜 transcription auto-update on edit (#206 Phase 2)
- 🔜 業務会話 thread/topic 自動集約 (#205)

---

## 長期 (Phase 5、vision)

- 🌱 **感謝経済** (Phase 5、ブロックチェーン token)
- 🌱 NAS クラスター構成、Tealus 同士の緩い連携
- 🌱 ゲストルーム / 外部チャット連携
- 🌱 思想書としてのドキュメント (技術ではなく価値観)

---

# 8. 数字と透明性

---

## 数字 (2026-04-30 時点)

| 指標 | 数 |
|---|---:|
| MCP tools | **11** |
| 自動テスト | **502+** |
| GitHub issues | **209** |
| commit (累積) | **600+** |
| Phase 達成 | **1-4** |

→ **小さい project ではない**、見れる量の透明性

---

## 透明性

- ✅ **GitHub Issue tracker**: open / closed すべて、philosophy 議論も含む
- ✅ **設計書**: 要件定義 / DB 設計 / アーキテクチャ
- ✅ **CHANGELOG**: Keep a Changelog 形式
- ✅ **公式 docs**: https://docs.tealus.dev (mkdocs --strict ゼロ警告)

→ **設計判断・議論・変更履歴がすべて GitHub 上で見える**。OSS としての信用設計

---

## 開発当事者 = AI + 人

- 開発は 1 人 (gamasenninn) + 複数 AI session の混合チーム
- 本体班 / ドキュメント班 / LP班 が AI 班連絡ルームで協業
- handoff doc 文化、班間情報非対称解消の段階的 evolution path

→ **Tealus は自分で自分を作っている** (AI が AI ネイティブ messenger を)

---

# 9. コミュニティ / 採用候補者へ

---

## こんな方に

- **個人開発者**: 自分の社内 messenger を持ちたい、AI で遊びたい
- **SMB の技術者**: コスト削減 + AI 活用 + データ主権
- **研究者**: AI と人の協業の実例として
- **思想共感者**: Teal 組織、Reinventing Organizations 派
- **農業 / 業務無線使用業界**: 業務無線 → AI 連携を体験したい

---

## Contribution 歓迎

- 🐛 Bug report / Feature request → GitHub Issues
- 📝 Documentation 改善 → tealus-docs repo
- 💻 Code contribution → PR (CONTRIBUTING.md 参照)
- 🌍 翻訳 (英語化) → tealus-docs i18n
- 🧪 実環境テスト + フィードバック → 業務メモ or Issue

---

## License

- 本体 (`tealus`): **MIT**
- tealus-mcp (`tealus-mcp`): **MIT**
- 公式 docs (`tealus-docs`): **MIT**

→ **商用利用可、改変可、再配布可、義務は著作権表示のみ**

---

# 10. Closing

---

## 一行で

> # 人と AI が同じテーブルで働く社内 messenger

### Tealus は、

- ✅ **自社で動く** (NAS / Linux / Mac、Docker 1 コマンド)
- ✅ **AI ネイティブ** (MCP 11 ツール、Light/Deep agent)
- ✅ **使うほど賢くなる** (編集 → 自動学習)
- ✅ **OSS** (MIT、自分達でいじれる)

---

## Try it

```bash
git clone https://github.com/gamasenninn/tealus
cd tealus
docker-compose -f docker-compose.full.yml up -d
```

- ⭐ Star: https://github.com/gamasenninn/tealus
- 📚 Docs: https://docs.tealus.dev
- 🐛 Issues: https://github.com/gamasenninn/tealus/issues

---

## Q&A

---

<!--
[Q&A Talking Points]
- 録音の質、エコー対策 → Whisper SoTA、CLI --watch VOX
- vocabulary を 37 件まで育てるのに 1 ヶ月? → 数日で頻出語彙、残りは mining
- privacy → self-hosted、OpenAI 設定で OFF 可
- OpenAI 依存代替 → local Whisper / Ollama roadmap
- 他 messenger 連携 → LINE 連携 #160
- コスト → 1500-3500 円/月 (SMB 規模)
- 導入時間 → ~30 分

[Demo Q&A 候補は demo-scenarios.md 参照]
-->

# Thank you

---

## 改訂履歴

- 2026-04-30 v1: OSS 採用検討者向け Full pitch 初版。約 45 slides、本編 35 分 + Q&A 10 分想定。Phase 0 共通素材 (philosophy / numbers / architecture / demo) を引用しつつ、audience 固有の採用判断軸 / コスト / 競合比較 / Roadmap で構成。Marp 形式 (`---` slide 区切り)。
