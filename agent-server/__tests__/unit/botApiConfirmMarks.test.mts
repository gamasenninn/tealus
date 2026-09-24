/**
 * pushMessage が 〔要確認〕の割り当てを **実際に通している**ことを固定する (2026-09-24、#452)。
 *
 * ★ なぜ別ファイルか: `confirmMarks.test.mts` は純関数の規則を見る。★★ ここが見るのは
 *   **配線**だけ —— 関数が正しくても呼ばれていなければ部屋には何も起きない。
 *   ★★★ 2026-09-21 に「置いた≠動く」を 1 日 3 件出しているので、置いた側にも口を付ける。
 *
 * ★★★★ 部屋へ出す本文と TTS が読む本文が **同じもの**であることも一緒に見る
 *   (片方だけ割ると、聞こえる議事録と読む議事録がずれる)。
 */
jest.mock('node-fetch', () => jest.fn());
jest.mock('../../src/config.mts', () => ({
  TEALUS_API_URL: 'http://test',
  TEALUS_BOT_ID: 'BOT',
  TEALUS_BOT_PASS: 'pw',
}));
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));
jest.mock('../../src/lib/ttsSpeak.mts', () => ({ speakMessage: jest.fn() }));
jest.mock('../../src/lib/confirmMarks.mts', () => ({
  applyConfirmMarkSplit: jest.fn((s: string) => s.replace('要確認', '要確認・登録済')),
}));

const loginOk = () => ({
  ok: true, status: 200, statusText: '',
  json: async () => ({ token: 'tok', user: { id: 'bot' } }),
  text: async () => '',
});
const pushOk = () => ({
  ok: true, status: 201, statusText: '',
  json: async () => ({ ok: true }),
  text: async () => '',
});

describe('pushMessage は印の割り当てを通してから投稿する (#452)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('★ POST /bot/push の本文が 割った後のもの になっている', async () => {
    const fetch = require('node-fetch');
    fetch.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/auth/login') ? loginOk() : pushOk()));
    const botApi = require('../../src/lib/botApi');

    await botApi.pushMessage('room1', 'アグリカ[要確認] の件');

    const pushCall = fetch.mock.calls.find((c: [string, ...unknown[]]) => c[0].includes('/bot/push'));
    expect(pushCall).toBeDefined();
    const sent = JSON.parse((pushCall[1] as { body: string }).body);
    expect(sent.content).toBe('アグリカ[要確認・登録済] の件');
  });

  it('★★★★ TTS が読むのも 部屋へ出したのと同じ本文', async () => {
    const fetch = require('node-fetch');
    fetch.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/auth/login') ? loginOk() : pushOk()));
    const botApi = require('../../src/lib/botApi');
    const { speakMessage } = require('../../src/lib/ttsSpeak.mts');

    await botApi.pushMessage('room1', 'アグリカ[要確認] の件');

    expect(speakMessage).toHaveBeenCalledWith('room1', 'アグリカ[要確認・登録済] の件');
  });
});
