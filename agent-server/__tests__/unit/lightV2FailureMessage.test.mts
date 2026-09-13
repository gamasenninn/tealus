/**
 * ★★★★ #431 — Light v2 が落ちたとき、部屋に何を出すか (2026-09-12)
 *
 * ## なぜ要るか
 *
 * 2026-09-11 の採用者環境では、**2 つの別々のタイミング**で情報が来た:
 *
 * ```
 * ① stream の途中   400 {"message":"The 'gpt-5.4-mini' model is not supported
 *                        when using Codex with a ChatGPT account."}   ★ 相手の言い分。断定的
 * ② 最後の例外       Codex Exec exited with code 1
 *                    ERROR codex_models_manager::manager: ...          ★★ 両義 (#431)
 * ```
 *
 * ★ 現行は ① を**ログに出すだけ**で部屋には出さず、② の生の抜粋を部屋に出していた。
 * → ★★ **いちばん確かなことを持っているのに、使っていない。**
 *
 * ## 守る約束
 *
 * ★★★ **分からないときは、今までどおり生の抜粋を出す。**
 *   案内文に差し替えると「AI の起動に失敗しました。ログを確認してください」になり、
 *   **情報が減る** (2026-09-11 の 400 本文は、そのまま読めば原因が分かる文だった)。
 */
import { buildLightV2FailureMessage } from '../../src/agents/lightV2.mts';
import { detectCodexAuthError } from '../../src/lib/codexAuthError.mts';

const MODEL_400 = detectCodexAuthError(
  '400 {"type":"invalid_request_error","message":"The \'gpt-5.4-mini\' model is not supported '
  + 'when using Codex with a ChatGPT account."}',
);
const MODELS_REFRESH = detectCodexAuthError(
  'Codex Exec exited with code 1\n  ERROR codex_models_manager::manager: failed to refresh available models',
);
const UNKNOWN = detectCodexAuthError('ERROR: 見たことのない何か');

describe('buildLightV2FailureMessage (#431)', () => {
  test('★★★★ stream で分かった原因が、最後の両義な原因に勝つ', () => {
    const msg = buildLightV2FailureMessage({
      streamCause: MODEL_400,
      finalCause: MODELS_REFRESH,
      rawExcerpt: 'Codex Exec exited with code 1',
    });
    expect(msg).toMatch(/ChatGPT アカウント/);
    expect(msg).not.toMatch(/モデル一覧の取得に失敗/);
  });

  test('★★ stream で何も分からなければ、最後の原因を使う', () => {
    const msg = buildLightV2FailureMessage({
      streamCause: null,
      finalCause: MODELS_REFRESH,
      rawExcerpt: 'Codex Exec exited with code 1',
    });
    expect(msg).toMatch(/モデル一覧の取得に失敗/);
  });

  test('★★★★★ どちらも分からなければ、今までどおり生の抜粋を出す (情報を減らさない)', () => {
    const msg = buildLightV2FailureMessage({
      streamCause: null,
      finalCause: UNKNOWN,
      rawExcerpt: 'ERROR: 見たことのない何か',
    });
    expect(msg).toContain('ERROR: 見たことのない何か');
    expect(msg).toMatch(/Light v2 でエラーが発生しました/);
    // ★ 原因不明のときに「ログを確認してください」へ差し替えない
    expect(msg).not.toMatch(/ログ \(agent-server\) を確認/);
  });

  test('★ stream 側が不明 (kind=null) でも、finalCause が分かっていれば案内を出す', () => {
    const msg = buildLightV2FailureMessage({
      streamCause: UNKNOWN,
      finalCause: MODEL_400,
      rawExcerpt: 'x',
    });
    expect(msg).toMatch(/ChatGPT アカウント/);
  });
});
