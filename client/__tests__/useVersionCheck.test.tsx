import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * #356 更新検知フック。
 *
 * iOS の SW 自動更新チェックが不発でも気づけるようにするのが目的なので、
 * 「前面に戻ったとき」に必ず確かめることが要件の中心。
 */

const getVersion = vi.fn();
vi.mock('../src/services/api', () => ({
  api: { getVersion: (...args: unknown[]) => getVersion(...args) },
}));

vi.mock('../src/utils/buildVersion', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/buildVersion')>('../src/utils/buildVersion');
  return { ...actual, BUILD_ID: 'own-build' };
});

const { useVersionCheck } = await import('../src/hooks/useVersionCheck');

describe('useVersionCheck', () => {
  beforeEach(() => {
    getVersion.mockReset();
    getVersion.mockResolvedValue({ build_id: 'own-build' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('起動時に確認し、一致していれば更新なし', async () => {
    const { result } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    expect(result.current.updateAvailable).toBe(false);
  });

  it('サーバの ID が違えば更新ありになる', async () => {
    getVersion.mockResolvedValue({ build_id: 'newer-build' });
    const { result } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));
  });

  it('前面に戻ったときに確かめ直す (iOS の PWA 復帰が本命の契機)', async () => {
    const { result } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(getVersion).toHaveBeenCalledTimes(1));

    getVersion.mockResolvedValue({ build_id: 'newer-build' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(result.current.updateAvailable).toBe(true));
  });

  it('サーバが不明 (null) を返しても更新ありにしない', async () => {
    getVersion.mockResolvedValue({ build_id: null });
    const { result } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    expect(result.current.updateAvailable).toBe(false);
  });

  it('取得に失敗しても落ちない / 更新ありにしない (オフライン時に誤爆させない)', async () => {
    getVersion.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    expect(result.current.updateAvailable).toBe(false);
  });

  it('一度検知したら、その後の失敗で取り消さない', async () => {
    getVersion.mockResolvedValue({ build_id: 'newer-build' });
    const { result } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));

    getVersion.mockRejectedValue(new Error('offline'));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(getVersion).toHaveBeenCalledTimes(2));
    expect(result.current.updateAvailable).toBe(true);
  });

  it('unmount 後は listener が残らない', async () => {
    const { unmount } = renderHook(() => useVersionCheck());
    await waitFor(() => expect(getVersion).toHaveBeenCalledTimes(1));
    unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getVersion).toHaveBeenCalledTimes(1);
  });
});
