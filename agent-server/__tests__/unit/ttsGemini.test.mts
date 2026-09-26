/**
 * Gemini TTS (`gemini-3.8-flash-lite-tts`、Interactions API) の合成 (2026-09-26)。★ ここだけを見るテスト。
 *
 * ★ なぜ Gemini か (利用者の聞き比べ、2026-09-26):
 *   「Kore + 話し方の指定」がいちばん良い。★★ Flash は 7俵 を「ななたま」と読み、
 *   Lite は料金が 2/3 (出力 $6 / 100 万トークン、2027-01-01 から倍) → ★ 既定は Lite。
 * ★★ 呼び出しの形は 2026-09-26 に実際に叩いて確かめた:
 *   POST /v1beta/interactions、x-goog-api-key、音声は steps[].content[].data (base64 の WAV、24kHz)
 *
 * ★ tts-openai.mts と同じ理由で tts-core.mts には足さない (rtc-server との共有面を広げない)。
 * ★★ fetch は注入する。実際のネットワークは 1 度も叩かない。
 */

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

import { synthesizeGemini, GEMINI_INTERACTIONS_URL } from '../../src/lib/tts-gemini.mts';

const WAV = Buffer.from('RIFF....WAVEfake');

/** 200 と、音声を steps[0].content[0].data に入れた応答を返す fetch の偽物 */
function okFetch(audio: Buffer = WAV) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ steps: [{ content: [{ type: 'audio', mime_type: 'audio/wav', data: audio.toString('base64') }] }] }),
    text: async () => '',
  });
}

function sentBody(fetchImpl: jest.Mock): Record<string, any> {
  return JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body);
}

describe('synthesizeGemini — ★ 合成そのもの', () => {
  test('成功したら WAV の buffer と audio/wav を返す', async () => {
    const got = await synthesizeGemini('こんにちは', { apiKey: 'k', fetchImpl: okFetch() as never });
    expect(got.buffer.equals(WAV)).toBe(true);
    expect(got.contentType).toBe('audio/wav');
  });

  test('★ 宛先は Interactions API、鍵は x-goog-api-key (★★ URL に鍵を載せない)', async () => {
    const fetchImpl = okFetch();
    await synthesizeGemini('テスト', { apiKey: 'secret-k', fetchImpl: fetchImpl as never });
    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(GEMINI_INTERACTIONS_URL);
    expect(url).not.toContain('secret-k');
    expect(init.headers['x-goog-api-key']).toBe('secret-k');
  });

  test('★ 既定は flash-lite / Kore / 話し方の指定あり / WAV 24kHz', async () => {
    const fetchImpl = okFetch();
    await synthesizeGemini('テスト', { apiKey: 'k', fetchImpl: fetchImpl as never });
    const body = sentBody(fetchImpl);
    expect(body.model).toBe('gemini-3.8-flash-lite-tts');
    expect(body.generation_config.speech_config).toEqual([{ voice: 'Kore' }]);
    expect(body.response_format).toEqual({ type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 });
    const content = body.input[0].content[0];
    expect(content.text).toBe('テスト');
    expect(content.annotations[0].type).toBe('speech_metadata');
    expect(content.annotations[0].style).toContain('業務連絡');
  });

  test('model / voice / style は差し替えられる', async () => {
    const fetchImpl = okFetch();
    await synthesizeGemini('テスト', { apiKey: 'k', model: 'gemini-3.8-flash-tts', voice: 'Aoede', style: 'ゆっくり', fetchImpl: fetchImpl as never });
    const body = sentBody(fetchImpl);
    expect(body.model).toBe('gemini-3.8-flash-tts');
    expect(body.generation_config.speech_config).toEqual([{ voice: 'Aoede' }]);
    expect(body.input[0].content[0].annotations[0].style).toBe('ゆっくり');
  });

  test('★ style を空にすると話し方の指定を付けない (★★ 空の annotations を送らない)', async () => {
    const fetchImpl = okFetch();
    await synthesizeGemini('テスト', { apiKey: 'k', style: '', fetchImpl: fetchImpl as never });
    expect(sentBody(fetchImpl).input[0].content[0].annotations).toBeUndefined();
  });
});

describe('synthesizeGemini — ★ 失敗は必ず throw (呼び出し側が browser に fallback する)', () => {
  test('鍵が無い', async () => {
    await expect(synthesizeGemini('x', { apiKey: '', fetchImpl: okFetch() as never })).rejects.toThrow('GOOGLE_API_KEY');
  });

  test('本文が空', async () => {
    await expect(synthesizeGemini('', { apiKey: 'k', fetchImpl: okFetch() as never })).rejects.toThrow();
  });

  test('HTTP エラーは状態コードと本文の頭を載せる', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}), text: async () => 'models/x is not found' });
    await expect(synthesizeGemini('x', { apiKey: 'k', fetchImpl: fetchImpl as never })).rejects.toThrow(/404.*not found/);
  });

  test('★★ 200 でも音声が入っていなければ throw (★ 空の buffer を返して「鳴らない」にしない)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ steps: [{ content: [{ type: 'text', text: 'sorry' }] }] }), text: async () => '' });
    await expect(synthesizeGemini('x', { apiKey: 'k', fetchImpl: fetchImpl as never })).rejects.toThrow('音声');
  });
});
