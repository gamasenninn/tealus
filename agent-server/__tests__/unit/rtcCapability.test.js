/**
 * agent-server の rtcCapability watcher のテスト。
 * server 側 capabilityWatcher と同じ flap 抑制ロジック。
 */

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

const rtcCapability = require('../../src/lib/rtcCapability');

describe('agent-server rtcCapability', () => {
  let originalFetch;
  let mockFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    rtcCapability.stop();
  });

  afterEach(() => {
    rtcCapability.stop();
    global.fetch = originalFetch;
  });

  function mockOk() {
    mockFetch.mockResolvedValueOnce({ ok: true });
  }
  function mockFail() {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
  }

  test('初期状態は false', () => {
    expect(rtcCapability.getState()).toBe(false);
  });

  test('1 回成功で true に遷移する', async () => {
    mockOk();
    await rtcCapability.check();
    expect(rtcCapability.getState()).toBe(true);
  });

  test('連続 2 回失敗で false に降格する (flap 抑制)', async () => {
    mockOk();
    await rtcCapability.check();
    expect(rtcCapability.getState()).toBe(true);

    mockFail();
    await rtcCapability.check();
    expect(rtcCapability.getState()).toBe(true); // 1 回失敗ではまだ維持

    mockFail();
    await rtcCapability.check();
    expect(rtcCapability.getState()).toBe(false); // 2 回連続失敗で降格
  });

  test('false 状態から 1 回成功で true に即昇格する', async () => {
    mockFail();
    await rtcCapability.check();
    mockFail();
    await rtcCapability.check();
    expect(rtcCapability.getState()).toBe(false);

    mockOk();
    await rtcCapability.check();
    expect(rtcCapability.getState()).toBe(true);
  });
});
