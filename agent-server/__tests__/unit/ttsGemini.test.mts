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

/**
 * 2026-09-26 — ★ 長い文は分けて並行に合成し、1 つの WAV につなぐ。
 *
 * ★ なぜ: 本番切替の直後 (13:58)、読み上げボタンが 30 秒で時間切れになった。
 *   Gemini は長さに比例して遅い (14 秒の音声に 8 秒 / 48 秒の音声に 17 秒) ので、
 *   ボタン (全文、最大 3000 字) は 900 字あたりから 30 秒を超える。
 * ★★ 分けて並行にすれば、長い文でも 1 つ分の時間で返る。
 */
import { splitForTts, concatWav, MAX_CHUNK_CHARS, MAX_PARALLEL } from '../../src/lib/tts-gemini.mts';

/** 24kHz mono 16bit の WAV (44 バイトの頭 + PCM) を作る */
function makeWav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

describe('splitForTts — ★ 文の切れ目で分ける', () => {
  test('短い文は 1 つのまま', () => {
    expect(splitForTts('こんにちは。元気です。')).toEqual(['こんにちは。元気です。']);
  });

  test('★ 1 つは上限以下で、句点の後ろで切る', () => {
    const s = 'あ'.repeat(100) + '。';
    const parts = splitForTts(s.repeat(10), 250);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(250);
      expect(p.endsWith('。')).toBe(true);
    }
  });

  test('★★★ つなぎ直すと 1 文字も欠けない (改行・記号を含む)', () => {
    const s = '業務連絡です。\n鹿沼の現場へ！　本当ですか？' + 'い'.repeat(600) + '、終わり。' + 'う'.repeat(80);
    expect(splitForTts(s, 250).join('')).toBe(s);
  });

  test('★ 句点の無い長い文は、読点か字数で切る (上限を超えない)', () => {
    const s = ('か'.repeat(90) + '、').repeat(5) + 'き'.repeat(400);
    const parts = splitForTts(s, 250);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(250);
    expect(parts.join('')).toBe(s);
  });

  test('空白だけのかけらは作らない', () => {
    const parts = splitForTts('あ'.repeat(240) + '。\n\n\n' + 'い'.repeat(240) + '。', 250);
    for (const p of parts) expect(p.trim().length).toBeGreaterThan(0);
  });
});

describe('concatWav — ★ WAV をつなぐ', () => {
  test('★ PCM を順につなぎ、頭の長さを書き直す', () => {
    const a = Buffer.from([1, 2, 3, 4]); const b = Buffer.from([5, 6]);
    const out = concatWav([makeWav(a), makeWav(b)]);
    expect(out.subarray(0, 4).toString()).toBe('RIFF');
    expect(out.readUInt32LE(4)).toBe(36 + 6);
    expect(out.readUInt32LE(24)).toBe(24000);        // ★ 1 本目の形式を引き継ぐ
    expect(out.subarray(36, 40).toString()).toBe('data');
    expect(out.readUInt32LE(40)).toBe(6);
    expect([...out.subarray(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('★★ data の前に別のチャンク (LIST 等) があっても PCM だけを取る', () => {
    const pcm = Buffer.from([9, 9]);
    const w = makeWav(pcm);
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('abcd')]);
    const withList = Buffer.concat([w.subarray(0, 36), list, w.subarray(36)]);
    expect([...concatWav([withList, makeWav(Buffer.from([7]))]).subarray(44)]).toEqual([9, 9, 7]);
  });

  test('★ WAV でないものは throw (★ 壊れた音声を返さない)', () => {
    expect(() => concatWav([Buffer.from('not a wav at all, definitely')])).toThrow();
  });
});

describe('synthesizeGemini — ★ 長い文は分けて並行', () => {
  /** 本文ごとに違う PCM を返す fetch。★ わざと後の方を早く返し、順番が保たれるかを見る */
  function perTextFetch(delayFor: (i: number) => number = (i) => 50 - i * 5) {
    let inFlight = 0; let maxInFlight = 0; let n = 0;
    const fn = jest.fn(async (_url: string, init: { body: string }) => {
      const i = n++;
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      const text: string = JSON.parse(init.body).input[0].content[0].text;
      await new Promise((r) => setTimeout(r, Math.max(0, delayFor(i))));
      inFlight--;
      const pcm = Buffer.from(text.slice(0, 1));   // ★ かけらの先頭 1 文字を PCM に見立てる
      return { ok: true, status: 200, json: async () => ({ steps: [{ content: [{ data: makeWav(pcm).toString('base64') }] }] }), text: async () => '' };
    });
    return { fn, max: () => maxInFlight };
  }

  test('★ 上限以下なら 1 回だけ呼ぶ (★ 今までどおり)', async () => {
    const f = perTextFetch();
    await synthesizeGemini('短い文です。', { apiKey: 'k', fetchImpl: f.fn as never });
    expect(f.fn).toHaveBeenCalledTimes(1);
  });

  test('★★ 長い文は分けて呼び、元の順番でつなぐ (★ 返ってくる順が逆でも)', async () => {
    const s = ['A', 'B', 'C', 'D', 'E', 'F'].map((c) => c.repeat(MAX_CHUNK_CHARS - 1) + '。').join('');
    const f = perTextFetch();
    const got = await synthesizeGemini(s, { apiKey: 'k', fetchImpl: f.fn as never });
    expect(f.fn).toHaveBeenCalledTimes(6);
    expect(got.buffer.subarray(44).toString()).toBe('ABCDEF');
    expect(got.contentType).toBe('audio/wav');
  });

  test(`★ 同時に投げるのは ${MAX_PARALLEL} 本まで`, async () => {
    const s = 'あ'.repeat(MAX_CHUNK_CHARS - 1) + '。';
    const f = perTextFetch(() => 20);
    await synthesizeGemini(s.repeat(10), { apiKey: 'k', fetchImpl: f.fn as never });
    expect(f.max()).toBeLessThanOrEqual(MAX_PARALLEL);
    expect(f.max()).toBeGreaterThan(1);   // ★ 本当に並行している
  });

  test('★★ 1 つでも失敗したら throw (★ 欠けた音声を返さない = 呼び出し側が browser に fallback)', async () => {
    const s = 'あ'.repeat(MAX_CHUNK_CHARS - 1) + '。';
    let n = 0;
    const fn = jest.fn(async () => (n++ === 2
      ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }
      : { ok: true, status: 200, json: async () => ({ steps: [{ content: [{ data: makeWav(Buffer.from([1])).toString('base64') }] }] }), text: async () => '' }));
    await expect(synthesizeGemini(s.repeat(5), { apiKey: 'k', fetchImpl: fn as never })).rejects.toThrow('500');
  });
});
