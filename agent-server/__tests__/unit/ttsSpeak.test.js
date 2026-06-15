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

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

const mockSynthesize = jest.fn();
const mockSendViaPlainTransport = jest.fn();
jest.mock('../../src/lib/tts-core', () => ({
  synthesize: (...args) => mockSynthesize(...args),
  sendViaPlainTransport: (...args) => mockSendViaPlainTransport(...args),
}));

const mockPushTtsSpeak = jest.fn();
const mockPushTtsAudio = jest.fn();
jest.mock('../../src/lib/botApi', () => ({
  pushTtsSpeak: (...args) => mockPushTtsSpeak(...args),
  pushTtsAudio: (...args) => mockPushTtsAudio(...args),
}));

describe('ttsSpeak speakMessage', () => {
  let originalAivisKey;
  let originalBroadcastMediasoup;

  beforeEach(() => {
    jest.resetModules();
    originalAivisKey = process.env.AIVIS_API_KEY;
    originalBroadcastMediasoup = process.env.TTS_BROADCAST_MEDIASOUP;
    mockSynthesize.mockReset().mockResolvedValue(Buffer.from('fake-wav'));
    mockSendViaPlainTransport.mockReset().mockResolvedValue();
    mockPushTtsSpeak.mockReset().mockResolvedValue();
    mockPushTtsAudio.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    if (originalAivisKey === undefined) delete process.env.AIVIS_API_KEY;
    else process.env.AIVIS_API_KEY = originalAivisKey;
    if (originalBroadcastMediasoup === undefined) delete process.env.TTS_BROADCAST_MEDIASOUP;
    else process.env.TTS_BROADCAST_MEDIASOUP = originalBroadcastMediasoup;
  });

  // 同期完了を待つ helper (queue の processQueue は非同期)
  function flushAsync(ms = 30) {
    return new Promise((r) => setTimeout(r, ms));
  }

  test('TTS_PROVIDER=browser → pushTtsSpeak のみ', async () => {
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'browser' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'こんにちは');
    await flushAsync();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'こんにちは');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  test('TTS_PROVIDER=aivis-cloud + AIVIS_API_KEY 設定済 → synthesize + pushTtsAudio', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync();

    expect(mockSynthesize).toHaveBeenCalled();
    expect(mockPushTtsAudio).toHaveBeenCalledWith('room-1', expect.any(Buffer));
    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
    expect(mockSendViaPlainTransport).not.toHaveBeenCalled(); // BROADCAST_MEDIASOUP デフォルト false
  });

  test('TTS_PROVIDER=aivis-cloud + AIVIS_API_KEY 未設定 → browser に fallback', async () => {
    delete process.env.AIVIS_API_KEY;
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync();

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト');
    expect(mockPushTtsAudio).not.toHaveBeenCalled();
  });

  test('aivis-cloud + Aivis 合成失敗 → pushTtsSpeak に fallback', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    mockSynthesize.mockRejectedValueOnce(new Error('Aivis API error'));
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
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
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
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
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト');
    await flushAsync(50);

    expect(mockPushTtsAudio).toHaveBeenCalled();
    expect(mockSendViaPlainTransport).toHaveBeenCalled();
  });

  test('TTS_PROVIDER=none → 何もしない', async () => {
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'none' }));
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
