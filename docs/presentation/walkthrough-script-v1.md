# Tealus Walkthrough Script v1 — 「1 週間で何が起きたか」

5/7 - 5/13 dogfood log を物語化した 6-7 分 walkthrough script (v1 draft)。
Tealus が掲げる **"organic ontology" / "使うほど賢くなる" / "cross-modality dividend"** を
**実際に起きた連続事例**で示す。

> **status**: v1 draft、user review 待ち。narrative 固定後に sub-1 (philosophy refresh) /
> sub-2 (README opening) と整合させて収録 / 編集に進む想定 (#209 / sub-5)。

---

## 想定 audience / 用途

- **Primary**: OSS 採用検討者 (個人開発者 / SMB の技術者) — 「動かせる」感の前に「**なぜ動かす価値があるか**」を 7 分で渡す
- **Secondary**: 技術評価者 (CTO / アーキテクト) — Tealus 独自の "self-improving" 設計が抽象論ではなく **実例で成立している** ことの証跡
- **配信先**: tealus.dev LP の hero / SNS 短尺版 / 採用説明会の冒頭

## 尺と形式

- 全長 **6:30 - 7:30** (ナレーション ~1500 字目安、~210 字/分)
- 構成: cold open + 5 act + closing
- 各 act = 1 つの 5/7-5/13 dogfood 事例 ↔ Tealus 設計の 1 つの差別化軸
- scene cue は画面キャプチャ or 図解、live demo は別 take

---

## Cold open (0:00 - 0:30)

**[scene]** 業務メモルームの音声メッセージが画面下端でなめらかに流れる。再生バー、波形。
**[overlay]** カタカナ文字起こしが下にせり上がる: 「ガマさん、ビレッジ側の田植機を取りに来てください。」

> **ナレーション**:
> これは、ある農機販売会社の業務メモです。
> 朝、社員がトランシーバー越しに残した一声を、AI が文字に起こしています。
>
> **「ビレッジ」「田植機」**。会社の中だけで通じる言葉が、ちゃんとカタカナで残っています。
>
> 普通の音声認識は、この言葉を覚えていません。
> でも Tealus は、**この会社の言葉を、使うほど覚えていきます**。

---

## Act 1: voice → text、揺らがない精度 (0:30 - 1:45)

**[scene]** 文字起こし結果の編集 diff を表示。
- before (Whisper raw): 「マニア・スプレッター」「グレン・コンテナ」「春田機」
- after (vocab inject): 「マニアスプレッダ」「グレンコンテナ」「田植機」

**[overlay]** `transcription_guideline.json` の vocabulary 配列 (37 entry)、ハイライト。

> **ナレーション**:
> 音声認識モデル (Whisper) はそのままだと、業界用語を一般語に書き換えてしまいます。
> 「マニアスプレッダ」が「マニア・スプレッター」に。「グレンコンテナ」が「グレン・コンテナ」に。
>
> Tealus は、**過去にユーザーが訂正した編集履歴**から、その会社の語彙を自動で集めて、
> 文字起こしの前段に「ヒント」として渡します。
>
> 結果、専門用語が **3 連続でも、4 文字短人名でも、正確に保持される**ようになりました。
> 5月12日のテストでは、6 文中 6 文すべて完璧に書き起こせています。
>
> これが Tealus の最初の柱、**"Self-Improving"** ─ 使うほど辞書が育ち、辞書が次の認識を支える、双方向のループです。

**[scene transition]** カーソルが 社内DB検索ルーム のアイコンに移動。

---

## Act 2: 業務 DB に届く messenger (1:45 - 3:15)

**[scene]** 「社内DB検索」ルームを表示。
**[demo]** ユーザーが日本語で質問: 「先月の田植機の販売数を教えて」
**[demo]** AI bot が SQL を組み立てて実行し、表形式で結果を返す。

> **ナレーション**:
> messenger の中で AI と話すだけでは、まだ足りません。
> 業務の真ん中にある **基幹データベース**に AI が直接届かないと、
> 「現場で生まれた質問」を「現場のままの言葉」で解決できないからです。
>
> 5月11日、Tealus は社内の販売管理 DB に **MCP** (Model Context Protocol) 経由でつながりました。
>
> SQL を覚える必要も、別のダッシュボードを開く必要もありません。
> 業務メモを書く同じ messenger の中で、現場の質問が現場のまま答えにたどり着きます。
>
> これが Tealus の 2 つ目の軸、**"AI ネイティブ"** ─ AI は bot として後付けされた飾りではなく、
> messenger の中の対等なメンバーであり、組織のあらゆる context にアクセスできる存在です。

**[scene transition]** 動画ファイルが messenger にドラッグされる手元の俯瞰。

---

## Act 3: voice → video、cross-modality dividend (3:15 - 4:30)

**[scene]** 4 分 39 秒の朝礼動画を upload。
**[overlay]** タイマーが回り、32 秒で完了。
**[scene]** 9 セクションに分割された議事録 + SRT 字幕ファイル。

> **ナレーション**:
> 5月12日、同じ vocabulary を **動画にも適用** できるようにしました。
>
> 4 分 39 秒の朝礼動画を、32 秒で文字起こし、議事録化、字幕ファイル生成まで。
> 2 回目以降は **6 ミリ秒**でキャッシュから返ってきます。
>
> 重要なのは、ここで **voice メッセージで育てた辞書が、そのまま video にも効く**ことです。
> 同じ会社の言葉が、音声 / 動画 / DB ─ すべての modality で整合します。
>
> Tealus はこれを **"cross-modality dividend"** と呼んでいます。
> 1 つの modality に投資した語彙が、別の modality でも利息を生む。
> Phase 1 で蓄積した辞書が、Phase 4 で video の精度を支える。
> **Phase が買い替えではなく、積み上がる**設計だからこそ可能な構造です。

**[scene transition]** iPhone の画面、入力フィールドにフォーカスして拡大される瞬間。

---

## Act 4: 採用者 voice が、翌日のコミットになる (4:30 - 5:45)

**[scene]** タイムライン横軸:
- 5/13 夕方: 採用検討者から「iPhone で入力欄を触ると画面が拡大する」voice
- 5/13 深夜: 原因特定 (iOS Safari の auto-zoom、font-size < 16px)
- 5/14 朝: `4d00839` commit、PWA に 16px 強制 CSS 適用

> **ナレーション**:
> 5月13日の夕方、Tealus を採用検討中の現場から、一声が届きました。
>
> **「iPhone で入力フィールドを触ると、画面がぐいっと拡大されてしまう」**。
>
> 原因は、iOS Safari の長年の挙動。
> 入力フィールドのフォントサイズが 16 ピクセル未満だと、フォーカス時に勝手にズームする ─ それだけのこと。
> ただ、それを **採用者の iPhone で実際に触らないと気付けない**問題でした。
>
> 同じ日の深夜に診断、翌朝にはコミットがマージされました。
> **1 営業日で、現場の voice が機能の改善に翻訳されます**。
>
> これが Tealus が掲げる **"organic ontology"** ─
> あらかじめ完璧な仕様を作るのではなく、**生きた使用の文脈から、後付けで pattern が形成されていく**設計の姿です。

**[scene transition]** git log の visualization、5/7 から 5/13 までの commit dot が時間軸に並ぶ。

---

## Act 5: 1 週間で 4 つの commit、すべて dogfood 起点 (5:45 - 6:45)

**[scene]** git log の dot に hover すると、各 commit の起点 voice / 出来事が pop up。
- `7c275f4` (5/12): 動画文字起こし機能 ← user voice 「動画でも欲しい」
- `2f2969f` (5/12): vocab inject 拡張 ← Whisper が業界用語を壊す
- `4d00839` (5/13): iOS PWA auto-zoom fix ← 採用者の iPhone dogfood
- `bdf3ccc` (5/14): markdown 改行 ← 社内 user 「改行が消えて読みにくい」

> **ナレーション**:
> この 1 週間で Tealus に入った 4 つの大きな変更は、**全部、誰かの実際の使用から生まれました**。
>
> 採用検討者の iPhone、社内ユーザーの改行感覚、朝礼の動画、業界用語の発音。
>
> Tealus は単に「使うほど賢くなる」のではありません。
> **使うほど、自分自身に追いついていく**。
>
> ユーザーが使い、AI が困り、人が訂正し、設計が学ぶ ─ このループが、毎週何かを生み出します。
>
> どれも「思いついた機能」ではなく、「**起きた事象**」が機能になっています。

---

## Closing (6:45 - 7:30)

**[scene]** tealus.dev のトップページ、`docker-compose up` の 1 行コマンド。

> **ナレーション**:
> Tealus は OSS です。Docker 1 コマンドで、Synology や QNAP の NAS 1 台で動きます。
>
> あなたの組織で **1 週間使ってみないと**、何が起きるかは分かりません。
> 私達にもまだ、わからない部分があります。
>
> でも、その 1 週間で、**何かが整い始める** ─ それだけは保証できます。
>
> 一緒に育てていきませんか。

**[scene final]** Tealus ロゴ + tealus.dev URL + GitHub QR コード。

---

## 注釈 / 取材ノート

- 朝礼動画 / 業務メモは **匿名化必要** (社名 / 個人名 → "農機販売会社 A" / "現場スタッフ" 等)
- 採用者 voice は **仮名化** ("採用検討者 X")、許諾範囲を明文化してから収録に進む
- git log visualization は `tooling/walkthrough-git-viz.{html,svg}` 等で別途制作 (sub-issue 切り出し)
- 「6 文中 6 文完璧」「32 秒で transcribe」等の数値は `feedback_whisper_vocab_inject_dogfood.md` / `project_step29_video_transcribe.md` / commit log と照合済 (5/14 時点)

## 用語の整理 (script 内で使う Tealus 固有概念)

| 用語 | script 内での説明 |
|---|---|
| **Self-Improving** | 使うほど辞書が育ち、辞書が次の認識を支える双方向ループ (Act 1) |
| **AI ネイティブ** | AI が後付け bot ではなく、messenger の対等なメンバー (Act 2) |
| **cross-modality dividend** | 1 modality に投資した語彙が別 modality で利息を生む構造 (Act 3) |
| **organic ontology** | 生きた使用の文脈から、後付けで pattern が形成される設計姿勢 (Act 4) |

これらは現状 `philosophy.md` (4/30 v1) に**未反映**の言語化。
sub-1 (philosophy refresh) でこの 4 用語を 4 柱 narrative に統合する想定。

## 次のステップ

1. **user review** → narrative line OK か / 削るべき act / 補強すべき act
2. **匿名化基準の確定** (どこまで具体化するか、社名 OK か)
3. **収録 / 編集は別 cycle** (script v2 確定後に sub-issue 切り出し)
4. **sub-1 (philosophy refresh) との整合**: 上記 4 用語を philosophy.md にも反映、script ↔ doc が同じ語彙を共有

## 関連 source

- `feedback_whisper_vocab_inject_dogfood.md` (5/12) ─ Act 1 数値根拠
- `project_internal_db_mcp_dogfood.md` (5/11) ─ Act 2 事例
- `project_step29_video_transcribe.md` (5/12) ─ Act 3 timing 数値
- `feedback_ios_input_autozoom_16px.md` (5/13) ─ Act 4 事例
- commits `7c275f4` / `2f2969f` / `4d00839` / `bdf3ccc` ─ Act 5 git log
- `feedback_demo_priority_stance.md` (5/13) ─ 物語化優先 stance との整合
- #209 (umbrella) / #265 (ブログ立ち上げ、publish 先候補)
