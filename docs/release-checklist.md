# リリース チェックリスト

リリース作業の手順書。**下流（LP / tealus-docs / README）が引用している値の差分を流す**ところまでがリリースです。

> 更新する側（採用者）の手順は [アップグレードガイド](upgrade-guide.md) を参照。こちらは**出す側**の手順です。

## バージョニングの約束

- **バージョンの source of truth は git タグ**。`package.json` の `version` は 4 つとも `0.1.0` 据え置きで、実行時に読むコードは無い（意図的。毎リリース bump する運用を固定していないため、タグのみが一貫している）。**「上げ忘れ」と誤認して直さないこと。**
- **機能追加のバッチは minor bump**（`0.6.0` → `0.7.0`）。`patch` は「修正だけ」の含意になり、内容に対して過小表示になる。

## 手順

### 1. CHANGELOG.md に 1 節追記

[Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) 形式。★ テーマ行 + `Added` / `Changed` / `Fixed`。

読者像は「**更新する人＝採用者・実装者**」。設計判断の理由まで書いてよい（tealus-docs 側の `releases.md` は要約 + リンクに徹し、詳細はここに委ねる分担）。

### 2. 型検査とテスト

```bash
cd server       && npx tsc --noEmit && npm test
cd agent-server && npx tsc --noEmit && npm test
cd client       && npx tsc --noEmit && npx vitest run
```

### 3. ★ 「外部から見える数字」の差分を洗う

下流が**コピーしている**値は、変えた側が流さないと**全部同時に腐る**。実際に 2026-07-31 の v0.7.0 で、リアクション数が **LP・本体 README・tealus-docs の 3 か所で同時に古い**状態になっていた。

このリリースで下記が変わったかを確認し、変わったものは **7. の周知に 1 項目として明記する**。

| 値 | 現在 | source of truth |
|---|---|---|
| Node 要件 | 24 | `package.json` の `engines`（6 パッケージ）/ `*/Dockerfile` / `.github/workflows/*.yml` |
| MCP ツール数 | 18 | tealus-mcp（別リポ）の tools 定義。**版で見える数が違う**ので「v0.14.8 以降で 18」のように版を添える |
| 絵文字リアクション | 7 | `client/src/components/chat/ContextMenu.tsx` の `REACTION_EMOJIS` |
| 選択できる TTS の声 | 10 | `client/src/components/chat/RoomSettings.tsx` の `TTS_MODELS`（先頭の「デフォルト（環境変数）」を除く） |
| migration の最新番号 | 026 | `server/src/db/migrations/` |
| cc-bridge の接続寿命 | 55 分 (3300 秒) | `agent-server/src/routes/ccQueue.mts` の `maxAgeMs()` 既定。★ **`SKILL.md` が取得失敗時の退避として 3300 をハードコードしている**ので、既定を変えたら消費側も直す |

```bash
# 変化の確認（前タグとの差分）
git diff v0.6.0..HEAD -- client/src/components/chat/ContextMenu.tsx \
  client/src/components/chat/RoomSettings.tsx '*package.json' server/src/db/migrations
```

★ **新しく「数えられるもの」を作ったら、この表に足すこと。** 表に無い値は誰も追わない。

### 4. コミット → 注釈タグ → push

```bash
git add CHANGELOG.md docs/upgrade-guide.md
git diff --cached --stat        # ★ 意図しないファイルの相乗りを確認
git commit -m "リリース vX.Y.Z: CHANGELOG 更新"
git tag -a vX.Y.Z -F -          # テーマ + 主要 issue の箇条書き
git push origin main && git push origin vX.Y.Z
```

### 5. GitHub Release を作成

CHANGELOG の該当節 + `vA...vB` の compare リンク + **更新時の急所**（何をしないと壊れるか）。

### 6. `docs/upgrade-guide.md` の「バージョン別ノート」に 1 節追記

採用者が踏む地雷を、**必須の作業 / 任意 / この版で直った不具合**の順で。「クラッシュしないが機能が静かに壊れる」種類（migrate 忘れ・client 再ビルド忘れ・依存追加）は必ず ★ を付ける。

### 7. AI班連絡へ周知

各班に効く点を先頭に。**3. で変わった数字があれば必ず入れる**（下流はここを見て追従する）。

### 8. ★ README のロードマップを見直す

出荷した分を消し、順序が変わっていれば直す。**誰の仕事でもない状態にすると腐る**ので、リリース手順に含める。

以前のロードマップ節は 69 行まで育って腐り、「これから」の 10 項目中 9 項目が既に CLOSED、「現在 v0.2.4」が 5 リリース前、という状態で削除した（`d21e941`）。読者には**実態と正反対**（止まっているプロジェクト）に見えていた。再発させないための 4 つのルール:

- **バージョン番号を書かない** — CHANGELOG にリンクするだけ（「現在 v0.2.4」が腐りの元凶だった）
- **完了項目を書かない** — 完了は CHANGELOG が持つ（`✅ 消化済` の羅列が旧節の半分を占めていた）
- **日付入りの経過を書かない** — 日誌は git 履歴と `report/` の役目
- **10 行を超えたら詳細を Issue へ逃がす** — 薄ければ 1 行の古さが目立つ。長いと埋もれる

## 引き継ぎ先

- 下流の追従: tealus-docs は**リリース単位**で追従する（本体 issue 単位ではない）。`releases.md` は要約 + 更新時の急所 + リンクのみ、`upgrade-guide.md` は**転載せずリンク**。
- LP（tealus.dev）に載せる主張は、**実運用で効果を確認済みのものだけ**。実装があっても実績が無いものは Proof に置かない。
