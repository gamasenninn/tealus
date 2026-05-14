# 通知設定とトラブルシューティング

Tealus で通知が届かない / バックグラウンド中に通知が止まる場合の対処手順。

v0.2.4 (2026-05-12) で **foreground (Socket.IO) + background (Web Push + Service Worker) の二経路 defense in depth** を実装済 ─ 片方の path が落ちても他方で補完する設計だが、両 path とも前提条件があるため、本 doc で順を追って確認する。

## 1. PWA としてインストールする (前提)

通知をバックグラウンドで安定して受け取るには、Tealus を **PWA としてインストール** するのが推奨。Web ページとして開いたままだとブラウザがタブを suspend する可能性が高い。

### iPhone (iOS Safari 16.4 以上推奨)

1. Safari で Tealus にアクセス
2. 共有ボタン → 「ホーム画面に追加」
3. ホーム画面の Tealus アイコンから起動 (初回に通知許可ダイアログ)

### Android (Chrome)

1. Chrome で Tealus にアクセス
2. メニュー → 「ホーム画面に追加」または「アプリをインストール」
3. ホーム画面のアイコンから起動

### PC (Chrome / Edge)

1. アドレスバー右端の「アプリをインストール」アイコン
2. Tealus が独立ウィンドウで起動

## 2. ブラウザの通知許可を確認する

- 初回起動時の通知ダイアログで「許可」を選んだことを確認
- 後から変更した場合: ブラウザ設定の「サイトの権限」→ Tealus → 通知 = **許可**
- iOS Safari: 設定 → 通知 → Tealus → 「通知を許可」を ON

## 3. OS のバックグラウンド動作 / バッテリー最適化を確認する

OS や端末メーカーがリソース節約のためバックグラウンドアプリを停止することがある。

### iPhone

- 設定 → 一般 → App のバックグラウンド更新 → Tealus を ON
- 低電力モード中は SW が止まることがあるため、業務用途では OFF 推奨

### Android

- 設定 → アプリ → Tealus → 電池 → **「バックグラウンドでの実行を許可」/「制限なし」**
- メーカー独自のバッテリー最適化 (Xiaomi MIUI / Huawei EMUI / Samsung One UI 等) はメーカー設定からも除外が必要なケースが多い

### PC

- ブラウザがバックグラウンドで動作している必要あり
- システムトレイに常駐するブラウザ設定にすると安定

## 4. それでも通知が来ない場合

### 二経路 defense in depth の仕組み (v0.2.4+)

| 経路 | 動作条件 | カバー範囲 |
|---|---|---|
| **foreground** (Socket.IO) | Tealus が画面表示中 / SW alive | リアルタイム表示、未読バッジ即時更新 |
| **background** (Web Push + SW) | OS / ブラウザが SW を起こせる状態 | foreground 落ち時のフォールバック、ホーム画面アイコンのバッジ更新 |

両 path とも、OS が SW を完全に kill した状態では通知できない。`#1` (PWA インストール) と `#3` (バックグラウンド許可) がベースライン条件。

### よくある現象と確認順序

| 現象 | 確認ポイント |
|---|---|
| しばらく操作しないと通知が止まる | OS のバッテリー最適化からの除外 (#3) |
| 通知は来るが iPhone でバッジ数字が出ない | iOS 16.4 以上 + PWA としてインストール済か (#1) |
| Android で通知音が鳴らない | OS の通知設定 → 音 / バイブを許可 |
| PC で通知が来ない | ブラウザの通知 OS 連携 + フォーカスアシスト OFF |
| 全く来ない | まず `#2` ブラウザの通知許可、次に `#1` PWA インストール |

### 報告する場合

GitHub Issue [#168](https://github.com/gamasenninn/tealus/issues/168) にコメント、または端末情報 (OS / ブラウザ / PWA 有無 / 発生条件) を添えて報告。

## 5. 既知の制限

- **Firefox**: PWA Badging API 未対応 (silent fail、設計通り)。Chrome / Safari / Edge 推奨
- **iOS Safari < 16.4**: Badging API 未対応、通知のみ受け取り可能 (バッジ数字なし)
- **Android Chrome**: バッジは **ドット表示** (Android 仕様で数字未対応)
- **iOS Safari 16.4 以上 (PWA)**: バッジは **数字表示**
- **Web Push 全般**: OS が SW を完全に kill した期間は通知が遅延 / 失われる可能性あり
- **マルチデバイス同期**: 同 user の複数端末でバッジが個別計算 (個別端末で既読状態反映)、5/12 dogfood 残課題 (採用者複数端末利用が surface した時点で再着手予定)

## 関連

- [#168](https://github.com/gamasenninn/tealus/issues/168) — バックグラウンドプッシュ通知の安定化 (本 doc の起源 issue)
- [#160](https://github.com/gamasenninn/tealus/issues/160) — LINE 連携ブリッジ (フォールバック通知 path として将来検討)
- [CHANGELOG.md](../../../CHANGELOG.md) v0.2.4 — Badging API + 二経路 defense in depth 実装ノート
- `memory: project_step30_pwa_app_badge.md` (5/12) — PWA App Badge 実装詳細
- `memory: feedback_badging_api_platform_differences.md` (5/12) — platform 差 + defense in depth pattern
