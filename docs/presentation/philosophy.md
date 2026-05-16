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

## Tealus の設計姿勢: organic ontology

4 つの柱の **背後にある共通の設計姿勢**を一段抽象化した layer。2026-05-11 user との対話で言語化された深層 framing で、Tealus を貫く設計判断の評価軸として機能する。

### artificial ontology と organic ontology

| 対比 | 内容 | 例 |
|---|---|---|
| **artificial ontology** | 設計者が事前に schema / taxonomy を組む | Wikidata、Schema.org、DB normalization |
| **organic ontology** | 生きた context から **後付けで pattern が crystallize する** | Tealus 内の retrospective、編集履歴からの自動辞書、業務 voice → 機能 cycle |

artificial ontology は設計者の事前認知の範囲内に留まる。一方 organic ontology は **現場 dogfood で surface した pattern を後付けで言語化する**ため、設計者の事前認知を超える強さがある。

### organic ontology を実現する 5 必要条件

ある system が organic ontology を crystallize できるためには、以下 5 つの cycle 条件が同時に成立する必要がある:

1. **生きた context** (会話 / commit / message) が中央集約される場
2. **AI が context を読みに行ける mechanism** (MCP 経由が clean)
3. **crystallization 出力** (retrospective / memory) が同じ場に保存される
4. **次 session が出力を context として再 join** する loop
5. **判断主体 (user) が cycle の方向性を decide** する

Tealus はこの 5 条件を **1 OS 内で満たす稀な system**。Notion / Slack / Obsidian の組み合わせで近いことは可能だが、Tealus は単一設計内で完結する。

### 4 柱との関係

設計の 4 柱は、5 必要条件を支える各 layer に対応している:

| 必要条件 | 主に支える柱 |
|---|---|
| (1) 生きた context の中央集約 | 柱 1: データ主権 (自社の DB / messenger 内で完結) |
| (2) AI が context を読む mechanism | 柱 2: AI ネイティブ (MCP / Bot API が core primitive) |
| (3) crystallization 出力の同所保存 | 柱 3: Self-Improving (編集履歴 / 業務メモ / memory file) |
| (4) 次 session の再 join | 柱 3 + 柱 4 (Phase 連続性で memory が積み上がる) |
| (5) user の方向性 decide | orthogonal (user は外側の判断主体) |

### 新機能の設計判断時の評価軸

「この変更は organic ontology cycle の 5 条件のうち、どれを **強化するか / 弱めるか**」を 1 軸として評価する。

| 強化例 | 弱体化例 |
|---|---|
| memory file load の自動化 | AI を passive reader にする変更 |
| retrospective auto-generation | retrospective を外部 system に移す |
| AI 自律 trigger / MCP discovery primitive | context をサイロ化する分割、固有名詞 guess を許す API design |

### 実例: 5/11 - 5/14 dogfood の cycle 検証

直近 1 週間で organic ontology cycle が実際に回った 6 例 (`docs/presentation/walkthrough-script-v1.md` も同素材):

| date | cycle | crystallized output |
|---|---|---|
| 5/11 | 社内 DB に AI が届く | `memory: project_internal_db_mcp_dogfood.md` (条件 2 強化、第 3 軸獲得) |
| 5/12 | voice vocab 投資 → video transcription にも reciprocal に効く | "cross-modality dividend" 言語化 (条件 3 強化、柱 3 内 sub-mechanism) |
| 5/13 | 採用検討者の iPhone voice → 翌日 commit | `memory: feedback_ios_input_autozoom_16px.md` + commit `4d00839` (条件 1+4 強化) |
| 5/14 朝 | 社内 user「改行が消える」voice → 同日 commit | commit `bdf3ccc` / #273 (条件 1+4 強化、cycle 最短例) |
| 5/14 午後 | 朝礼 TODO 抽出 bug surface → 3 層構造修正 1 セッション内完走 | commit `28698bb` + `c8f044b` / #274、**AI 自身の挙動 bug が同日 fix** ─ "LLM in-context echo trap" 言語化 (`memory: feedback_llm_in_context_echo_trap.md`)、reply_to propagation design guideline (`feedback_agent_prompt_reply_to_design.md`)。AI が AI の bug を可視化し、人間と一緒に構造修正する cycle (条件 1+2+3+4 同時強化、organic ontology 最深例) |
| 5/15 | エージェント設定 UI を実装したら、隣の MemberList の違和感が見えて即連鎖 fix | commits `6ac122f` + `b3f4ec9` + `1f849f4` / #156、**dogfood UX cascade** ─ 1 つの実装に触れたことで隣接領域 (RoomSettings 内 section 順 + MemberList 操作 button 位置) の Gestalt 違和感が surface し同セッション内で 2 連 refactor。「触っていて気持ちがいい」signal で UX 完成判定 (条件 1+4 強化、implementation arc 内の cascade 例) |

設計時に事前 planning されたものではなく、**現場 dogfood で surface した事象が後付けで pattern 化された**例。Phase 4 retrospective が internal proof of concept として機能している。特に **5/14 午後の朝礼 fix** は、**AI 自身の振る舞いに関する pattern を AI と人間が共同で言語化する**新しい例で、organic ontology が技術 layer (DB / modality / UX) だけでなく **AI behavior の layer にも届く**ことを示している。**5/15 の dogfood UX cascade** は、cycle が user voice 駆動だけでなく **実装行為そのものから連鎖的に surface する** ことを示す例で、「使うほど自分自身に追いついていく」が AI behavior 層に続いて UX 層にも適用された。

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

### 柱 3: **使うほど賢くなる (Self-Improving)** — 「使うほど自分自身に追いついていく」
- 文字起こしの編集履歴 = 無料のラベル付きデータ
- AI が編集ペアから組織固有の alias を自動学習 (`mining` script)
- vocabulary / guidelines は外部 JSON、組織ごとに自然進化
- 「**AI が困った経験を機能に翻訳**」サイクル + 「**user が訂正した経験を辞書に翻訳**」サイクル の双方向ループ
- **cross-modality dividend**: 1 modality (voice) で育てた辞書が他 modality (video / DB query) でも利息を生む — 5/12 朝礼動画 dogfood で voice vocab inject 6/6 + 4:39 動画を 32 秒で transcribe + 同辞書整合を確認、辞書投資が cross-modal に compound する構造

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
- 2026-05-14 v2: `organic ontology` section 新設 (5/11 user 言語化反映、設計姿勢 layer として 4 柱の手前に配置)。柱 3 に `cross-modality dividend` 補足 + 「使うほど自分自身に追いついていく」副題追加。既存構造 retain、新規 1 section + 柱 3 部分加筆のみ。#209 sub-1 / walkthrough-script-v1.md と整合。

## 主要 source

- [#135](https://github.com/gamasenninn/tealus/issues/135) Tealus の思想と未来設計
- [#83](https://github.com/gamasenninn/tealus/issues/83) Phase 5 ブロックチェーン感謝経済
- [#185](https://github.com/gamasenninn/tealus/issues/185) (closed) MCP umbrella、「使うほど賢くなる」の実装根拠
- [#202](https://github.com/gamasenninn/tealus/issues/202) AI 協業基盤 / 班間情報非対称解消
- [#209](https://github.com/gamasenninn/tealus/issues/209) Tealus プレゼン資料 umbrella (本 doc が sub-1 出力)
- Frederic Laloux『Reinventing Organizations』(2014)
- `docs/presentation/walkthrough-script-v1.md` (5/14) — 同 narrative の sibling document、5/11-5/14 dogfood を 5 act script 化
- 関連 memory (v2 加筆の素材源):
  - `project_organic_ontology.md` (5/11) — organic ontology 概念の origin
  - `project_internal_db_mcp_dogfood.md` (5/11) — 第 3 軸獲得 (業務 DB 連携)
  - `feedback_whisper_vocab_inject_dogfood.md` (5/12) — voice vocab inject dogfood
  - `project_step29_video_transcribe.md` (5/12) — cross-modality dividend 言語化の起点
  - `feedback_ios_input_autozoom_16px.md` (5/13) — iPhone PWA dogfood 起点
