# Tealus とは

> **位置付け**: 本書は Tealus を初めて知る読者向けの **入り口 doc**。LP (`tealus.dev`) より深く、`04_オーガニックオントロジー構造.md` より浅い中間 layer として、Tealus が何か / なぜ作っているか / 何が起こるか / どう違うか を読者を選ばずに説明する。実装詳細は 01-03 を、思想 full disclosure は 04 を、運用 manual は `tealus-organon` repo を参照。

---

## 1. 一言で

> **Tealus は、社内チャット・音声・AI を統合し、日々の会話を「組織の記憶」に変えるオープンソース基盤です。**

LINE のように使えるメッセンジャーが土台。その上に音声合成 / 文字起こし / トランシーバー / AI エージェント / 編集履歴 / 業務語彙辞書が積まれ、**現場の会話が組織知識として育っていく self-hosted workspace** として動きます。

NAS 1 台で完全自社運用、50 人使っても月額ゼロ円、MIT License、Docker Compose で起動。

---

## 2. なぜ作っているか

3 つの課題から生まれました。

### (a) コスト
50 人で Slack は月 5 万円、Teams は月 3 万円。中小企業 / 現場企業にとって積み重ねが重い。

### (b) データ主権
顧客対応 / 案件判断 / 価格交渉 / 業務指示 — これら **会社の核心データが SaaS のサーバーに置かれる** ことへの違和感。退会したらどうなるか、AI 学習に使われていないか、海外サーバーで法的にどう扱われるか、すべて他社次第。

### (c) AI が「外部ツール」止まり
Slack や Teams にも AI は入っているが、**チャットの脇で別画面に答える tool** として動く。組織の文脈を継続的に読む / 過去の会話に基づいて判断する / 現場の声を理解する、という organic な参加にならない。

→ Tealus はこの 3 点を、**LINE 級の使いやすさを保ったまま** self-hosted で解決することを目指して作られています。

---

## 3. 何が起こるか — 使う側の体験

### (a) 現場の声が業務記録になる

朝礼動画を AI に渡す → 議事録 markdown が自動生成される。トランシーバーで「整備長、取れますか?」と話す → 自動文字起こし + 業務語彙で正規化されて履歴に残る。音声・無線が **書き起こされて検索可能な組織知識** になります。

### (b) AI がチャットメンバーとして働く

別画面の bot ではなく、`@アシスタント` で同じルームに常駐する member。過去の会話を文脈として読み、ファイルを開き、業務メモを参照し、必要なら別 AI に仕事を回す。**ルームの一員として議論に参加する** AI が default です。

### (c) 訂正が組織の語彙を育てる

人が AI の出力を訂正する → 訂正 pattern が業務語彙辞書に蓄積される → 次回からその訂正が自動適用される。**使うほど組織固有の言葉と判断軸が育つ** self-improving cycle が回ります。

### (d) 流れた会話を後から再利用できる

メッセージは検索可能、編集履歴は永続化、TODO はタグで状態管理、添付ファイルは AI が読める。**「言ったきり消える会話」をやめて、再利用できる文脈** として扱う設計です。

---

## 4. Tealus は何ではないか

カテゴリ誤解を消すために、明示的に書きます。

| 誤解 | 実際の Tealus |
|---|---|
| Slack / Teams クローン | 日々の会話を **組織の記憶に変える基盤** |
| LINE WORKS の OSS 代替だけ | 音声・無線・AI を統合した **self-hosted workspace** |
| AI Bot を後付けしたチャット | AI が **最初からルームのメンバーとして働く** messenger |
| 単なるナレッジベース | 会話そのものが **あとから再利用できる組織文脈になる** |

---

## 5. 本質 — organic ontology が育つ基盤

Tealus の中核に、**organic ontology** という考え方があります。

ひとことで言うと: **「組織の意味構造は、事前に設計するものではなく、現場の会話から自然に立ち上がるもの」**。

たとえば:
- 「整備長」という役職を組織図に書く前に、現場の誰が日々その役割を担っているかが先に surface する
- 「お客様」という用語の意味は、Slack の定義ではなく、ある会社では VIP 顧客 / 別の会社では一見客 / さらに別の会社では取引先 と context によって変わる
- 「進める」という言葉が指す状態遷移は、組織ごとに違う prototype を持つ

Tealus はこの **organic な意味形成** を以下の 4 段で受け止めます (詳細は `04_オーガニックオントロジー構造.md`):

```
Layer 4: Meta-axis Observation   ← 判断軸そのものの変化を観測 (将来 module)
Layer 3: Organic Ontology         ← role tree / hazard family / 意味構造 (tealus-organon)
Layer 2: Context Space            ← messages / voice / dictionary / agent (tealus 本体)
Layer 1: Activity Modality        ← chat / 無線 / 会議 / 編集 / 判断 (現場の経験)
```

下から上へ「経験 → 文脈 → 構造 → 観測」が結晶化し、上から下へ「観測 → 文脈整理 → 経験への feedback」が帰る。両方向あって初めて organic と言えます。

LINE / Slack / Teams は Layer 1〜2 で止まる設計。Tealus は **Layer 3 (organic ontology) を data 層として持ち、Layer 4 を展望する** 点で category が異なります。

---

## 6. 誰のためか

主にこういう組織に向いています:

- **中小企業 / 現場企業** (50 人前後、Slack/Teams の月額が重い)
- **データ主権を重視する組織** (顧客データ / 業務知識を社外に出したくない)
- **農業・製造・建設・運輸・店舗等の現場** (音声・無線が日常、テキストだけでは捕まらない情報がある)
- **OSS + on-prem 派** (ベンダーロックインを避けたい、自社環境に置きたい、必要なら fork したい)
- **AI を業務の一員として運用したい組織** (bot ではなく member として)

逆に向いていないかもしれない組織:
- 大企業 (1000 人以上): scale 設計は対象外、別解の方が筋
- フル SaaS 派 (運用したくない): self-host の minimum コストを許容できない場合
- 業務無線がない知識労働専業: 音声・無線 layer の価値が出にくい

---

## 7. 始め方

| やりたいこと | doc |
|---|---|
| とりあえず立ち上げて触る | [`admin/server-setup`](https://docs.tealus.dev/admin/server-setup/) |
| 機能一覧を見る | [`docs.tealus.dev`](https://docs.tealus.dev) |
| Tealus の思想を深く知る | [`docs/04_オーガニックオントロジー構造.md`](04_オーガニックオントロジー構造.md) |
| 開発に参加する | [`docs/01_要件定義.md`](01_要件定義.md) + [`docs/03_アーキテクチャ設計.md`](03_アーキテクチャ設計.md) |
| organic ontology の運用例を見る | `tealus-organon` repo (private、招待制) |
| 採用検討向け Pitch | [tealus.dev/pitch/](https://tealus.dev/pitch/) (技術者向け) / [tealus.dev/pitch/field/](https://tealus.dev/pitch/field/) (現場向け) |

---

## 8. 関連 doc

| doc | 役割 |
|---|---|
| `00_what-is-tealus.md` | **本書**、入り口 doc |
| `01_要件定義.md` | 機能要件 / Phase 定義 |
| `02_DB設計.md` | persistence schema |
| `03_アーキテクチャ設計.md` | 技術構成 (services / ports / proxy) |
| `04_オーガニックオントロジー構造.md` | 概念設計 + 4 層構造 + feedback loop architecture |
| `tealus-organon` (private repo) | Layer 3 data 層の操作 manual + 5+1 原則の運用指針 |

---

## 9. Disclosure 階段

本 doc を含めて、Tealus の概念 disclosure は audience 別に階段状に配置されています:

| Layer | audience | 配置先 |
|---|---|---|
| concrete hook (NAS / ゼロ円 / AI音声 / LINE ライク) | 初見 / SMB / 現場 | LP (`tealus.dev`) hero / Features / 比較表 |
| 組織記憶 (会話が残る / 声が知識化 / AI が同じ部屋 / 使うほど育つ) | 導入検討者 / 技術者 / early adopter | LP Concept セクション + **本書 (docs/00)** + Pitch |
| organic ontology (4 層構造、5+1 原則、hazard family) | 思想を理解したい技術者 / OSS 開発者 | **本書 (docs/00) 5 章** + 04 doc |
| meta-axis 観測 + feedback loop architecture (6 段階) | 深い読者 / 投資家 / コア開発者 | 04 doc + organon repo |

本書 (`docs/00`) は **2 番目と 3 番目の layer をまたぐ中間** に位置します。読者の認知負荷を段階的に管理しつつ、興味があれば 04 / organon へ深く降りれる入口として機能します。
