# Dependency License Audit

Tealus は MIT License で公開される。依存関係の互換性を維持するため、本ドキュメントで監査ポリシーを規定する。

## ポリシー

### 許容
- ✅ **MIT, ISC, BSD (2/3-clause), Apache-2.0, 0BSD, CC0, Unlicense**: 制限なく使用可
- ⚠️ **MPL-2.0**: file-level copyleft。MPL'd ファイルを変更した場合のみ変更を共有する義務。runtime 利用は問題なし
- ⚠️ **LGPL-3.0**: dynamic linking なら問題なし。static link 時は注意（通常は dynamic link で運用）

### 禁止
- ❌ **GPL（v2/v3）**: viral copyleft、Tealus 全体が GPL 化を強制される
- ❌ **AGPL**: GPL に加えてネットワーク経由利用にも viral 性が及ぶ

## 現在の状況（2026-04-25 監査時点）

### server/
- 224 packages
- MIT 196 / BSD-2-Clause 11 / ISC 8 / Apache-2.0 5 / BSD-3-Clause 3
- ⚠️ `web-push@3.6.7` (MPL-2.0) — Web Push 通知ライブラリ、Mozilla 開発、許容
- ⚠️ `@img/sharp-win32-x64@0.33.5` (Apache-2.0 AND LGPL-3.0-or-later) — sharp の Windows バイナリ、LGPL 部は libvips の dynamic link、許容

### client/, dashboard/, agent-server/, mcp-server/
- 全て MIT / ISC / BSD / Apache-2.0 のみ
- 注意ライセンスなし

### rtc-server/
- 監査未実施（mediasoup 系で確認推奨）

## 手動監査の実行

各パッケージで:

```bash
cd server
npm run license-check       # サマリ表示
npm run license-fail-on-gpl  # GPL/AGPL があれば exit 1
```

`license-checker-rseidelsohn` を使う（本家 `license-checker` は読み込みエラーで動作不可、fork 版を採用）。

## 新規依存追加時の手順

1. `npm install <package>` 後、`npm run license-check` を実行
2. 出力に `GPL`, `AGPL` が含まれていないか確認
3. MPL / LGPL が増えた場合は本ドキュメントに追記し、運用上の影響を判断
4. 不明な場合は本 Issue（`.github/LICENSE_AUDIT.md`）に追記して PR レビューに含める

## CI 連携（今後の検討）

現状は CI に組み込んでいない（PR ごとの実行コストを抑えるため）。将来は以下のオプション:

- 軽量: 月次の手動監査
- 中程度: GitHub Actions の nightly job として実行
- 厳格: 全 PR で license-fail-on-gpl を必須化

v0.1.0 公開時点では「手動 + ドキュメント追記」運用とする。

## 参考

- [SPDX License List](https://spdx.org/licenses/)
- [Choose an open source license](https://choosealicense.com/)
- [GNU License compatibility table](https://www.gnu.org/licenses/license-list.html)
