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

/**
 * 2026-09-26 — ★ OpenAI も長い文は分けて並行に合成し、1 つの WAV につなぐ (Gemini と同じ部品 = tts-chunk.mts)。
 *
 * ★ なぜ: OpenAI は 1 回の入力が 2000 トークンまで (本番ログ 2026-09-26「Input of 2003 tokens is over
 *   the maximum input limit」)。長さに比例して遅い (自然な文で 1200 字 29 秒)。
 * ★★ OpenAI の WAV は data の長さ欄が 0xFFFFFFFF (流しながら作るため) のことがある → つなぐときに読めること。
 */
import { MAX_CHUNK_CHARS as OA_MAX_CHUNK } from '../../src/lib/tts-openai.mts';

function makeWavOa(pcm: Buffer, streamingHeader = false): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(streamingHeader ? 0xFFFFFFFF : 36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(streamingHeader ? 0xFFFFFFFF : pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function perInputFetch(streamingHeader = true) {
  return jest.fn(async (_url: string, init: { body: string }) => {
    const input: string = JSON.parse(init.body).input;
    const wav = makeWavOa(Buffer.from(input.slice(0, 1)), streamingHeader);
    return {
      ok: true, status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'audio/wav' : null) },
      arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
      text: async () => '',
    };
  });
}

describe('synthesizeOpenai — ★ 長い文は分けて並行', () => {
  test('★ 上限以下なら 1 回だけ (★ 今までどおり、返ってきたものをそのまま返す)', async () => {
    const f = perInputFetch(false);
    const got = await synthesizeOpenai('短い文です。', { apiKey: 'k', fetchImpl: f as never });
    expect(f).toHaveBeenCalledTimes(1);
    expect(got.buffer.subarray(44).toString()).toBe('短');
  });

  test('★★ 長い文は分けて呼び、元の順でつなぐ (★ data の長さ欄が 0xFFFFFFFF でも)', async () => {
    const s = ['A', 'B', 'C'].map((c) => c.repeat(OA_MAX_CHUNK - 1) + '。').join('');
    const f = perInputFetch(true);
    const got = await synthesizeOpenai(s, { apiKey: 'k', fetchImpl: f as never });
    expect(f).toHaveBeenCalledTimes(3);
    expect(got.buffer.readUInt32LE(40)).toBe(3);                 // ★ つないだ後は本当の長さ
    expect(got.buffer.subarray(44).toString()).toBe('ABC');
    expect(got.contentType).toBe('audio/wav');
  });

  test('★ wav 以外 (mp3 など) は分けない (★ つなげないので 1 回で投げる)', async () => {
    const s = 'あ'.repeat(OA_MAX_CHUNK * 3);
    const f = okFetch(Buffer.from('mp3-bytes'), 'audio/mpeg');
    await synthesizeOpenai(s, { apiKey: 'k', format: 'mp3', fetchImpl: f as never });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
