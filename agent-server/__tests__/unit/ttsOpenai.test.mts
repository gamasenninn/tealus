/**
 * #444 段 1 — OpenAI TTS (`/v1/audio/speech`) の合成 (★ ここだけを見るテスト)。
 *
 * ★ なぜ tts-core.mts に足さないか:
 *   ★★ `tts-core.mts` は **rtc-server から横断 import されている唯一の共有面**
 *   (`rtc-server/tts-speak.mts:26`)。★★★ docs/05:423 が「新たな横断依存は増やさない」と決めている。
 *   → ★ 別ファイルにして 共有面を広げない。
 *
 * ★★ fetch は注入できる形にする (★ lineBridge.mts と同じ作法)。
 *   ★★★ 実際のネットワークは 1 度も叩かない。
 */

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

import { synthesizeOpenai } from '../../src/lib/tts-openai.mts';

/** 200 を返す fetch の偽物 */
function okFetch(body: Buffer, contentType = 'audio/wav') {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  });
}

describe('synthesizeOpenai — ★ 合成そのもの', () => {
  test('成功したら buffer と contentType を返す', async () => {
    const fetchImpl = okFetch(Buffer.from('fake-wav-bytes'));
    const got = await synthesizeOpenai('こんにちは', { apiKey: 'k', fetchImpl: fetchImpl as never });

    expect(Buffer.isBuffer(got.buffer)).toBe(true);
    expect(got.buffer.toString()).toBe('fake-wav-bytes');
    expect(got.contentType).toBe('audio/wav');
  });

  test('★ 既定は gpt-4o-mini-tts / marin / wav —— ★★ marin は会話モードと同じ voice', async () => {
    const fetchImpl = okFetch(Buffer.from('x'));
    await synthesizeOpenai('テスト', { apiKey: 'k', fetchImpl: fetchImpl as never });

    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.model).toBe('gpt-4o-mini-tts');
    expect(body.voice).toBe('marin');
    expect(body.response_format).toBe('wav');
    expect(body.input).toBe('テスト');
  });

  test('★ model / voice / format は差し替えられる', async () => {
    const fetchImpl = okFetch(Buffer.from('x'));
    await synthesizeOpenai('テスト', {
      apiKey: 'k', model: 'tts-1', voice: 'alloy', format: 'mp3', fetchImpl: fetchImpl as never,
    });
    const body = JSON.parse(((fetchImpl as jest.Mock).mock.calls[0][1] as { body: string }).body);
    expect(body.model).toBe('tts-1');
    expect(body.voice).toBe('alloy');
    expect(body.response_format).toBe('mp3');
  });

  test('★★ apiKey が無ければ fetch を叩かずに throw する', async () => {
    const fetchImpl = okFetch(Buffer.from('x'));
    await expect(synthesizeOpenai('テスト', { apiKey: '', fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('★★ 200 以外は status を含めて throw する (★ 本文は 200 字まで)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false, status: 400,
      text: async () => 'x'.repeat(500),
      headers: { get: () => null },
    });
    await expect(synthesizeOpenai('テスト', { apiKey: 'k', fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/400/);
  });

  test('★ contentType が来なければ format から決める (★★ 下流が Content-Type を必要とする)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    const got = await synthesizeOpenai('テスト', { apiKey: 'k', format: 'mp3', fetchImpl: fetchImpl as never });
    expect(got.contentType).toBe('audio/mpeg');
  });
});
