/**
 * sttBackend ユニットテスト (#自ホストSTT)
 * 「音声ファイル -> raw text」を STT_BACKEND で切替する strategy のロジック。
 * openai client と fetch を注入して、本番 API / 常駐ワーカーを実際には叩かない。
 * DB 非依存 (feedback_test_db_guard: request(app) は使わない)。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let mod;
let tmpAudio;

function loadFresh() {
  jest.resetModules();
  mod = require('../../src/services/sttBackend');
}

function fakeOpenAI(text) {
  return {
    audio: {
      transcriptions: {
        create: jest.fn().mockResolvedValue({ text }),
      },
    },
  };
}

function jsonResponse(obj, ok = true, status = 200) {
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
