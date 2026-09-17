/**
 * ttsSpeak の動作テスト (#189 リファクタ後)。
 *
 * 配信経路:
 *   - browser → pushTtsSpeak (text)
 *   - aivis-cloud + 合成成功 → pushTtsAudio (WAV blob)
 *   - aivis-cloud + 合成失敗 → pushTtsSpeak fallback
 *   - aivis-cloud + Socket.IO POST 失敗 → pushTtsSpeak fallback
 *   - aivis-cloud + AIVIS_API_KEY なし → pushTtsSpeak fallback
 *   - none → no-op
 *
 * TTS_BROADCAST_MEDIASOUP=true 時は sendViaPlainTransport も並走。
 */

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

const mockSynthesize = jest.fn();
const mockSendViaPlainTransport = jest.fn();
jest.mock('../../src/lib/tts-core.mts', () => ({
  synthesize: (...args: unknown[]) => mockSynthesize(...args),
  sendViaPlainTransport: (...args: unknown[]) => mockSendViaPlainTransport(...args),
}));

const mockSynthesizeOpenai = jest.fn();
jest.mock('../../src/lib/tts-openai.mts', () => ({
  synthesizeOpenai: (...args: unknown[]) => mockSynthesizeOpenai(...args),
}));

const mockPushTtsSpeak = jest.fn();
const mockPushTtsAudio = jest.fn();
jest.mock('../../src/lib/botApi.mts', () => ({
  pushTtsSpeak: (...args: unknown[]) => mockPushTtsSpeak(...args),
  pushTtsAudio: (...args: unknown[]) => mockPushTtsAudio(...args),
}));

describe('ttsSpeak speakMessage', () => {
  let originalAivisKey: string | undefined;
  let originalBroadcastMediasoup: string | undefined;

  beforeEach(() => {
    jest.resetModules();
    originalAivisKey = process.env.AIVIS_API_KEY;
    originalBroadcastMediasoup = process.env.TTS_BROADCAST_MEDIASOUP;
    mockSynthesize.mockReset().mockResolvedValue(Buffer.from('fake-wav'));
    mockSendViaPlainTransport.mockReset().mockResolvedValue(undefined);
    mockPushTtsSpeak.mockReset().mockResolvedValue(undefined);
    mockPushTtsAudio.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    if (originalAivisKey === undefined) delete process.env.AIVIS_API_KEY;
    else process.env.AIVIS_API_KEY = originalAivisKey;
    if (originalBroadcastMediasoup === undefined) delete process.env.TTS_BROADCAST_MEDIASOUP;
    else process.env.TTS_BROADCAST_MEDIASOUP = originalBroadcastMediasoup;
  });

  // 同期完了を待つ helper (queue の processQueue は非同期)
  function flushAsync(ms = 30): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  test('TTS_PROVIDER=browser → pushTtsSpeak のみ', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'browser' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'こんにちは');
    await flushAsync();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'こんにちは');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  test('TTS_PROVIDER=aivis-cloud + AIVIS_API_KEY 設定済 → synthesize + pushTtsAudio', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync();

    expect(mockSynthesize).toHaveBeenCalled();
    // ★ #444: contentType を明示して渡すようになった。★★ aivis 側は wav のまま (回帰の見張り)
    expect(mockPushTtsAudio).toHaveBeenCalledWith('room-1', expect.any(Buffer), 'audio/wav');
    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
    expect(mockSendViaPlainTransport).not.toHaveBeenCalled(); // BROADCAST_MEDIASOUP デフォルト false
  });

  test('TTS_PROVIDER=aivis-cloud + AIVIS_API_KEY 未設定 → browser に fallback', async () => {
    delete process.env.AIVIS_API_KEY;
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
  });

  test('aivis-cloud + Aivis 合成失敗 → pushTtsSpeak に fallback', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    mockSynthesize.mockRejectedValueOnce(new Error('Aivis API error'));
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync(50);

    expect(mockSynthesize).toHaveBeenCalled();
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
  });

  test('aivis-cloud + Socket.IO POST 失敗 → pushTtsSpeak に fallback', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    mockPushTtsAudio.mockRejectedValueOnce(new Error('Network error'));
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync(50);

    expect(mockSynthesize).toHaveBeenCalled();
    expect(mockPushTtsAudio).toHaveBeenCalled();
    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
  });

  test('TTS_BROADCAST_MEDIASOUP=true → pushTtsAudio + sendViaPlainTransport の両方', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    process.env.TTS_BROADCAST_MEDIASOUP = 'true';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync(50);

    expect(mockPushTtsAudio).toHaveBeenCalled();
    expect(mockSendViaPlainTransport).toHaveBeenCalled();
  });

  test('TTS_PROVIDER=none → 何もしない', async () => {
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'none' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync();

    expect(mockSynthesize).not.toHaveBeenCalled();
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
  });
});

describe('preprocessText hard cap (Aivis 3000 文字上限)', () => {
  const { preprocessText } = require('../../src/lib/ttsSpeak');

  test('truncate=true: 500 文字超は「以下省略」で短縮 (既存挙動)', () => {
    const out = preprocessText('あ'.repeat(800), { truncate: true });
    expect(out.length).toBeLessThanOrEqual(520);
    expect(out.endsWith('以下省略。')).toBe(true);
  });

  test('truncate=false でも API 上限 (3000) は必ず enforce (422 防止)', () => {
    const out = preprocessText('あ'.repeat(5000), { truncate: false });
    expect(out.length).toBeLessThanOrEqual(3000);
    expect(out.endsWith('以下省略。')).toBe(true);
  });

  test('truncate=false で 3000 字以内ならそのまま全文 (短縮しない)', () => {
    const body = 'これはテストです。'.repeat(100); // 900 文字程度
    const out = preprocessText(body, { truncate: false });
    expect(out.endsWith('以下省略。')).toBe(false);
    expect(out.length).toBeLessThanOrEqual(3000);
  });
});

/**
 * #444 段 1 — TTS_PROVIDER=openai の分岐。
 *
 * ★ aivis-cloud と **同じ形**に乗る: 合成 → pushTtsAudio → Socket.IO 配信。
 *   ★★ 違うのは合成関数と contentType だけ。★★★ fallback / queue / 排他は既存のまま。
 */
describe('ttsSpeak speakMessage — ★ TTS_PROVIDER=openai (#444)', () => {
  let originalOpenaiKey: string | undefined;

  beforeEach(() => {
    jest.resetModules();
    originalOpenaiKey = process.env.OPENAI_API_KEY;
    mockSynthesizeOpenai.mockReset().mockResolvedValue({ buffer: Buffer.from('fake-openai-wav'), contentType: 'audio/wav' });
    mockPushTtsSpeak.mockReset().mockResolvedValue(undefined);
    mockPushTtsAudio.mockReset().mockResolvedValue({ ok: true });
    mockSynthesize.mockReset().mockResolvedValue(Buffer.from('fake-wav'));
  });

  afterEach(() => {
    if (originalOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenaiKey;
  });

  function flush(ms = 30): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  test('openai + OPENAI_API_KEY 設定済 → ★ synthesizeOpenai + pushTtsAudio (contentType つき)', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush();

    expect(mockSynthesizeOpenai).toHaveBeenCalled();
    expect(mockSynthesize).not.toHaveBeenCalled();            // ★ Aivis は叩かない
    expect(mockPushTtsAudio).toHaveBeenCalledWith('room-1', expect.any(Buffer), 'audio/wav');
    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
  });

  test('openai + 合成失敗 → ★ browser に fallback (★★ aivis と同じ形)', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockSynthesizeOpenai.mockRejectedValueOnce(new Error('OpenAI 500'));
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush(50);

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
  });

  test('★★★★ openai は読みを当ててから合成する (#446) —— ★ 鹿沼 → カヌマ', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', '鹿沼の現場に行きます');
    await flush();

    expect(mockSynthesizeOpenai).toHaveBeenCalledWith('カヌマの現場に行きます', expect.any(Object));
  });

  test('★★★★ aivis は読みを当てない (#446) —— ★ Aivis は正しく読めるので触らない', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', '鹿沼の現場に行きます');
    await flush();

    // ★ 原文のまま渡る (★★ 置換して壊す理由が無い)
    expect(mockSynthesize).toHaveBeenCalledWith('鹿沼の現場に行きます', expect.anything());
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
  });

  test('★★ openai + OPENAI_API_KEY 未設定 → browser に fallback (★ 黙って止まらない)', async () => {
    delete process.env.OPENAI_API_KEY;
    jest.doMock('../../src/config.mts', () => ({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: '' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flush();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockSynthesizeOpenai).not.toHaveBeenCalled();
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
  });
});
