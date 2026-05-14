# [Blog Draft] AI が自分の bug を見つけた日 — Tealus が 1 営業日で AI 挙動を構造修正した話

> **status**: draft (5/14 執筆)、未 publish。#265 (tealus 関連ブログ立ち上げ) の素材候補。匿名化方針 / publish 先 / トーン調整は user judgment 待ち。

---

## 起きたこと

朝、社内の業務担当者から声がありました。

> 「朝礼の動画を AI に渡すと、議事録は完璧に作ってくれる。でも、そこから TODO を抜き出させると、なぜか **前々日 (5/12) の TODO リスト**を、一字一句そのまま返してくる」

何度頼んでも、reply で「この議事録から」と明示しても、毎回同じ過去の内容。「これ前回のだよ」と訂正すると、AI は「すみません、前回の内容でした」と謝るのに、また同じものを返してくる。

人間が首をかしげる挙動です。AI は決して "馬鹿" ではないし、現に議事録自体は精度よく作れている。指示も明確。なのに、なぜ?

## 調べてみると、原因は 3 層に重なっていた

開発側で agent server のログを掘り、prompt の中身を確認しました。すると見えてきた絵は、こんなふうになっていました。

### 層 1: Tealus 本体サーバが「reply 関係」を AI に渡していなかった

Tealus では、ユーザがメッセージに reply で返信したとき、その reply 先の情報 (どの message に返信したか) は DB にちゃんと保存されています。Socket.IO のブロードキャストでも、reply 先のメッセージ本文を一緒に送っていて、UI で「引用つき返信」が見える形になっている。

ところが、AI agent server に送られる **webhook payload** は、メッセージの `id / type / content / sender` だけを explicit に拾っていて、**`reply_to` (および `reply_to_message`) は payload に含まれていなかった**。

つまり、ユーザが「この議事録に返信して TODO 抽出を依頼」しても、その「この議事録」という意味が **AI には届いていなかった**。

### 層 2: AI agent server も reply 関係を prompt に embed していなかった

仮に reply_to が webhook で届いていたとしても、AI に渡される prompt の組み立てロジック (dispatcher) は、`message.reply_to` を参照していませんでした。grep して確認すると、agent-server 全体で `reply_to` の参照は **0 件**。

= **設計の構造空白**でした。L1 と L2 の両方が、ユーザの reply 操作という semantic intent を運ぶ機能を持っていなかった。

### 層 3: AI 言語モデルの "in-context echo trap"

L1 と L2 を埋めて、agent prompt に「ユーザは message id="X" に返信しています。get_messages で確認して、その内容を最優先で扱ってください」と明示するようにしました。これで agent は対象 message の id を知ることができる。

しかし、dogfood すると **まだ同じ過去 TODO list が返ってきました**。

ログを見ると、AI は確かに `get_messages` を呼んでいる。直近 20 件のメッセージを取得している。そして、その 20 件の中には **正しい議事録 (1 件)** と **過去の TODO list の copy 4 件**が両方含まれていました。

ここで AI は、明示的な instruction (「id="X" を最優先」) よりも、chat history に強く存在する pattern (「TODO 要求 → 22-item list」が 4 例) を **採用してしまった**。

これは LLM 文献で documented されている挙動で、私たちはこれを **"in-context echo trap"** と呼ぶことにしました。同種の質問への過去の自分の応答が context に複数残っていると、新しい explicit instruction を override して、history pattern を copy する lazy mode に LLM (特に小型モデル) が陥る現象です。

## 解決: 3 層構造修正 + 「過去 list は copy しない」明文化

3 つの層に同時に手を入れました。

1. **server**: webhook payload に `reply_to` + `reply_to_message` を追加。既存の `fetchReplyMessage` 関数 (UI 側で使われていた reply 先取得) を流用するだけで、payload に reply 関係が乗るようになる
2. **agent-server**: dispatcher に `buildReplyToHint(message)` helper を追加。reply_to_message の **本文を verbatim で agent prompt に embed** する 2-mode 設計 (内容あり: 本文 embed / 内容なし: id-only fallback)。light / light2 / deep の 3 path で共通利用、TDD で 7 ケース追加
3. **朝礼ルーム固有設定**: `light_prompt.md` (room-scoped agent instruction file) で TODO 抽出 protocol を明文化 ─ 対象議事録の created_at を明示してから抽出、過去の TODO 出力を絶対に copy しない、各項目は対象議事録に literal に存在する fact のみから生成

最も決定的だったのは **2 の「本文 verbatim embed」**でした。AI に「id を教える」だけでは、AI は lookup の work を skip して history pattern を copy する誘惑に負ける。本文そのものを prompt 内に literal で持たせれば、AI の attention は史上最高の signal を直接受け取ることになり、history pattern より強くなる。

## Dogfood 結果

修正後、同じシナリオを再現:

| 観点 | 修正前 (4 回試行) | 修正後 |
|---|---|---|
| 5/14 議事録の内容反映 | 0 件 | 9 section 100% 反映 |
| 5/12 議事録 items 混入 | 22 件 / 22 件 (完全 copy) | 0 件 |
| Response 文字数 | 553-578 chars (定型 list) | 417 chars (実抽出) |
| Title の議事録 ID 明示 | あり (created_at 表示) | あり (継続) |

朝の voice (02:24 でメッセージ受信) から構造修正完了 + dogfood 完走まで、**1 営業日以内**で着地しました。

## このサイクルが Tealus にとって意味すること

Tealus は **organic ontology** という設計思想を掲げています。あらかじめ完璧な仕様を作るのではなく、生きた使用の文脈から後付けで pattern が形成されていく ─ という設計の姿勢です。

今回の朝礼 fix は、その思想の **最深例**かもしれません。

これまでの dogfood cycle は、コードや UX の話でした:
- voice の vocabulary が育つ (5/12)
- 業務 DB に AI が届く (5/11)
- iPhone の表示が直る (5/13)

しかし 5/14 朝礼 fix は **「AI 自身の振る舞いに関する pattern」を、AI と人間が共同で言語化した日**でした。

AI が in-context echo trap という挙動を起こす ─ これは抽象的な LLM の特性です。誰かが言語化しなければ、次の似た問題が起きたときに、同じ罠を何度でも踏む。今回それを **organic な現場 dogfood から発見し、構造修正に翻訳し、memory に保存**することができた。

Tealus の organic ontology は、コードや UX だけでなく **AI の振る舞いそのもの** にも届く。次に AI を組み込んだシステムを設計する人は、私たちの言語化を起点にすることができる。

これは、AI と人間が同じテーブルで働くメッセンジャー、というコンセプトが、本当に意味することの **生きた例**だと思います。

## 技術詳細 (興味のある方向け)

- Issue: [#274](https://github.com/gamasenninn/tealus/issues/274)
- Commits: `28698bb` (server) / `c8f044b` (agent-server + TDD)
- TDD: `dispatcher.test.js` に B1-B7 の 7 ケース追加、既存 250 + 新 7 = 257 全 pass
- prompt size 変化: 270 chars → 1483 chars (議事録本文 embed の literal な量)
- 関連 memory (Tealus の AI 班連絡から派生した design guideline 2 件):
  - `feedback_llm_in_context_echo_trap.md` ─ LLM behavioral pattern + counter pattern
  - `feedback_agent_prompt_reply_to_design.md` ─ agent prompt 構築の structural propagation guideline

## おわりに

Tealus はオープンソースです。Docker 1 コマンドで NAS で動きます。

完璧な AI を提供するのではなく、AI が間違えた時にその間違いを **organic に学習する仕組み**を提供します。

社内の業務担当者が「これ前回のだよ」と訂正したそのメッセージが、その日のうちに構造修正の起点になる ─ そんな messenger です。

---

## Publish notes (draft 段階)

- **匿名化**: 社名 / 個人名は不要 (本記事は技術的物語、社名は出さなくても narrative 成立)
- **トーン調整**: 現状やや技術寄り、一般読者向けに調整するなら層 3 (LLM in-context echo trap) の説明をもう少し簡素化
- **見出し**: blog publish 時は SEO 観点で title を調整 (例: 「AI が自分の振る舞いを修正した日」「LLM の in-context echo trap を組織記憶で克服した話」など)
- **publish 先**: tealus.dev/blog (#265 議論先行)、Zenn / note / dev.to / Hacker News (英訳必要) 候補
- **画像**: prompt size 270 → 1483 chars の対比 / TODO list diff / git log 5 commits / agent log screenshot 等

## 関連

- 同 narrative の sibling: `walkthrough-script-v1.md` (Act 5 が本記事の物語版)
- 設計思想 anchor: `philosophy.md` の "Tealus の設計姿勢: organic ontology" section
- elevator pitch: `elevator-pitches.md` 軸 3 (採用者 voice → 機能進化 cycle)
