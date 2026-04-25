# Branch Protection 適用手順

`main` ブランチへの保護ルール定義。**リポを Public 化した直後** に適用する。

## 背景

GitHub Free プランでは Private リポに Branch protection を設定できない（`Upgrade to GitHub Pro or make this repository public to enable this feature.`）。
Tealus は v0.1.0 公開前まで Private のため、公開時に Public 化と同時に保護を有効化する。

## 設定内容

[`branch-protection.json`](./branch-protection.json) を参照。要点:

- ✅ Pull Request 経由の merge を必須化（required reviews: 0、solo dev のため自分で即マージ可）
- ✅ CI 4 ジョブ（server-test / client-build / dashboard-build / agent-server-test）の green を必須化
- ✅ Linear history のみ（squash / rebase merge、merge commit 不可）
- ✅ Force push / branch 削除を禁止
- ❌ `enforce_admins: false` で admin（owner）は緊急時に bypass 可能

## 適用コマンド

リポを Public 化した直後に以下を実行:

```bash
gh api -X PUT repos/gamasenninn/tealus/branches/main/protection \
  --input .github/branch-protection.json
```

成功すると JSON で現在の保護設定が返る。
失敗（HTTP 403）が出た場合は、リポがまだ Private か、認証トークンの権限不足。

## 確認

```bash
gh api repos/gamasenninn/tealus/branches/main/protection | jq '.required_status_checks.contexts'
# → ["server-test (20)", ...]
```

## 関連リポ

`tealus-docs` と `tealus-site` には CI が未整備のため、保護を入れる場合は `required_status_checks` を null にした別 JSON を用意する。Public 化のタイミングで判断。

## 関連 Issue

- #178 公開前準備チェックリスト B-4
