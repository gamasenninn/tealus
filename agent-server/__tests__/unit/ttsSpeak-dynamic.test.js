/**
 * ttsSpeak の動的 provider degrade テスト。
 * aivis-cloud 選択中でも rtc-server 不可なら browser に降格することを検証。
 */

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

// ttsCore は外部 API 依存なので mock
jest.mock('../../src/lib/tts-core', () => ({
  synthesize: jest.fn().mockResolvedValue(Buffer.from('fake-wav')),
  sendViaPlainTransport: jest.fn().mockResolvedValue(),
}));

// botApi.pushTtsSpeak (browser 経路) を mock
const mockPushTtsSpeak = jest.fn().mockResolvedValue();
jest.mock('../../src/lib/botApi', () => ({
  pushTtsSpeak: mockPushTtsSpeak,
}));

// rtcCapability を制御
const mockGetRtcState = jest.fn();
jest.mock('../../src/lib/rtcCapability', () => ({
  getState: () => mockGetRtcState(),
  start: jest.fn(),
  stop: jest.fn(),
  check: jest.fn(),
}));

describe('ttsSpeak dynamic provider degrade', () => {
  let originalAivisKey;

  beforeEach(() => {
    jest.resetModules();
    originalAivisKey = process.env.AIVIS_API_KEY;
    mockPushTtsSpeak.mockClear();
    mockGetRtcState.mockReset();
  });

  afterEach(() => {
    if (originalAivisKey === undefined) delete process.env.AIVIS_API_KEY;
    else process.env.AIVIS_API_KEY = originalAivisKey;
  });

  test('TTS_PROVIDER=aivis-cloud + rtc 不可 → browser に degrade', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    mockGetRtcState.mockReturnValue(false); // rtc 不可

    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト発話');

    // 同期完了待ち
    await new Promise((r) => setTimeout(r, 10));

    // browser 経路 (botApi.pushTtsSpeak) が呼ばれること
    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト発話');
  });

  test('TTS_PROVIDER=aivis-cloud + rtc 可 → aivis 経路 (browser に degrade しない)', async () => {
    process.env.AIVIS_API_KEY = 'test-key';
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'aivis-cloud' }));
    mockGetRtcState.mockReturnValue(true); // rtc 可

    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト発話');

    await new Promise((r) => setTimeout(r, 10));

    // browser 経路は呼ばれない (aivis-cloud queue へ送られる)
    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
  });

  test('TTS_PROVIDER=browser → 元から browser、rtc 状態に関わらず browser', async () => {
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'browser' }));
    mockGetRtcState.mockReturnValue(true);

    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト発話');

    await new Promise((r) => setTimeout(r, 10));

    expect(mockPushTtsSpeak).toHaveBeenCalledWith('room-1', 'テスト発話');
  });

  test('TTS_PROVIDER=none → 何もしない (rtc 状態に関わらず)', async () => {
    jest.doMock('../../src/config', () => ({ TTS_PROVIDER: 'none' }));
    mockGetRtcState.mockReturnValue(true);

    const { speakMessage } = require('../../src/lib/ttsSpeak');
    speakMessage('room-1', 'テスト発話');

    await new Promise((r) => setTimeout(r, 10));

    expect(mockPushTtsSpeak).not.toHaveBeenCalled();
  });
});
