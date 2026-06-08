/**
 * codexAuthError helper test (pre-α、#292 default 'v2' flip 前提)
 *
 * detectCodexAuthError() の純関数 test、SDK 実依存なし。
 * 12 件 = 6/5 fixture / 6/8 fixture 否定 / 4 pattern 個別 / 境界 / 多言語混入。
 */

const { detectCodexAuthError, buildAuthFailUserMessage, AUTH_FAIL_PATTERNS } = require('../../src/lib/codexAuthError');

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
