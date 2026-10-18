/**
 * #607 アプリパネルの iframe に入れる URL (docs/11 §5.3)。
 * 「通行証を添える」が付いたアプリは、通行証つきの入口 URL を取ってから開く。取れなければ元の URL で開く
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
vi.mock('../../src/services/api', () => ({ api: { getAppPass: vi.fn(), getPortalAppPass: vi.fn() } }));
import { api } from '../../src/services/api';
import { useAppPassUrl, usePortalPassUrl } from '../../src/hooks/useAppPassUrl';

const getAppPass = vi.mocked(api.getAppPass);
const getPortalAppPass = vi.mocked(api.getPortalAppPass);

/**
 * #607 ホーム画面のタブ (portal_links) も同じ扱い (改善ループ 8 回目の A)。
 * ★ 部屋のアプリだけに付けていて、ホームの社内ポータルが相手側の案内ページになった
 */
describe('usePortalPassUrl (#607)', () => {
  beforeEach(() => { getPortalAppPass.mockReset(); });

  it('印の無いリンクは、元の URL をそのまま', () => {
    const { result } = renderHook(() => usePortalPassUrl({ id: 'p1', url: 'https://a.example/' }, true));
    expect(result.current).toBe('https://a.example/');
    expect(getPortalAppPass).not.toHaveBeenCalled();
  });

  it('★ 印のあるリンクは、取れるまで about:blank、取れたら入口 URL', async () => {
    getPortalAppPass.mockResolvedValue({ url: 'https://apps.example.com/tealus-gate/?tealus_pass=v1.p.q' });
    const { result } = renderHook(() => usePortalPassUrl({ id: 'p1', url: 'https://apps.example.com/close/', pass: true }, true));
    expect(result.current).toBe('about:blank');
    expect(getPortalAppPass).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(result.current).toBe('https://apps.example.com/tealus-gate/?tealus_pass=v1.p.q'));
  });

  it('取れなかったら元の URL / タブが選ばれていない間は取りに行かない', async () => {
    getPortalAppPass.mockRejectedValue(new Error('x'));
    const link = { id: 'p1', url: 'https://apps.example.com/close/', pass: true };
    const { result: closed } = renderHook(() => usePortalPassUrl(link, false));
    expect(getPortalAppPass).not.toHaveBeenCalled();
    expect(closed.current).toBe('about:blank');
    const { result } = renderHook(() => usePortalPassUrl(link, true));
    await waitFor(() => expect(result.current).toBe(link.url));
  });
});
const APP = { title: '棚卸', url: 'https://apps.example.com/close/a', pass: true };

describe('useAppPassUrl (#607)', () => {
  beforeEach(() => { getAppPass.mockReset(); });

  it('通行証の無いアプリは、元の URL をそのまま (口を呼ばない)', () => {
    const { result } = renderHook(() => useAppPassUrl('r1', { title: 'x', url: 'https://a.example/' }, 0, true));
    expect(result.current).toBe('https://a.example/');
    expect(getAppPass).not.toHaveBeenCalled();
  });

  it('★ 通行証つきのアプリは、取れるまで何も開かず、取れたら入口 URL を開く', async () => {
    let resolve!: (v: { url: string }) => void;
    getAppPass.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useAppPassUrl('r1', APP, 2, true));
    // ★ 先に元の URL を開くと、iPhone ではその間にパスワードの箱が出る
    expect(result.current).toBe('about:blank');
    expect(getAppPass).toHaveBeenCalledWith('r1', 2, APP.url);
    resolve({ url: 'https://apps.example.com/tealus-gate/?tealus_pass=v1.a.b' });
    await waitFor(() => expect(result.current).toBe('https://apps.example.com/tealus-gate/?tealus_pass=v1.a.b'));
  });

  it('取れなかったら、元の URL で開く (今と同じくベーシック認証が出る。壊れない)', async () => {
    getAppPass.mockRejectedValue(new Error('このアプリには通行証を出せません'));
    const { result } = renderHook(() => useAppPassUrl('r1', APP, 0, true));
    await waitFor(() => expect(result.current).toBe(APP.url));
  });

  it('パネルが閉じている間は取りに行かない', () => {
    const { result } = renderHook(() => useAppPassUrl('r1', APP, 0, false));
    expect(getAppPass).not.toHaveBeenCalled();
    expect(result.current).toBe('about:blank');
  });

  it('★ 開き直すたびに新しい通行証を取る (閉じて開く)', async () => {
    getAppPass.mockResolvedValue({ url: 'https://apps.example.com/tealus-gate/?tealus_pass=v1.a.b' });
    const { rerender } = renderHook(({ open }) => useAppPassUrl('r1', APP, 0, open), { initialProps: { open: true } });
    await waitFor(() => expect(getAppPass).toHaveBeenCalledTimes(1));
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(getAppPass).toHaveBeenCalledTimes(2));
  });

  it('★ 遅れて返った前のアプリの通行証で、今のアプリを上書きしない', async () => {
    let resolveFirst!: (v: { url: string }) => void;
    getAppPass
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ url: 'https://apps.example.com/tealus-gate/?tealus_pass=second' });
    const other = { ...APP, url: 'https://apps.example.com/close/b' };
    const { result, rerender } = renderHook(({ app, i }) => useAppPassUrl('r1', app, i, true), { initialProps: { app: APP, i: 0 } });
    rerender({ app: other, i: 1 });
    await waitFor(() => expect(result.current).toBe('https://apps.example.com/tealus-gate/?tealus_pass=second'));
    resolveFirst({ url: 'https://apps.example.com/tealus-gate/?tealus_pass=first' });
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBe('https://apps.example.com/tealus-gate/?tealus_pass=second');
  });
});
