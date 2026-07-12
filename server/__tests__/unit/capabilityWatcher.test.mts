/**
 * capabilityWatcher のユニットテスト。
 *
 * fetch を mock して ping の成否を制御し、checkAndEmit() が
 *   - 状態遷移を正しく行うか (true/false)
 *   - flap 抑制 (連続 2 回失敗で disable、1 回成功で即 enable) が機能するか
 *   - 状態変化時のみ Socket.IO に emit するか
 * を検証する。
 */

jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

import { start, stop, getState, checkAndEmit } from '../../src/services/capabilityWatcher.mts';

describe('capabilityWatcher', () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: jest.Mock;
  let mockIo: { emit: jest.Mock };

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof global.fetch;
    mockIo = { emit: jest.fn() };
    // 内部状態をリセット (stop は state も初期化する)
    stop();
  });

  afterEach(() => {
    stop();
    global.fetch = originalFetch;
  });

  // ping を成功させる helper
  function mockOk() {
    mockFetch.mockResolvedValueOnce({ ok: true });
  }
  // ping を失敗させる helper (network error)
  function mockFail() {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
  }
  // ping を timeout させる helper
  function mockTimeout() {
    mockFetch.mockImplementationOnce(() => new Promise((_, reject) => {
      // すぐ AbortController.abort() が呼ばれるはず → reject
      setTimeout(() => reject(new Error('aborted')), 10);
    }));
  }

  test('初期状態は false (rtc-server 未起動を仮定)', () => {
    expect(getState()).toBe(false);
  });

  test('1 回目の ping 成功で true に遷移、emit される', async () => {
    mockOk();
    start(mockIo);
    // start 内の checkAndEmit を待つ
    await new Promise((r) => setTimeout(r, 50));
    expect(getState()).toBe(true);
    expect(mockIo.emit).toHaveBeenCalledWith('capability:changed', expect.objectContaining({
      realtime_voice_available: true,
    }));
  });

  test('連続 2 回失敗で false に遷移する (flap 抑制)', async () => {
    // 起動 → 1 回成功で true に
    mockOk();
    start(mockIo);
    await new Promise((r) => setTimeout(r, 50));
    expect(getState()).toBe(true);
    mockIo.emit.mockClear();

    // 1 回目失敗: state は維持
    mockFail();
    await checkAndEmit();
    expect(getState()).toBe(true);
    expect(mockIo.emit).not.toHaveBeenCalled();

    // 2 回目失敗: false に降格、emit される
    mockFail();
    await checkAndEmit();
    expect(getState()).toBe(false);
    expect(mockIo.emit).toHaveBeenCalledWith('capability:changed', expect.objectContaining({
      realtime_voice_available: false,
    }));
  });

  test('false 状態から 1 回成功で true に即昇格する', async () => {
    // 開始時 false のまま (1 回失敗で初期化想定だが、実際は consecutive=1 のみ)
    // ここでは false 状態を作るために連続失敗
    mockFail();
    start(mockIo);
    await new Promise((r) => setTimeout(r, 50));
    mockFail();
    await checkAndEmit();
    expect(getState()).toBe(false);
    mockIo.emit.mockClear();

    // 1 回成功で true に
    mockOk();
    await checkAndEmit();
    expect(getState()).toBe(true);
    expect(mockIo.emit).toHaveBeenCalledWith('capability:changed', expect.objectContaining({
      realtime_voice_available: true,
    }));
  });

  test('状態変化が無い場合は emit しない', async () => {
    mockOk();
    start(mockIo);
    await new Promise((r) => setTimeout(r, 50));
    mockIo.emit.mockClear();

    // 連続成功 → emit されない
    mockOk();
    await checkAndEmit();
    expect(mockIo.emit).not.toHaveBeenCalled();

    mockOk();
    await checkAndEmit();
    expect(mockIo.emit).not.toHaveBeenCalled();
  });

  test('changed_at は ISO 8601 形式で含まれる', async () => {
    mockOk();
    start(mockIo);
    await new Promise((r) => setTimeout(r, 50));

    const call = mockIo.emit.mock.calls[0];
    expect(call[0]).toBe('capability:changed');
    expect(call[1].changed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
