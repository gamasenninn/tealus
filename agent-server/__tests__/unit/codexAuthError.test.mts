/**
 * codexAuthError helper test (pre-α、#292 default 'v2' flip 前提)
 *
 * detectCodexAuthError() の純関数 test、SDK 実依存なし。
 * 12 件 = 6/5 fixture / 6/8 fixture 否定 / 4 pattern 個別 / 境界 / 多言語混入。
 */

import { detectCodexAuthError, buildAuthFailUserMessage, buildCodexErrorUserMessage, AUTH_FAIL_PATTERNS } from '../../src/lib/codexAuthError.mts';

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

  test('★★ その代わり「codex が古い」と分類する', () => {
    const r = detectCodexAuthError(MODELS_DECODE_ERROR);
    expect(r.kind).toBe('cli_outdated');
  });

  test('★★ 案内は codex の更新を指す (ログインではない)', () => {
    const msg = buildCodexErrorUserMessage(detectCodexAuthError(MODELS_DECODE_ERROR));
    expect(msg).toMatch(/codex/i);
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
