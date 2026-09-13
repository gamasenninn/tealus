/**
 * codexAuthError helper test (pre-α、#292 default 'v2' flip 前提)
 *
 * detectCodexAuthError() の純関数 test、SDK 実依存なし。
 * 12 件 = 6/5 fixture / 6/8 fixture 否定 / 4 pattern 個別 / 境界 / 多言語混入。
 */

import {
  detectCodexAuthError,
  buildAuthFailUserMessage,
  buildCodexErrorUserMessage,
  buildKnownCauseUserMessage,
  AUTH_FAIL_PATTERNS,
} from '../../src/lib/codexAuthError.mts';

describe('detectCodexAuthError (pre-α、#292 follow-up)', () => {
  test('6/5 サポート班 fixture → isAuth=true (= pattern array 順序で session_ended が先 hit)', () => {
    const r = detectCodexAuthError('Failed to refresh token: Your session has ended');
    expect(r.isAuth).toBe(true);
    // ★ AUTH_FAIL_PATTERNS[0]=session_ended が先に hit、[1]=refresh_failed は実行されない
    expect(r.kind).toBe('session_ended');
  });

  test('"Your session has ended." 単独 → isAuth=true, kind=session_ended', () => {
    const r = detectCodexAuthError('Your session has ended.');
    expect(r.isAuth).toBe(true);
    expect(r.kind).toBe('session_ended');
  });

  test('"401 Unauthorized" → isAuth=true, kind=unauthorized', () => {
    const r = detectCodexAuthError('HTTP 401 Unauthorized');
    expect(r.isAuth).toBe(true);
    expect(r.kind).toBe('unauthorized');
  });

  test('"token_expired" → isAuth=true, kind=token_expired', () => {
    const r = detectCodexAuthError('error: token_expired');
    expect(r.isAuth).toBe(true);
    expect(r.kind).toBe('token_expired');
  });

  test('6/8 fixture "Failed to parse item: ..." → isAuth=false (= 別 root cause、auth と混同しない)', () => {
    const r = detectCodexAuthError('Failed to parse item: ☐☐☐: PID 130468 のプロセスが終了しました');
    expect(r.isAuth).toBe(false);
    expect(r.kind).toBe(null);
  });

  test('"Reconnecting... 5/5" 単独 → isAuth=false (= 接続 retry 自体は auth 失敗の確定証拠でない)', () => {
    const r = detectCodexAuthError('Reconnecting... 5/5');
    expect(r.isAuth).toBe(false);
  });

  test('"ECONNRESET" → isAuth=false (= network 一時揺れ、retry 対象)', () => {
    const r = detectCodexAuthError('ECONNRESET');
    expect(r.isAuth).toBe(false);
  });

  test('空文字 → isAuth=false, kind=null', () => {
    const r = detectCodexAuthError('');
    expect(r.isAuth).toBe(false);
    expect(r.kind).toBe(null);
  });

  test('undefined → isAuth=false (= 引数 guard)', () => {
    const r = detectCodexAuthError(undefined);
    expect(r.isAuth).toBe(false);
    expect(r.kind).toBe(null);
  });

  test('MCP tool 文脈の "user cancelled" 混入 → isAuth=false (= MCP error と区別)', () => {
    const r = detectCodexAuthError('MCP tool failed: user cancelled the operation');
    expect(r.isAuth).toBe(false);
  });

  test('大文字小文字混合 "your SESSION has ended" → isAuth=true (= case insensitive)', () => {
    const r = detectCodexAuthError('your SESSION has ended');
    expect(r.isAuth).toBe(true);
    expect(r.kind).toBe('session_ended');
  });

  test('複数 pattern 同時 hit → kind は AUTH_FAIL_PATTERNS の最初 hit (= deterministic)', () => {
    // "Your session has ended" (session_ended pattern) + "Failed to refresh token" (refresh_failed pattern)
    // 順序: session_ended pattern が AUTH_FAIL_PATTERNS[0]、refresh_failed が [1]
    const r = detectCodexAuthError('Failed to refresh token. Your session has ended.');
    expect(r.isAuth).toBe(true);
    expect(r.kind).toBe('session_ended'); // [0] が hit 優先
  });
});

describe('buildAuthFailUserMessage', () => {
  test('日本語 1 行 + codex login + 再起動 案内', () => {
    const msg = buildAuthFailUserMessage();
    expect(msg).toContain('ChatGPT');
    expect(msg).toContain('codex login');
    expect(msg).toContain('再起動');
    // 長すぎない (= 1 行 100 字以内 guideline)
    expect(msg.length).toBeLessThan(100);
  });
});

describe('AUTH_FAIL_PATTERNS export', () => {
  test('4 pattern 公開、kind + re field 持つ', () => {
    expect(AUTH_FAIL_PATTERNS).toHaveLength(4);
    AUTH_FAIL_PATTERNS.forEach((p) => {
      expect(p).toHaveProperty('kind');
      expect(p).toHaveProperty('re');
      expect(p.re).toBeInstanceOf(RegExp);
    });
  });
});

/**
 * #423 → #422 ★ 実物のエラー文で、誤判定を固定する。
 *
 * ★★ 2026-09-06 に起きたこと: codex が古くてモデル一覧を解釈できず落ちたのに、
 *   **「ChatGPT のサインインが切れました。`codex login` を実行してください」**と案内した。
 *   利用者はブラウザで入り直したが直らず、**同じ操作を繰り返した**。
 *
 * ★★★ 誤判定の理由は、**76KB のモデル一覧 JSON の中に含まれる `unauthorized` の 1 語**に
 *   `/\b401\b|\bunauthorized\b/i` が反応したこと。
 *   → **間違った案内は、案内が無いより悪い** (利用者を無駄な作業へ送り込むため)。
 */
describe('detectCodexAuthError — 認証以外を認証と言わない (#422)', () => {
  /** 2026-09-06 19:12 の実物 (本文は途中まで。実際は 76KB) */
  const MODELS_DECODE_ERROR =
    '2026-09-06T10:12:18.638249Z ERROR codex_models_manager::manager: failed to refresh available models: '
    + 'stream disconnected before completion: failed to decode models response: unknown variant `max`, '
    + 'expected one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh` at line 1 column 76436; '
    + 'body: {"models":[{"slug":"gpt-5.5","prefer_websockets":true,"unauthorized":false,'
    + '"support_verbosity":true,"default_verbosity":"low"}]}';

  test('★★★ モデル一覧のデコード失敗を「認証切れ」と言わない', () => {
    const r = detectCodexAuthError(MODELS_DECODE_ERROR);
    expect(r.isAuth).toBe(false);
  });

  /**
   * ★ #431 (2026-09-12) で名前を変えた。
   * 旧: `cli_outdated` —— **観測 (models の取得に失敗した) ではなく、推測した原因 (CLI が古い)** を
   * 名前にしていた。実際は **モデルが使えないときにも同じ行が出る** (下の #431 の block)。
   * → ★★ 名前は観測の方に寄せる。**推測を名前にすると、その推測が案内文に出る。**
   */
  test('★★ その代わり「モデル一覧の取得に失敗」と分類する (原因は名乗らない)', () => {
    const r = detectCodexAuthError(MODELS_DECODE_ERROR);
    expect(r.kind).toBe('models_refresh_failed');
  });

  test('★★ 案内はログインを指さない', () => {
    const msg = buildCodexErrorUserMessage(detectCodexAuthError(MODELS_DECODE_ERROR));
    expect(msg).not.toMatch(/サインイン|ログイン/);
  });

  test('★★★ 本文の後ろの方に紛れた unauthorized では 認証切れにしない', () => {
    // ★ JSON の body に出てくる語で判定してはいけない
    const r = detectCodexAuthError('ERROR something else; body: {"x":"unauthorized"}');
    expect(r.isAuth).toBe(false);
  });

  test('★ 本物の 401 はこれまでどおり拾う (短いメッセージ)', () => {
    expect(detectCodexAuthError('HTTP 401 Unauthorized').isAuth).toBe(true);
    expect(detectCodexAuthError('Your session has ended').isAuth).toBe(true);
  });

  test('★★ 分からないものは 推測しない (認証とも codex 古いとも言わない)', () => {
    const r = detectCodexAuthError('ERROR: something we have never seen before');
    expect(r.isAuth).toBe(false);
    expect(r.kind).toBe(null);
  });

  test('★★ 分からないときの案内は「ログを見てほしい」と言う (嘘の原因を出さない)', () => {
    const msg = buildCodexErrorUserMessage(detectCodexAuthError('ERROR: 見たことのない何か'));
    expect(msg).toMatch(/ログ/);
    expect(msg).not.toMatch(/サインイン/);
  });
});

/**
 * ★★★★★ #431 — `codex_models_manager` は「CLI が古い」の印ではない (2026-09-12 実測)
 *
 * ## 何が起きたか
 *
 * 採用者#2 環境 (2026-09-11 20:12:31) で Light v2 が落ちたときのログ:
 *
 * ```
 * [LightV2] stream error: 400
 *   {"type":"invalid_request_error",
 *    "message":"The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account."}
 * [LightV2] auth failed (unauthorized): Codex Exec exited with code 1
 *   ERROR codex_models_manager::manager: failed to refresh available models: ... unknown variant `max` ...
 * ```
 *
 * ★ **この環境の codex は古くなかった。** 原因は**モデル**だったのに、`codex_models_manager` の行は出る。
 * → ★★ **同じ 1 行が 2 つの原因で出る。** #422 はそれを「CLI が古い」と決め打ちしていた。
 * → ★★★ `f8ac2f1` のコミットメッセージに書いたとおり、**サポート班はこの誤診で更新作業を 2 回させている。**
 *   その誤診を**コードが自動でやる**形になっていた。
 *
 * ## 直し方の方針
 *
 * ```
 * ★ 400 本文は 曖昧でない (「ChatGPT アカウントでは使えない」と名指し) → 断定してよい
 * ★★ codex_models_manager は 両義 → ★★★ 案内も両義にする。順番は「モデル設定が先」
 *    (モデル設定の確認は 1 分、codex の更新は数分 + 再起動。安い方から試させる)
 * ```
 */
describe('detectCodexAuthError — 印が両義のときは断定しない (#431)', () => {
  /** 2026-09-11 20:12:31 の実物 (Light v2 の event.message) */
  const MODEL_NOT_SUPPORTED_400 =
    '400 {"type":"invalid_request_error","message":"The \'gpt-5.4-mini\' model is not supported '
    + 'when using Codex with a ChatGPT account."}';

  /** 同じ落ち方の、少しあとに出る stderr (外側 catch に来る方) */
  const MODELS_REFRESH_STDERR =
    'Codex Exec exited with code 1\n'
    + '  ERROR codex_models_manager::manager: failed to refresh available models: unknown variant `max`';

  test('★★★ 400 本文は「認証切れ」ではない', () => {
    expect(detectCodexAuthError(MODEL_NOT_SUPPORTED_400).isAuth).toBe(false);
  });

  test('★★★★ 400 本文は model_not_supported として拾う (今は kind=null で何も言えていない)', () => {
    expect(detectCodexAuthError(MODEL_NOT_SUPPORTED_400).kind).toBe('model_not_supported');
  });

  test('★★★ その案内はモデルの設定を指す (codex の更新でもログインでもない)', () => {
    const msg = buildCodexErrorUserMessage(detectCodexAuthError(MODEL_NOT_SUPPORTED_400));
    expect(msg).toMatch(/モデル/);
    expect(msg).not.toMatch(/サインイン|ログイン/);
    expect(msg).not.toMatch(/npm i -g/);
  });

  test('★★★★★ 両方が 1 つの文字列に混ざったら、断定できる方 (400 本文) が勝つ', () => {
    const mixed = `${MODEL_NOT_SUPPORTED_400}\n${MODELS_REFRESH_STDERR}`;
    expect(detectCodexAuthError(mixed).kind).toBe('model_not_supported');
  });

  test('★★★★ models の取得失敗の案内は 両義にする —— モデル設定にも触れる', () => {
    const msg = buildCodexErrorUserMessage(detectCodexAuthError(MODELS_REFRESH_STDERR));
    expect(msg).toMatch(/モデル/);      // ★ 藤井さんの原因はこちらだった
    expect(msg).toMatch(/codex/i);      // ★ CLI が古い可能性も残す (両義なので両方出す)
  });

  test('★★ 両義の案内は「モデル」を先に出す (安い方から試させる)', () => {
    const msg = buildCodexErrorUserMessage(detectCodexAuthError(MODELS_REFRESH_STDERR));
    expect(msg.indexOf('モデル')).toBeLessThan(msg.search(/codex/i));
  });
});

/**
 * ★★★ #431 — 分からないときに「分かったふり」をさせないための入口
 *
 * `buildCodexErrorUserMessage` は **原因不明でも 1 行を返す**
 * (「AI の起動に失敗しました。ログを確認してください」)。
 * ★ Light v2 の現行はこれを使わず、**生のエラー抜粋 500 字**を部屋に出している。
 * ★★ 生の抜粋の方が情報量が多い場面がある —— 実際、2026-09-11 の 400 本文は
 *   **そのまま読めば原因が分かる文**だった。
 * → ★★★ **原因が分かったときだけ案内文に差し替える**ための関数を分ける。
 *   (呼び出し側が「分かったかどうか」を自分で判定しなくてよくする)
 */
describe('buildKnownCauseUserMessage — 分かったときだけ 1 行を返す (#431)', () => {
  test('★★ 認証切れなら auth の案内', () => {
    const msg = buildKnownCauseUserMessage(detectCodexAuthError('Your session has ended'));
    expect(msg).toBe(buildAuthFailUserMessage());
  });

  test('★★ 分かっている非認証の形なら、その案内', () => {
    const msg = buildKnownCauseUserMessage(
      detectCodexAuthError('400 The \'gpt-5.4-mini\' model is not supported when using Codex with a ChatGPT account.'),
    );
    expect(msg).toMatch(/モデル/);
  });

  test('★★★★ 分からないときは null (= 呼び出し側が生の抜粋を出せる)', () => {
    expect(buildKnownCauseUserMessage(detectCodexAuthError('ERROR: 見たことのない何か'))).toBe(null);
  });
});
