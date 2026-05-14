# Tealus Elevator Pitches

audience 別の 1 行メッセージ (= elevator pitch) と、その背景説明。Full pitch / LP / 短尺資料すべての **冒頭 1 枚** に使う。

---

## 1. OSS 採用検討者向け (個人開発者 / SMB の技術者)

「**動かせる、見える、使える**」が刺さる layer。SaaS の月額 / データ主権 / 既存 stack との統合可能性が判断軸。

### 候補 (brush up 中)

#### A. 技術寄り
> **「LINE 風の操作感、Slack 級の統合性、AI ネイティブ設計 — 自社の NAS で動く messenger」**

- 強み: 既存 messenger 比較で「何が違うか」が即伝わる、AI ネイティブが差別化軸
- 弱み: 「LINE 風」「Slack 級」が比較対象を二重出ししている、若干冗長

#### B. データ主権寄り
> **「業務メモも音声も社外に出さない。Docker で NAS 1 台にデプロイできる、AI ネイティブ messenger」**

- 強み: SaaS の「データが外に行く」不安への直接対処、Docker / NAS で具体性
- 弱み: 「AI ネイティブ」が後続するのでメッセージが少し詰まっている、AI を主軸にできていない

#### C. 採用容易性寄り
> **「Docker 1 コマンドで立ち上がる、AI 標準装備の社内 messenger」**

- 強み: 採用ハードルの低さを最初に提示、Docker / NAS 採用者に刺さる
- 弱み: 思想・哲学が見えない、「もう一つの Slack」と区別がつきにくい

#### D. 進化軸寄り
> **「使うほど AI が組織の記憶を深める、自前運用できる messenger」**

- 強み: Tealus 独自の self-improving 設計が一発で伝わる、「使うほど」が惹きフレーズ
- 弱み: 抽象的、最初の体験で何が起こるか分かりにくい、技術的な裏付けが続スライドに必要

#### E. 混合チーム角度
> **「人と AI が同じテーブルで働く社内 messenger — 自社の NAS で動く OSS」**

- 強み: Tealus の独自性 (混合チーム OS) を最初に提示、AI が対等なメンバーという新しい framing
- 弱み: 「同じテーブル」が抽象的、技術者によっては引きが弱い可能性

### 私の推奨

**E (混合チーム角度)** + 補足で「Docker / NAS / OSS」を即支える形。

理由:
- **独自性が一発で伝わる** (LINE 風 / Slack 級だと比較対象どまり)
- 「人と AI」 framing は思想共感者にも転用可能 (Phase 0 で共通素材化しやすい)
- 「自社の NAS で動く OSS」を後付けで具体性を担保
- 技術評価者向けにも Z軸 (混合チーム OS) で展開可能

最終形 (推奨案):

> # Tealus
> ## 人と AI が同じテーブルで働く社内 messenger
> ### Docker 1 台で NAS にデプロイ、OSS、自社運用可能

3 行構成 = タイトル + 核 + 具体性、で OSS 採用検討者の判断材料を 5 秒で渡す。

### v2 追記 (2026-05-14): 推奨案 E を支える 3 軸 (slide 2 / FAQ 用素材)

5/11-5/14 dogfood で「**人と AI が同じテーブルで働く**」の具体性が 3 つの軸で言語化された。
elevator pitch 3 行を 5 秒で渡した後、**slide 2 / FAQ / explanation card** で深掘りするための 2nd layer 素材。

#### 軸 1: **業務 DB に届く混合チーム**

- AI agent が messenger 内から業務基幹 DB に MCP 経由で直接 query
- 現場の質問 (例: 「先月の田植機の販売数は?」) が同じ messenger 内で完結
- 別ダッシュボードを開かない、SQL を覚えない、業務 context が断絶しない
- 起点: 5/11 社内 DB (hksdb) MCP 連携 first successful dogfood (`memory: project_internal_db_mcp_dogfood.md`)

#### 軸 2: **cross-modality dividend** (辞書投資の利息構造)

- voice (トランシーバー / 業務メモ) で育てた組織語彙が、video (朝礼動画) でも、DB query でも同じ精度で効く
- 1 modality への辞書投資が他 modality に compound する、Tealus 独自の **Self-Improving の compounding 構造**
- 起点: 5/12 voice vocab inject 6/6 完璧 + 4:39 朝礼動画を 32 秒で transcribe + 同辞書整合確認 (`memory: feedback_whisper_vocab_inject_dogfood.md` / `project_step29_video_transcribe.md`)
- 詳細は `philosophy.md` 柱 3 の cross-modality dividend 補足を参照

#### 軸 3: **採用者 voice → 機能進化 cycle (organic ontology)**

- 現場の dogfood voice が **1-2 営業日**で commit に翻訳される cycle
- 例: 5/13 採用検討者「iPhone で入力欄を触ると画面が拡大」voice → 5/14 commit `4d00839`
- 例: 5/14 社内 user「改行が消える」voice → 同日 commit `bdf3ccc` (cycle 最短例)
- 設計姿勢として `philosophy.md` の「Tealus の設計姿勢: organic ontology」section + 5 必要条件を参照
- 起点: 5/11 user 言語化 (`memory: project_organic_ontology.md`)

### v2 推奨案 brushup 候補 (4 行拡張、audience 別分岐)

3 軸を踏まえた 4 行 (スライド 1 拡張) 案:

> # Tealus
> ## 人と AI が同じテーブルで働く社内 messenger
> ### Docker 1 台で NAS にデプロイ、OSS、自社運用可能
> #### voice / video / DB が同じ辞書で繋がり、現場 voice が翌日の commit になる

4 行目を入れるかどうかは audience による:

| audience | 推奨 | 理由 |
|---|---|---|
| **OSS 採用検討者** (個人開発者 / SMB) | **3 行で stop** | 動かしやすさ優先、4 行目は slide 2 で展開 |
| **技術評価者** (CTO / アーキテクト) | **4 行**まで開示 | cross-modality + organic ontology cycle が設計差別化軸として刺さる |
| **思想共感者** (起業家 / 哲学コミュニティ) | 3 行 + philosophy.md 直接誘導 | 「organic ontology」概念に直接接続、elevator pitch は通過点 |
| **業務エンドユーザー** (現場) | 別 audience pitch (section 4) を使う | E は技術寄り、現場層は別 framing が必要 |

3 軸そのものは audience 共通の素材で、**presentation 順序 / 開示深度 / framing** が audience 別に分岐する設計。

---

## 2. 技術評価者向け (CTO / アーキテクト) — 後で brush up

候補メモ:
- 「**MCP-native messenger、self-improving、人と AI の混合チーム OS**」
- 「**プロトコル設計から AI を前提にした、コラボ OS の刷新案**」

OSS 採用検討者 (1) の Full pitch ができてから brush up。

---

## 3. 思想共感者向け (起業家 / 哲学コミュニティ) — 後で brush up

候補メモ:
- 「**Teal な組織のための messenger、人と AI が対等なメンバー**」
- 「**ビジネスではなく Teal な Us を支える infrastructure**」

思想パート (`philosophy.md`) と並行で brush up。

---

## 4. 業務エンドユーザー向け (現場、農機店等) — 後で brush up

候補メモ:
- 「**業務無線が AI と繋がり、議事録が自動整理される現場 messenger**」
- 「**現場の声を AI が拾い、検索可能な記憶にする**」

Demo シナリオ (`demo-scenarios.md`) と並行で brush up。

---

## 名前の由来 (全 audience 共用、要確定)

**Teal + Us** = 「Teal な (青緑な、進化的、組織的) Us (私たち)」

- **Teal**: Frederic Laloux『Reinventing Organizations』(進化型組織) の概念。階層構造を超えた、自己組織化された組織モデル
- **Us**: 私たち、和な集合体
- 合わせて「進化型組織のための私たち messenger」

詳細は `philosophy.md` に展開予定。

---

## 改訂履歴

- 2026-04-30 v1: OSS 採用検討者向け 5 候補から E を推奨案として作成。残 3 audience は次フェーズで brush up
- 2026-05-14 v2: 推奨案 E に 5/11-5/14 dogfood 起点の 3 軸 (業務 DB / cross-modality dividend / 採用者 voice→機能進化 cycle) を v2 追記として追加。既存 3 行最終形は retain、slide 2 / FAQ 用素材として 2nd layer 確立 + 4 行拡張 brushup 候補と audience 別開示深度を提示。`philosophy.md` v2 + `walkthrough-script-v1.md` と vocabulary 共有。#209 sub-1 完結。
