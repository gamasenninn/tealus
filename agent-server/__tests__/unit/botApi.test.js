/**
 * botApi.request() の HTTP ステータス処理テスト (#303)
 *
 * 旧実装は res.ok を見ず res.json() を返していたため、/bot/push 失敗を握り潰し
 * 偽の「response sent」ログを生んでいた。本テストは:
 *  (a) 2xx は resolve
 *  (b) 非2xx は status/body を持つ Error を throw + logger.error
 *  (c) 401 は token 破棄 + 再ログインして 1 回だけ retry
 *  (d) 401 retry 後も失敗なら throw
 * を担保する。TTS 副作用の無い pushStatus 経由で request() を検証する。
 */

jest.mock('node-fetch', () => jest.fn());
jest.mock('../../src/config', () => ({
  TEALUS_API_URL: 'http://test',
  TEALUS_BOT_ID: 'BOT',
  TEALUS_BOT_PASS: 'pw',
}));
jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

function makeRes({ ok, status, statusText = '', json = {}, text = '' }) {
  return {
    ok,
    status,
    statusText,
    json: async () => json,
    text: async () => text,
  };
}

const loginOk = () => makeRes({ ok: true, status: 200, json: { token: 'tok', user: { id: 'bot' } } });

describe('botApi.request status handling (#303)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('(a) 2xx はそのまま resolve (fetch=login+api の2回)', async () => {
    const fetch = require('node-fetch');
    fetch.mockImplementation((url) =>
      Promise.resolve(url.includes('/auth/login') ? loginOk() : makeRes({ ok: true, status: 200, json: { ok: true } })));
    const botApi = require('../../src/lib/botApi');

    await expect(botApi.pushStatus('room1', 'idle')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('(b) 非2xx は status/body を持つ Error を throw し logger.error する', async () => {
    const fetch = require('node-fetch');
    const logger = require('../../src/lib/logger');
    fetch.mockImplementation((url) =>
      Promise.resolve(url.includes('/auth/login')
        ? loginOk()
        : makeRes({ ok: false, status: 500, statusText: 'Internal Server Error', text: 'boom' })));
    const botApi = require('../../src/lib/botApi');

    const err = await botApi.pushStatus('room1', 'idle').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/500/);
    expect(err.status).toBe(500);
    expect(err.body).toBe('boom');

    expect(logger.error).toHaveBeenCalled();
    const logged = logger.error.mock.calls.flat().join(' ');
    expect(logged).toContain('/bot/status');
    expect(logged).toContain('500');
  });

  it('(c) 401 は token 破棄して再ログイン+1回 retry し、成功すれば resolve', async () => {
    const fetch = require('node-fetch');
    const logger = require('../../src/lib/logger');
    let apiCall = 0;
    fetch.mockImplementation((url) => {
      if (url.includes('/auth/login')) return Promise.resolve(loginOk());
      apiCall++;
      return Promise.resolve(apiCall === 1
        ? makeRes({ ok: false, status: 401, statusText: 'Unauthorized', text: 'token expired' })
        : makeRes({ ok: true, status: 200, json: { ok: true } }));
    });
    const botApi = require('../../src/lib/botApi');

    await expect(botApi.pushStatus('room1', 'idle')).resolves.toEqual({ ok: true });
    // login, api(401), login(再認証), api(200) = 4
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalled();
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toMatch(/401/);
  });

  it('(d) 401 retry 後も失敗なら throw (fetch=4回)', async () => {
    const fetch = require('node-fetch');
    fetch.mockImplementation((url) =>
      Promise.resolve(url.includes('/auth/login')
        ? loginOk()
        : makeRes({ ok: false, status: 401, statusText: 'Unauthorized', text: 'still expired' })));
    const botApi = require('../../src/lib/botApi');

    const err = await botApi.pushStatus('room1', 'idle').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
