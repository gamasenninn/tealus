# Tealus Demo Scenarios (Phase 0 共通素材)

audience 別 Full pitch / 短尺 / 動画 / LP すべてで使う **demo 素材**。最初は **Scenario A** に絞り、足りない / 別 audience 用が出てきたら追加する。

最終更新: 2026-04-30 v1

---

## Scenario A: 業務無線 → AI 文字起こし → 検索 → 自動学習

**「使うほど賢くなる」が一発で伝わる demo。Tealus の独自性 (self-improving、AI ネイティブ、業務無線統合) を 5 分で全部見せる。**

### 一言で

> **業務無線で「ガマさん、田植機持ってきて」と言うだけで、Tealus が自動で文字起こし、組織固有の語彙で正規化、過去の議論と紐付けて検索可能にする。さらに user が訂正すると、次回から自動的に正しく転写される。**

### 演出の流れ

#### Setup (~30 sec)
1. Tealus の **業務メモルーム** を画面に表示
2. 過去の業務発話 (voice message + 文字起こし) が並んでいる状態を見せる
3. 「これは農機販売店の業務メモです。1 ヶ月分の業務無線が文字起こしされて記録されています」

#### Phase 1: 録音と即時投稿 (~60 sec)

🎤 **発話**: 「ガマさん、ビレッジ側の田植機を取りに来てください」

- 業務無線 / マイク経由で発話
- Tealus に **voice message が自動投稿**される
- 「録音 → アップロード → 文字起こし開始」がリアルタイムで遷移
- (内部) Whisper API で raw_text を取得

📺 画面で見えるもの:
```
[業務メモ ルーム]
12:34:56 [小野] 🎤 voice (転写中...)
            ↓ ~3秒
12:34:59 [小野] 🎤 voice
            "カナさん、ヴィレッジ側のタウン駅を取りに来てください"
                ↑ raw_text (Whisper の素直な転写)
            ↓ ~5秒 AI 整形
            "ガマさん、ビレッジ側の田植機を取りに来てください"
                ↑ formatted_text (vocabulary 適用後)
```

#### Phase 2: 「Whisper の素直な転写」 vs 「組織固有 vocabulary 適用後」 (~60 sec)

スライドで before / after 比較:

| | Whisper raw_text | AI 整形 formatted_text |
|---|---|---|
| 人名 | カナさん ← 誤認 | ガマさん |
| 地名 | ヴィレッジ側 | ビレッジ側 |
| 機材 | タウン駅 ← 完全に外す | 田植機 |

説明: 「Whisper は **汎用音声認識**なので、組織固有の人名・機材名・場所名が分からない。Tealus は **組織ごとに育てた vocabulary** を AI 整形プロンプトに注入することで、これらを正規化する。」

(技術深掘り) 「**Whisper の `prompt` parameter にカ vocabulary を渡すと隣接音が歪む**副作用があるので、Tealus は **AI 整形段階に正規化を集約** する設計にしている。」

#### Phase 3: 検索 (search_messages) (~60 sec)

「**過去 1 ヶ月の『田植機』関連の発話を引く**」

- 入力: `search_messages(q="田植機", since="2026-04-01")`
- 結果: 30+ 件の発話、すべて formatted_text の正規化された「田植機」でヒット
- snippet ハイライト付きで関連箇所が見える

📺 画面で見えるもの:
```
[検索結果: 田植機]
- 「**田植機**を取りに来てください」 (ガマさん、4/29 12:35)
- 「**田植機**点検の見積もり」 (整備長、4/28 09:12)
- 「ヤフオクで落札された **田植機** PVH-1P」 (斉藤くん、4/26 14:20)
...
```

説明: 「**vocabulary が無いと**『タウン駅』『耐雨機』『タオル液』など別の単語で記録されているので、『田植機』で検索しても **ヒットしない**。Tealus は AI 整形で正規化されているので、**全部「田植機」として一発で引ける**。」

#### Phase 4: 自動学習 (mining script) (~60 sec)

新しい誤転写を発見 → user が修正 → 自動学習。

📺 画面で見えるもの:
```
1. 新しい voice メッセージ: 「タウン液を持ってきて」
   ↑ Whisper が「田植機」を「タウン液」と誤認 (新ブレ)
2. user が手動編集: formatted_text を「田植機」に修正
3. 編集履歴が voice_transcriptions テーブルに記録
   ↑ AI 版 (raw="タウン液") と user 編集版 (formatted="田植機") のペア
4. 翌日: 「mining script を走らせます」
   $ node scripts/mine_transcription_aliases.js --mode=by-term --threshold=2
5. 結果: 「タウン液 → 田植機」が新 alias 候補として report
6. user 確認 → vocabulary に追加
7. 次回: 「タウン液」が AI 整形で自動的に「田植機」に正規化
```

説明: 「**編集 = ラベル付き訓練データ**。Tealus は **自動的に学習素材を蓄積**して、organization-specific な辞書を時間とともに育てる。これが『**使うほど賢くなる**』の実装。」

#### Phase 5: 1 ヶ月後・1 年後 (説明、live demo なし) (~30 sec)

「1 年使い続けると、vocabulary は数百件、guidelines は数十件まで成長する。組織の独自語彙が辞書として永続化される。新人が入っても、**先輩たちの語彙を AI が記憶している**。これが Tealus の『**人と AI の混合チーム OS**』の core だ。」

---

## Demo 形式別の調整

### Lightning (5 min) - Phase 1+2 のみ

「録音 → vocabulary なし vs あり比較」だけ。Phase 3-5 は説明スライドで補足。

```
0:00 Setup (10s)
0:10 Phase 1: 録音 (60s)
1:10 Phase 2: vocabulary 比較 (60s)
2:10 「これがどう活きるか」(120s 説明スライド)
4:10 Q&A buffer
5:00 Done
```

### 中尺 (15-20 min) - 全 Phase

```
0:00 Setup + 思想 (3 min、philosophy.md から引用)
3:00 Phase 1+2 録音と vocabulary (3 min)
6:00 Phase 3 検索 (2 min)
8:00 Phase 4 自動学習 (3 min)
11:00 Phase 5 説明 (2 min)
13:00 アーキテクチャ要約 (architecture-summary.md から、3 min)
16:00 Q&A
20:00 Done
```

### Full pitch (30-45 min) - Demo は 7-10 min

Demo を中尺レベルに保ち、思想 / アーキテクチャ / Phase 1-5 vision / 採用方法 / コミュニティ / Q&A を厚く。

### 動画 (5-10 min) - 字幕付き

Phase 1+2+3+4 を圧縮、screen recording + ナレーション。LP に embed 想定。

### LP (静的) - GIF / 静止画

各 Phase の **before / after 静止画** + 短いキャプション。スクロール式のストーリー演出。

---

## 必要 Assets

### live demo 時 (推奨)
- ✅ Tealus instance (running、 業務メモルーム pre-loaded)
- ✅ 業務無線端末 or マイク
- ✅ vocabulary が育っている状態 (Step 14 で 37 件、demo 用に anonymize 候補)
- ✅ mining_report.json サンプル (by-term mode 結果)
- ✅ ネット接続 (OpenAI API)

### 動画収録時
- 上記 + screen recording tool (OBS / Loom 等)
- 字幕用 transcript

### 静的 (LP / 静止画)
- Phase 1-5 の screenshot
- before / after 比較画像
- アーキテクチャ図 (`architecture-summary.md` の図を画像化)

---

## Anonymize 方針 (将来 Phase 2)

現在の Phase 1 (OSS 採用検討者向け pitch) は **リアル感覚で進める方針** (user 判断 A2、2026-04-30)。実 demo では実 user (小野哲)、実 organization の語彙 (ガマ、みこがい、田植機、ビレッジ側等) を使い、説得力を最大化する。

**将来の Phase 2 以降** (audience 拡大、pitch 派生 v2 公開時) で anonymize を検討:

| 種類 | 実例 → anonymize 案 (Phase 2 候補) |
|---|---|
| 人名 | ガマさん → 山田さん、みこがい → 鈴木 等 |
| 場所名 | ビレッジ側 → 1 号棟、ファーム → 倉庫 等 |
| 機材名 | 田植機 → 業務機材 (or そのまま、業界標準語なので) |
| 取引先 | 池田農機 → A 社、日東鉄道 → B 社 |

**実機 demo は agriculture context、Phase 2 以降の generic 公開資料は「業務組織」context** で書き分けると audience の幅が広がる。

→ Anonymize 実装は Phase 2 着手時に別 issue で検討。

---

## 想定 Q&A (Demo 後)

| Q | A |
|---|---|
| 「録音の質はどう？エコーは大丈夫?」 | Whisper は SoTA レベル、業務無線の音質でも実用十分。エコー対策は CLI --watch の VOX 検知で軽減 |
| 「vocabulary を 37 件まで育てるのに 1 ヶ月? 大変では?」 | 最初の数日で頻出語彙は揃う。残りは mining script (Phase 1) で自動発見、Phase 2 で auto-update 予定 |
| 「データの privacy は?」 | Tealus は self-hosted、自社の NAS で動く。OpenAI API への送信は **設定で OFF 可能** (Whisper は音声、gpt-4o-mini はテキスト) |
| 「OpenAI に依存しない選択肢は?」 | 設計上 swap 可能、local Whisper / Ollama 統合は roadmap (#XXX 別 issue) |
| 「他の messenger との連携は?」 | LINE 連携 ([#160](https://github.com/gamasenninn/tealus/issues/160)) で計画中、Webhook ベース |
| 「コスト感は?」 | OpenAI API 代 + NAS 電気代 + (オプション) Aivis API。SMB 規模なら月 1000-3000 円程度 |
| 「導入手順は?」 | `git clone` → `.env` 設定 → `docker-compose up`、約 30 分 |

---

## 改訂履歴

- 2026-04-30 v1: Scenario A の初版。Phase 1-5 の演出構成、形式別の尺調整、Anonymize 方針、想定 Q&A まで。Scenario B/C/D は audience 別 Full pitch 着手後に追加。
