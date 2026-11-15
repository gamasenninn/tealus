/**
 * アプリを別のタブで開く (2026-11-15、EC の管理画面を PC で全画面に開くため。docs/11 §5.3)
 * ★ 押した瞬間に空のタブを開き、通行証を取ってから移す (取り終わってから開くと、ブラウザがポップアップとして止める)
 * ★ 開いたタブの opener を切る (相手のページから Tealus のタブを書き換えられないように)
 */
import { describe, it, expect, vi } from 'vitest';
import { openAppInNewTab } from '../src/utils/openAppInNewTab';

function fakeWindow() {
  const tab = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
  const open = vi.fn(() => tab as unknown as Window);
  return { tab, open };
}

describe('openAppInNewTab', () => {
  it('★★ 通行証を添えるアプリは、先に空のタブを開き、通行証の URL へ移す', async () => {
    const { tab, open } = fakeWindow();
    let resolve!: (v: { url: string }) => void;
    const fetchPass = vi.fn(() => new Promise<{ url: string }>((r) => { resolve = r; }));
    const done = openAppInNewTab({ url: 'https://shop.example.com/admin/', pass: true }, fetchPass, open);
    // 通行証を待つ前に、もうタブは開いている (クリックの中で開く)
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    resolve({ url: 'https://shop.example.com/tealus-gate/?tealus_pass=v1.a.b' });
    await done;
    expect(tab.location.href).toBe('https://shop.example.com/tealus-gate/?tealus_pass=v1.a.b');
  });

  it('通行証が取れなかったら、元の URL を開く (iframe と同じ。壊れない)', async () => {
    const { tab, open } = fakeWindow();
    await openAppInNewTab({ url: 'https://shop.example.com/admin/', pass: true }, () => Promise.reject(new Error('404')), open);
    expect(tab.location.href).toBe('https://shop.example.com/admin/');
  });

  it('添えないアプリは、通行証を取らずに元の URL を開く', async () => {
    const { tab, open } = fakeWindow();
    const fetchPass = vi.fn();
    await openAppInNewTab({ url: 'https://example.com/app', pass: false }, fetchPass, open);
    expect(fetchPass).not.toHaveBeenCalled();
    expect(tab.location.href).toBe('https://example.com/app');
    expect(tab.opener).toBeNull();
  });

  it('★ http/https 以外は開かない', async () => {
    const { open } = fakeWindow();
    await openAppInNewTab({ url: 'javascript:alert(1)', pass: false }, vi.fn(), open);
    expect(open).not.toHaveBeenCalled();
  });

  it('ブラウザがタブを止めたら (null)、何もしない', async () => {
    const open = vi.fn(() => null);
    const fetchPass = vi.fn();
    await openAppInNewTab({ url: 'https://example.com/app', pass: true }, fetchPass, open);
    expect(fetchPass).not.toHaveBeenCalled();
  });
});
