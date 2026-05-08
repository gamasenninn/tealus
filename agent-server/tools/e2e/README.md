# Light agent E2E verification harness (#262)

`agent-server/tools/e2e/` は Light / Light v2 / Deep agent の **調整 phase verification run** 用の scenario runner。CI gate ではなく、fix の前後で「scenario set を 1 回流して挙動 verify する」用途。

## 設計方針

- 既存の log + chat 履歴を観察 surface として活用 (新 infra 増やさない)
- 実環境 path 全通す (CLI が Tealus API 経由で test room に投下)
- 専用 test bot user + 専用 sandbox room で隔離 (本番 DB / 履歴汚さない)
- TTS は test room 設定で disable (Aivis 課金回避)
- sequential 実行 (TTS / mcp_cache 干渉回避)

詳細: GitHub issue #262 / `scenario-schema.md`

## 前提

### 環境変数 (`.env` に追加 or 専用 `.env.e2e`)

```
TEALUS_E2E_BOT_ID=e2e-runner
TEALUS_E2E_BOT_PASS=<bot 用 password>
TEALUS_E2E_ROOM_ID=<test room の UUID>
```

### Tealus 側 setup (1 回だけ実行)

1. **Bot user 作成** (admin API or seed script):
   ```bash
   # admin token を取得済として
   curl -X POST $TEALUS_API_URL/api/admin/users \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"login_id":"e2e-runner","display_name":"E2E Test Runner","password":"<pass>","role":"user","is_bot":true}'
   ```

2. **Test room 作成** (group):
   ```bash
   curl -X POST $TEALUS_API_URL/api/rooms \
     -H "Authorization: Bearer $USER_TOKEN" \
     -d '{"name":"e2e-sandbox","member_ids":["<e2e-runner-uuid>","<アシスタント-uuid>"]}'
   ```

3. **Test room の TTS disable** (room settings)
   - Aivis 課金回避のため

## 使い方

```bash
# 全 scenario run
node agent-server/tools/e2e/run.js

# 特定 scenario のみ
node agent-server/tools/e2e/run.js --filter S1,S2

# dry-run (投下せず schema validation のみ)
node agent-server/tools/e2e/run.js --dry-run
```

出力: `report/e2e-runs/YYYY-MM-DD-NNNN.md` (非公開方針準拠、`project_internal_reports_policy.md`)

## ファイル

- `scenarios.json` — scenario 定義 (初期 6 件)
- `scenario-schema.md` — schema 仕様
- `run.js` — runner CLI
- `report.js` — markdown report generator
- `README.md` — このファイル

## 想定 use case

| trigger | 期待動作 |
|---|---|
| #260 (Light v2 機能 parity) fix 完了時 | S4 が pass する事を verify |
| #261 (vision fallback) fix 完了時 | S3 が pass する事を verify |
| router 周辺の修正時 | S2 / S5 / S6 で regression check |
| Light agent 改善時 | S1 で cross-room 探索の質的変化を観察 |

## 注意

- **本番 DB 汚染 NG**: scenarios.json 編集時、`test_room_env` 経由で test room を指す事を再 verify
- **API cost**: 1 run ~$0.5-1 程度 (gpt-5.4-mini)、Light v2 は subscription path で 0
- **regression suite 化**: 後続 fix で scenario 1 件追加して累積、初期 6 件は出発点

## 関連

- issue: [#262](https://github.com/gamasenninn/tealus/issues/262)
- 関連 fix: #258 #260 #261
- 設計議論: 業務メモ 2026-05-08 朝 thread
- 関連 memory: `feedback_lightv2_explicit_prompt.md`, `feedback_lightv2_pdf_limitation.md`
