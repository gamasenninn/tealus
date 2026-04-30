# Tealus 思想パート (全 audience 共用、Phase 0 共通素材)

すべての pitch / LP / 資料の「**なぜ Tealus か**」を支える基盤。audience 別 Full pitch には、ここから引用する形で組み込む。

---

## 一行で

> **人と AI が同じテーブルで働く、自社運用可能な社内 messenger。**

「同じテーブル」 = 対等なメンバー、別レイヤーではない。
「自社運用可能」 = 自分達のデータを自分達で持つ、SaaS に明け渡さない。

---

## なぜ Tealus を作ったか (起点)

既存の社内 messenger (LINE WORKS / Slack / Teams) は **3 つの限界**を抱えていた:

### 1. **データ主権の不在**
業務メモ・音声・議論はすべて SaaS のサーバー上にある。AI 連携も「**SaaS が AI に渡す**」形で行われ、自社のデータが学習素材になる構造から逃げられない。

### 2. **AI が後付け**
LINE / Slack / Teams は人と人のコミュニケーションのために設計され、AI は **bot として接続される後付けの存在**。AI と人が対等なメンバーとして働く設計にはなっていない。

### 3. **進化が買い替え依存**
既存 messenger は **使い込むほど蓄積するが、賢くなりはしない**。タグ付け / 整理 / 議事録は手動。AI 連携も「便利だが永続的に賢くなる」構造を持たない。

### Tealus の回答

- ✅ **自社の NAS で動く**: Docker 1 コマンド (`docker-compose -f docker-compose.full.yml up`)、Synology / QNAP / UGREEN 対応
- ✅ **AI ネイティブ設計**: 設計の最初から AI を前提、MCP / Bot API が core primitive、Light agent と Deep agent (Claude Code) 両方統合
- ✅ **使うほど賢くなる**: 編集履歴を自動学習データにする self-improving 辞書、組織の語彙が時間とともに育つ

---

## 名前の由来

**Teal + Us**

- **Teal** (青緑): Frederic Laloux『Reinventing Organizations』(2014) で示された **進化型組織** モデル。階層構造を超えた、自己組織化される組織の色。
- **Us** (私たち): ビジネスではなく和な集合体、メンバーシップの実感。
- 合わせて: **進化型組織のための「私たち」messenger**。

旧名は「Linny」「Life Line」を経て、Phase 4 評価後の対話で **Tealus** に確定。Teal 概念に共感し、AI を含めた Us を志向する project の旗印として。

---

## 設計の 4 つの柱

### 柱 1: **データ主権 (Self-hosted)**
- 自社の NAS / Linux / Mac mini で動く
- メッセージ・音声・AI 連携すべて手元で完結
- SaaS に依存しない、SaaS を outage 時に止まらない、SaaS のポリシー変更に振り回されない
- 業務メモ・トランシーバー履歴・編集履歴すべて user の DB に残る

### 柱 2: **AI ネイティブ (AI-Native)**
- 人と AI が同じ messenger で対等に働く
- MCP (Model Context Protocol) で 11 ツールが統一 interface
- Light agent (gpt-4o-mini)、Deep agent (Claude Code) 両方を統合
- 業務メモは AI の組織記憶、過去議論を AI が引ける
- AI が組織を能動的に編成 (`create_room` / `delete_room` で議題ルーム / インシデントルーム を AI が作って削除)

### 柱 3: **使うほど賢くなる (Self-Improving)**
- 文字起こしの編集履歴 = 無料のラベル付きデータ
- AI が編集ペアから組織固有の alias を自動学習 (`mining` script)
- vocabulary / guidelines は外部 JSON、組織ごとに自然進化
- 「**AI が困った経験を機能に翻訳**」サイクル + 「**user が訂正した経験を辞書に翻訳**」サイクル の双方向ループ

### 柱 4: **Phase 進化 (Phased Evolution)**
- Phase 1: 人と人がメッセージを交換する (基本 messenger)
- Phase 2: より豊かに (スタンプ、音声、リアクション、文字起こし)
- Phase 3: AI が対等なメンバーとして参加する (AI agent)
- Phase 4: 声で繋がる (通話、トランシーバー、TTS)
- Phase 5: 感謝を交換する (感謝経済、ブロックチェーン token)

各 Phase は前 Phase の上に積み上がり、**同じ messenger / 同じ DB / 同じ思想**で連続している。LINE → Slack → Teams のような買い替えではなく、**1 つの project が成長していく**。

---

## 競合との差異

| 観点 | LINE WORKS / LINE | Slack / Teams | Discord | Mattermost / Rocket.Chat | **Tealus** |
|---|:---:|:---:|:---:|:---:|:---:|
| 自社運用 | ❌ | △ (Enterprise) | ❌ | ✅ | ✅ |
| AI ネイティブ設計 | ❌ | △ (後付け bot) | ❌ | ❌ | **✅** |
| AI と人の対等性 | ❌ | ❌ | ❌ | ❌ | **✅** |
| 使うほど賢くなる | ❌ | ❌ | ❌ | ❌ | **✅** |
| 業務無線統合 | ❌ | ❌ | ❌ | ❌ | **✅** |
| Phase 1-5 連続設計 | ❌ | ❌ | ❌ | ❌ | **✅** |
| OSS | ❌ | ❌ | ❌ | ✅ | ✅ |

Tealus の **「**△**」が一つも無い**ところが独自性。データ主権 + AI ネイティブ + self-improving + Phase 連続性が同時に揃っている messenger は他にない。

---

## Phase 5: 感謝経済 (思想の到達点)

Tealus の最終 Phase は **「感謝を金銭に換算しない経済」**。

### 問題提起
現代の経済では「感謝」が定量化されず、目立たない貢献が報われない。一方、ポイントシステムや評価制度は「**換金される**」ことで「**取引**」になり、効率最適化される。

### Tealus の回答
**ブロックチェーン token で感謝を記録する。ただし換金できない。**
- 誰かに感謝されると、そのトークンが永久に残る
- 換金できないので「効率」を求められない
- 数値ではあるが「事実」、見られるが操作できない
- 「**ただ存在する価値**」 = 人の行動を変える

### 参加者
社員 ↔ 社員、社員 ↔ AI agent、社員 ↔ クライアント、社員 ↔ ボランティア、社員 ↔ 家族。
**Us の範囲が組織を超える**。各組織の Tealus がブロックチェーンで緩く繋がり、感謝だけが組織を越境する。

---

## 5 つの「堀」(競合に対する防衛線)

| 堀 | 説明 |
|---|---|
| **設計の一貫性** | Phase 1 から AI を前提に設計、後付けでは再現不可能 |
| **知見の蓄積** | 200+ issues、Phase 4 評価レポート 14 本、開発当事者 (AI + 人) の対話記録 |
| **ユーザーガイド (思想書)** | 書籍レベルのドキュメント、技術書ではなく「Tealus の世界観」が伝わる |
| **AI 自律アーキテクチャ** | AI 自身がシステムの品質と思想を維持する、属人性を脱却 |
| **感謝経済 (Phase 5)** | 思想カテゴリの差別化、模倣しても魂が入らない |

「Tealus の本当の価値はコードではなく、**設計思想 + ドキュメント + AI 自律性 + 感謝経済の四位一体**。」

---

## まとめ

Tealus は **「人と AI が同じテーブルで働く、進化型組織のための messenger」** です。

**今すぐ価値があるもの**: 自社運用 messenger、AI ネイティブ、業務無線統合 (Phase 1-4)
**未来に向けて建てているもの**: 使うほど賢くなる、感謝経済、AI と人の混合社会の infrastructure (Phase 5+)

両者を **同じ project / 同じ DB / 同じ思想**で連続させているところが、買い替え型 messenger との根本的な違い。

---

## 改訂履歴

- 2026-04-30 v1: 初版、4 audience 共通の思想素材として作成。Full pitch / LP / 短尺資料すべての引用元として機能する想定。

## 主要 source

- [#135](https://github.com/gamasenninn/tealus/issues/135) Tealus の思想と未来設計
- [#83](https://github.com/gamasenninn/tealus/issues/83) Phase 5 ブロックチェーン感謝経済
- [#185](https://github.com/gamasenninn/tealus/issues/185) (closed) MCP umbrella、「使うほど賢くなる」の実装根拠
- [#202](https://github.com/gamasenninn/tealus/issues/202) AI 協業基盤 / 班間情報非対称解消
- Frederic Laloux『Reinventing Organizations』(2014)
