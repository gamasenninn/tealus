# E2E Scenario Schema (#262)

`scenarios.json` の field 仕様。runner は loose match で評価する (LLM の non-determinism を許容しつつ、決定論可能な layer は機械 check)。

## metadata

| field | 必須 | 説明 |
|---|---|---|
| `version` | ✅ | scenarios.json の schema version |
| `test_room_env` | ✅ | 投下先 room ID を読む env var 名 (例: `TEALUS_E2E_ROOM_ID`) |
| `test_user_env.login_id` | ✅ | runner が投下に使う test user の login_id env var |
| `test_user_env.password` | ✅ | 同 password env var |
| `agent_log_path` | ✅ | log file の path template (`{date}` placeholder) |
| `default_timeout_ms` | ✅ | scenario あたりの全体 timeout (default fallback) |

## scenarios[] の各 entry

### 必須 field

| field | type | 説明 |
|---|---|---|
| `id` | string | scenario id (例: `S1-cross-room-tag-organize`)、ファイル / report で識別 |
| `description` | string | 1 行説明、何を verify したいか |
| `prompt` | string | Tealus に投下する message text。`<TEST_BOT_NAME>` 等の placeholder は runner が解決 |
| `target_agent` | `"light"` \| `"light2"` \| `"deep"` \| `"router"` | 想定 routing 先 (verify 用) |

### Optional - tool chain 評価

`expected_tool_chain` (object):
- `must_include[]`: scenario 中に必ず call される tool 名一覧 (順不同)
- `should_include[]`: 出れば pass、出なくても warn (fail にはしない)
- `must_include_any_of[]`: いずれか 1 つでも出れば pass
- `must_not_include_any[]`: 出てはいけない tool 名 (fail trigger)

判定: log の `[Light] Tool 使用:` / `[LightV2] mcp_tool_call OK:` line から tool 名を抽出。

### Optional - response 評価

`expected_response` (object):
- `must_contain[]`: 応答 text に必ず含まれる substring (case-insensitive)
- `must_not_contain[]`: 応答 text に含まれてはいけない substring
- `min_chars` / `max_chars`: 応答長 threshold

判定: chat 履歴から bot の最終応答を取得して照合。

### Optional - chat 副作用評価

`expected_chat_messages` (object):
- `must_have_image`: 画像 attachment 付き message が投稿された事
- `must_have_file`: file attachment 付き message が投稿された事

### Optional - log line 評価

`expected_log_lines[]`: log file 中に必ず現れる substring 一覧 (例: `"Router (rules): light2"`)

### Optional - metrics 閾値

`metrics` (object): 超えたら warn、fail にはしない (LLM の non-determinism)
- `max_input_tokens` / `max_output_tokens`
- `max_latency_ms`: 投下から `turn completed` log まで

### Optional - 前提条件

`preconditions` (object):
- `attach_pdf` / `attach_image` / `attach_file`: scenario 実行前に test room に対象 file を投稿しておく
- `note`: 人向けメモ

### Optional - LLM-as-judge (#262 Phase 2.b)

`llm_judge` (object): bot 応答を LLM (default `gpt-4o-mini`) に採点させる。**観察層 (warn-only)** で扱う、score < min_score → warn だが fail にはしない (LLM 採点の variance を許容)。

- `criteria` (string、必須): 応答が満たすべき要件を列挙した natural language の指示。多項目を改行 / 番号付き list で書くと安定。
- `min_score` (number、optional、default 70): pass 判定 threshold (0-100)。

判定: `judge.js` が OpenAI API (`E2E_JUDGE_MODEL` 環境変数で切替可、default `gpt-4o-mini`) で `{score, reasoning}` の JSON を要求。`E2E_JUDGE_API_KEY` か `OPENAI_API_KEY` が必要、未設定なら judge は skip (warn のみ)。

例:

```json
"llm_judge": {
  "criteria": "応答が以下を満たすか:\n1. 業務メモ room の messages を実際に参照している\n2. タグ別に分類されている",
  "min_score": 70
}
```

### Optional - 人 review 欄

`manual_check`: 自動判定で覆い切れない部分を report に手動チェック欄として転記。

### Optional - skip 条件

- `skip_if_not_available`: deep agent が DEEP_AVAILABLE=false なら skip 等

## 判定 layer の優先順位

1. **決定論層** (machine、fail trigger):
   - `expected_tool_chain.must_include` / `must_not_include_any`
   - `expected_response.must_contain` / `must_not_contain`
   - `expected_log_lines`
   - `expected_chat_messages`
2. **観察層** (warn のみ):
   - `expected_tool_chain.should_include`
   - `metrics` 閾値超え
   - `llm_judge` score < min_score (#262 Phase 2.b)
3. **人 review 層** (manual):
   - `manual_check` を report に転記、人が後で chk

## 例

```json
{
  "id": "S2-router-mention-strip",
  "description": "group room で @<bot> /light2 ... が v1 落ちしないか",
  "prompt": "@<TEST_BOT_NAME> /light2 こんにちは",
  "target_agent": "light2",
  "expected_log_lines": ["Router (rules): light2"],
  "expected_response": { "min_chars": 5 },
  "metrics": { "max_latency_ms": 30000 },
  "manual_check": "log で 'Router (LLM): light' が出ていないこと"
}
```
