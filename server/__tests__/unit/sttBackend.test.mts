/**
 * sttBackend ユニットテスト (#自ホストSTT)
 * 「音声ファイル -> raw text」を STT_BACKEND で切替する strategy のロジック。
 * openai client と fetch を注入して、本番 API / 常駐ワーカーを実際には叩かない。
 * DB 非依存 (feedback_test_db_guard: request(app) は使わない)。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ★ 既定 logger を黙らせる (#424 で気づいた)。log を注入しないテストは `defaultLogger` を掴み、
//   **本番のログファイルに書き込んでいた** —— 2026-09-07 の本番ログに、fixture の値そのままの
//   `[stt] gemini ok 0ms vocab=3` と `「حسن」`「每句一个」が残っていた。
//   `[stt] gemini` の件数を後から数えて効果を見る (#424 の検証手順) ので、計測が汚れる。
//   他の 5 テストで既に使われている形をここにも入れる。
jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;
let tmpAudio: string;

function loadFresh() {
  jest.resetModules();
  mod = require('../../src/services/sttBackend');
}

function fakeOpenAI(text: string) {
  return {
    audio: {
      transcriptions: {
        create: jest.fn().mockResolvedValue({ text }),
      },
    },
  };
}

function jsonResponse(obj: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(obj),
  });
}

beforeEach(() => {
  tmpAudio = path.join(os.tmpdir(), `tealus-test-stt-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(tmpAudio, Buffer.from([0x52, 0x49, 0x46, 0x46])); // "RIFF"
  loadFresh();
});

afterEach(() => {
  if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio);
  delete process.env.STT_BACKEND;
  delete process.env.QWEN_WORKER_URL;
  delete process.env.STT_LOCAL_STRICT;
});

describe('transcribeAudio - openai backend (default)', () => {
  test('STT_BACKEND 未設定なら openai client を呼び text を返す', async () => {
    const openaiClient = fakeOpenAI('社長取れますか');
    const fetchImpl = jest.fn();
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', whisperPrompt: 'ctx', model: 'gpt-4o-mini-transcribe',
      openaiClient, fetchImpl,
    });
    expect(text).toBe('社長取れますか');
    expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    const arg = openaiClient.audio.transcriptions.create.mock.calls[0][0];
    expect(arg.model).toBe('gpt-4o-mini-transcribe');
    expect(arg.language).toBe('ja');
    expect(arg.prompt).toBe('ctx');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('whisperPrompt が空なら prompt を渡さない', async () => {
    const openaiClient = fakeOpenAI('x');
    await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', whisperPrompt: '', model: 'm', openaiClient,
    });
    const arg = openaiClient.audio.transcriptions.create.mock.calls[0][0];
    expect('prompt' in arg).toBe(false);
  });
});

describe('transcribeAudio - local backend', () => {
  test('STT_BACKEND=local なら worker に POST し、ファイル path と glossary を送る', async () => {
    process.env.STT_BACKEND = 'local';
    process.env.QWEN_WORKER_URL = 'http://127.0.0.1:9999/transcribe';
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ text: 'JU愛知', total_ms: 700 }));
    const openaiClient = fakeOpenAI('should-not-be-used');
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', whisperPrompt: 'ctx', model: 'm',
      glossary: 'JU愛知、鹿沼店', openaiClient, fetchImpl,
    });
    expect(text).toBe('JU愛知');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9999/transcribe');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.path).toBe(tmpAudio);
    expect(body.glossary).toBe('JU愛知、鹿沼店');
    expect(openaiClient.audio.transcriptions.create).not.toHaveBeenCalled();
  });

  test('worker が落ちてたら (fetch reject) openai に fail-open する', async () => {
    process.env.STT_BACKEND = 'local';
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const openaiClient = fakeOpenAI('fallback-text');
    const log = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', whisperPrompt: 'ctx', model: 'm',
      openaiClient, fetchImpl, log,
    });
    expect(text).toBe('fallback-text');
    expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalled();
  });

  test('worker が非200を返したら openai に fail-open する', async () => {
    process.env.STT_BACKEND = 'local';
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ error: 'boom' }, false, 500));
    const openaiClient = fakeOpenAI('fallback-text');
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', whisperPrompt: '', model: 'm', openaiClient, fetchImpl,
    });
    expect(text).toBe('fallback-text');
    expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
  });

  test('STT_LOCAL_STRICT=1 なら worker 障害時に fallback せず throw', async () => {
    process.env.STT_BACKEND = 'local';
    process.env.STT_LOCAL_STRICT = '1';
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const openaiClient = fakeOpenAI('fallback-text');
    await expect(mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', whisperPrompt: '', model: 'm', openaiClient, fetchImpl,
    })).rejects.toThrow();
    expect(openaiClient.audio.transcriptions.create).not.toHaveBeenCalled();
  });
});

// backend override 引数 (TRANSCRIPTION_MODE スパイク): mode=organon が STT を local に束ねる。
describe('transcribeAudio - backend override 引数', () => {
  test('backend 引数で env を上書きし local worker を叩く (env 未設定でも)', async () => {
    delete process.env.STT_BACKEND;
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ text: 'ワーカー結果' }));
    const openaiClient = fakeOpenAI('should-not-be-used');
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', backend: 'local', openaiClient, fetchImpl,
    });
    expect(text).toBe('ワーカー結果');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(openaiClient.audio.transcriptions.create).not.toHaveBeenCalled();
  });

  test('backend=openai で env=local を上書きして openai を叩く', async () => {
    process.env.STT_BACKEND = 'local';
    const fetchImpl = jest.fn();
    const openaiClient = fakeOpenAI('openai-text');
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', backend: 'openai', openaiClient, fetchImpl,
    });
    expect(text).toBe('openai-text');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('backend 未指定なら従来どおり env を読む (後方互換)', async () => {
    process.env.STT_BACKEND = 'local';
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ text: 'env local' }));
    const openaiClient = fakeOpenAI('x');
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', openaiClient, fetchImpl,
    });
    expect(text).toBe('env local');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// 言語誤検出ガード (2026-07-04 dogfood: Qwen が短クリップ「高梨さん取れますか」→「حسن」アラビア語)。
// prompt では回避不能と判明したので、日本語音声で出るはずのない外来スクリプトを検出 → openai へ fallback。
describe('looksLikeForeignScript', () => {
  test('アラビア/キリル/ハングル/タイ/デーヴァナーガリー を検出', () => {
    expect(mod.looksLikeForeignScript('حسن')).toBe(true);      // Arabic
    expect(mod.looksLikeForeignScript('Привет')).toBe(true);   // Cyrillic
    expect(mod.looksLikeForeignScript('안녕하세요')).toBe(true); // Hangul
    expect(mod.looksLikeForeignScript('สวัสดี')).toBe(true);   // Thai
  });
  test('日本語 / ラテン頭字語 / 空 は false (誤検出しない)', () => {
    expect(mod.looksLikeForeignScript('整備長、取れますか')).toBe(false);
    expect(mod.looksLikeForeignScript('はい、了解です')).toBe(false);
    expect(mod.looksLikeForeignScript('OK NTS 44')).toBe(false);
    expect(mod.looksLikeForeignScript('')).toBe(false);
    expect(mod.looksLikeForeignScript(null)).toBe(false);
  });
});

describe('transcribeAudio - local 言語誤検出 → openai fallback', () => {
  test('local が Arabic を返したら openai に fallback (高梨→حسن dogfood)', async () => {
    process.env.STT_BACKEND = 'local';
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ text: 'حسن' }));
    const openaiClient = fakeOpenAI('高梨さん、高梨さん取れますか');
    const log = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', openaiClient, fetchImpl, log,
    });
    expect(text).toBe('高梨さん、高梨さん取れますか');
    expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalled();
  });

  test('日本語出力はそのまま採用 (fallback しない)', async () => {
    process.env.STT_BACKEND = 'local';
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ text: '整備長、取れますか' }));
    const openaiClient = fakeOpenAI('should-not-be-used');
    const text = await mod.transcribeAudio({ inputPath: tmpAudio, ext: 'wav', model: 'm', openaiClient, fetchImpl });
    expect(text).toBe('整備長、取れますか');
    expect(openaiClient.audio.transcriptions.create).not.toHaveBeenCalled();
  });

  test('STT_LOCAL_STRICT なら誤検出時も fallback せず throw', async () => {
    process.env.STT_BACKEND = 'local';
    process.env.STT_LOCAL_STRICT = '1';
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ text: 'حسن' }));
    const openaiClient = fakeOpenAI('x');
    await expect(mod.transcribeAudio({ inputPath: tmpAudio, ext: 'wav', model: 'm', openaiClient, fetchImpl }))
      .rejects.toThrow();
    expect(openaiClient.audio.transcriptions.create).not.toHaveBeenCalled();
  });
});

// 中国語誤検出ガード (#332, 2026-07-14 朝礼 dogfood: Qwen が日本語音声を中国語と誤検出し
// 「每句一个」を吐く)。looksLikeForeignScript は漢字を意図的に除外しているため、
// 「かな欠如 かつ (簡体字専用字 or 漢字が一定長以上)」を別ガードで捕捉する。
describe('looksLikeChineseMisdetection', () => {
  test('簡体字専用字を含む全漢字 → true (每句一个 / 这个 / 说明)', () => {
    expect(mod.looksLikeChineseMisdetection('每句一个')).toBe(true);
    expect(mod.looksLikeChineseMisdetection('每句一个每句一个每句一个')).toBe(true);
    expect(mod.looksLikeChineseMisdetection('这个')).toBe(true);
    expect(mod.looksLikeChineseMisdetection('说明')).toBe(true);
  });
  test('かな欠如 かつ 漢字が長い → true (助詞なしの長文は日本語ではありえない)', () => {
    expect(mod.looksLikeChineseMisdetection('本日業務連絡議事録作成')).toBe(true); // 11 han, かな0
  });
  test('正常な日本語 (かなを含む) → false (素通り)', () => {
    expect(mod.looksLikeChineseMisdetection('整備長、取れますか')).toBe(false);
    expect(mod.looksLikeChineseMisdetection('はい、了解です')).toBe(false);
    expect(mod.looksLikeChineseMisdetection('社長、GC215を準備')).toBe(false);
  });
  test('短い全漢字の正当日本語 → false (了解/承知/再出品/型式番号 を誤爆しない)', () => {
    expect(mod.looksLikeChineseMisdetection('了解')).toBe(false);
    expect(mod.looksLikeChineseMisdetection('承知')).toBe(false);
    expect(mod.looksLikeChineseMisdetection('再出品')).toBe(false);
    expect(mod.looksLikeChineseMisdetection('型式番号')).toBe(false);
    expect(mod.looksLikeChineseMisdetection('会議室準備完了')).toBe(false); // 7 han, 閾値未満
  });
  test('ラテン/数字のみ・空・非文字列 → false', () => {
    expect(mod.looksLikeChineseMisdetection('GC215')).toBe(false);
    expect(mod.looksLikeChineseMisdetection('型式GC215')).toBe(false); // 2 han, 簡体字なし
    expect(mod.looksLikeChineseMisdetection('')).toBe(false);
    expect(mod.looksLikeChineseMisdetection(null)).toBe(false);
  });
});

describe('transcribeAudio - local 中国語誤検出 → openai fallback (#332)', () => {
  test('local が 每句一个 を返したら openai に fallback', async () => {
    process.env.STT_BACKEND = 'local';
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ text: '每句一个每句一个' }));
    const openaiClient = fakeOpenAI('おはようございます、朝礼を始めます');
    const log = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', openaiClient, fetchImpl, log,
    });
    expect(text).toBe('おはようございます、朝礼を始めます');
    expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalled();
  });

  test('STT_LOCAL_STRICT なら中国語誤検出時も fallback せず throw', async () => {
    process.env.STT_BACKEND = 'local';
    process.env.STT_LOCAL_STRICT = '1';
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ text: '每句一个' }));
    const openaiClient = fakeOpenAI('x');
    await expect(mod.transcribeAudio({ inputPath: tmpAudio, ext: 'wav', model: 'm', openaiClient, fetchImpl }))
      .rejects.toThrow();
    expect(openaiClient.audio.transcriptions.create).not.toHaveBeenCalled();
  });
});

/**
 * #424 gemini backend — gemini-3.5-transcribe + 音響段語彙 (custom_vocabulary)。
 *
 * ★ 2026-09-07 実測 (37 便、report/gemini-vocab/): 固有名詞 現行 50% → 語彙 286 語 85%。
 *   差は全部 音響段語彙から来ている (語彙なし Gemini は 47% で現行より悪い)。
 *
 * fail-open の型は local と同じ。★ 空文字も fallback する — gemini が静かに壊れたとき
 * (鍵切れ・応答形の変更) に全便が空になる事故を防ぐ。無音便は openai 側でも空なので実害なし。
 */
describe('transcribeAudio - gemini backend (#424)', () => {
  /** wav ヘッダつきの一時ファイルを作る (byteRate と本体サイズで秒数を偽装できる) */
  function writeWav(file: string, byteRate: number, dataBytes: number) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);            // PCM
    header.writeUInt16LE(1, 22);            // mono
    header.writeUInt32LE(44100, 24);        // sampleRate (参考値)
    header.writeUInt32LE(byteRate, 28);     // ★ byteRate — 秒数 = dataBytes / byteRate
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(dataBytes, 40);
    fs.writeFileSync(file, Buffer.concat([header, Buffer.alloc(dataBytes)]));
  }

  function geminiResponse(text: string) {
    return jsonResponse({ id: 'x', status: 'completed', steps: [{ content: [{ text }] }] });
  }

  const VOCAB = ['ガマ', '鹿沼店', 'イセキ'];

  beforeEach(() => {
    process.env.STT_BACKEND = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.STT_GEMINI_MODEL;
    delete process.env.STT_GEMINI_TIMEOUT_MS;
  });

  test('interactions へ POST し、鍵ヘッダ・語彙・mime を正しく送って text を返す', async () => {
    const fetchImpl = jest.fn().mockReturnValue(geminiResponse('ガマ、お昼に入ります。'));
    const openaiClient = fakeOpenAI('should-not-be-used');
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB, openaiClient, fetchImpl,
    });
    expect(text).toBe('ガマ、お昼に入ります。');
    expect(openaiClient.audio.transcriptions.create).not.toHaveBeenCalled();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gemini-3.5-transcribe');
    expect(body.input[0].mime_type).toBe('audio/wav');
    expect(typeof body.input[0].data).toBe('string');           // base64
    const tc = body.generation_config.transcription_config;
    expect(tc.language_codes).toEqual(['ja-JP']);
    expect(tc.custom_vocabulary).toEqual(VOCAB);
  });

  test('STT_GEMINI_MODEL で model を差し替えられる', async () => {
    process.env.STT_GEMINI_MODEL = 'gemini-next-transcribe';
    const fetchImpl = jest.fn().mockReturnValue(geminiResponse('x'));
    await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB,
      openaiClient: fakeOpenAI('y'), fetchImpl,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('gemini-next-transcribe');
  });

  test('429 → openai へ fail-open し warn を残す', async () => {
    const fetchImpl = jest.fn().mockReturnValue(jsonResponse({ error: { message: 'quota' } }, false, 429));
    const openaiClient = fakeOpenAI('fallback-text');
    const log = { warn: jest.fn(), error: jest.fn() };
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB, openaiClient, fetchImpl, log,
    });
    expect(text).toBe('fallback-text');
    expect(openaiClient.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalled();
  });

  test('fetch reject (ネットワーク) → openai へ fail-open', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const openaiClient = fakeOpenAI('fallback-text');
    const log = { warn: jest.fn(), error: jest.fn() };
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB, openaiClient, fetchImpl, log,
    });
    expect(text).toBe('fallback-text');
  });

  test('★ 空文字 → openai へ fail-open (静かに壊れても全便が空にならない)', async () => {
    const fetchImpl = jest.fn().mockReturnValue(geminiResponse(''));
    const openaiClient = fakeOpenAI('fallback-text');
    const log = { warn: jest.fn(), error: jest.fn() };
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB, openaiClient, fetchImpl, log,
    });
    expect(text).toBe('fallback-text');
    expect(log.warn).toHaveBeenCalled();
  });

  test('GEMINI_API_KEY 未設定 → openai へ fail-open (設定ミスで文字起こしを止めない)', async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchImpl = jest.fn();
    const openaiClient = fakeOpenAI('fallback-text');
    const log = { warn: jest.fn(), error: jest.fn() };
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB, openaiClient, fetchImpl, log,
    });
    expect(text).toBe('fallback-text');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ★ 切断ガード — 実測の 2 件 (28 秒 → 10 字 / 13 秒 → 15 字。呼びかけだけ残して用件が消えた) を固定。
  //   誤検知の代償は openai 呼び出し 1 回 (= 現行と同じ結果) なので安全側に倒す。
  test('★ 切断疑い (28 秒の音声に 10 字) → openai へ fail-open', async () => {
    writeWav(tmpAudio, 1000, 28_000);                            // 28 秒ぶん
    const fetchImpl = jest.fn().mockReturnValue(geminiResponse('ガマさん取れますか？'));  // 10 字
    const openaiClient = fakeOpenAI('fallback-text');
    const log = { warn: jest.fn(), error: jest.fn() };
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB, openaiClient, fetchImpl, log,
    });
    expect(text).toBe('fallback-text');
    expect(log.warn).toHaveBeenCalled();
  });

  test('★ 切断疑い (13 秒に 15 字) も fallback / 33 秒に 100 字は通常どおり通す', async () => {
    writeWav(tmpAudio, 1000, 13_000);
    const openaiClient = fakeOpenAI('fallback-text');
    const log = { warn: jest.fn(), error: jest.fn() };
    const short = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB, openaiClient,
      fetchImpl: jest.fn().mockReturnValue(geminiResponse('ガマさん、ガマさん取れますか？')), log,  // 15 字
    });
    expect(short).toBe('fallback-text');

    writeWav(tmpAudio, 1000, 33_000);
    const longText = 'あ'.repeat(100);
    const ok = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB, openaiClient: fakeOpenAI('no'),
      fetchImpl: jest.fn().mockReturnValue(geminiResponse(longText)), log,
    });
    expect(ok).toBe(longText);
  });

  test('10 秒未満の短い便は文字数が少なくてもガードしない (「了解です」だけの便は正当)', async () => {
    writeWav(tmpAudio, 1000, 6_000);                             // 6 秒
    const fetchImpl = jest.fn().mockReturnValue(geminiResponse('了解です。'));
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: VOCAB,
      openaiClient: fakeOpenAI('no'), fetchImpl,
    });
    expect(text).toBe('了解です。');
  });

  test('★ videoAudio=true → gemini を叩かず openai 直行 (実測は 33 秒以下の voice クリップのみ)', async () => {
    const fetchImpl = jest.fn();
    const openaiClient = fakeOpenAI('openai-text');
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'mp3', model: 'm', vocabTerms: VOCAB, videoAudio: true,
      openaiClient, fetchImpl,
    });
    expect(text).toBe('openai-text');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('★ 語彙 0 件 → openai 直行 (語彙なし Gemini 47% は現行 50% より悪い実測)', async () => {
    const fetchImpl = jest.fn();
    const openaiClient = fakeOpenAI('openai-text');
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', vocabTerms: [], openaiClient, fetchImpl,
    });
    expect(text).toBe('openai-text');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('backend 引数 gemini が env を上書きする (既存 override と同型)', async () => {
    delete process.env.STT_BACKEND;
    const fetchImpl = jest.fn().mockReturnValue(geminiResponse('via-arg'));
    const text = await mod.transcribeAudio({
      inputPath: tmpAudio, ext: 'wav', model: 'm', backend: 'gemini', vocabTerms: VOCAB,
      openaiClient: fakeOpenAI('no'), fetchImpl,
    });
    expect(text).toBe('via-arg');
  });
});
