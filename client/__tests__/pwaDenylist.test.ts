/**
 * Service Worker が横取りしない URL (navigateFallbackDenylist) (2026-09-26)
 *
 * ★ なぜ: `/system` (最後のスラッシュ無し) で管理ダッシュボードを開くと、本体アプリのホームに戻された。
 *   サーバは 301 で /system/ に送る (#247) のに、SW の一覧が `/^\/system\//` (スラッシュ付き) だけだったため、
 *   SW が横取りして本体アプリの index.html を返し、React Router が / に飛ばしていた。
 */
import { describe, test, expect } from 'vitest';
// @ts-expect-error — 設定ファイル (vite.config.js) と共有する素の .mjs
import { NAVIGATE_FALLBACK_DENYLIST } from '../pwaDenylist.mjs';

const denied = (url: string) => (NAVIGATE_FALLBACK_DENYLIST as RegExp[]).some((re) => re.test(url));

describe('navigateFallbackDenylist', () => {
  test('★ /system (スラッシュ無し) も横取りしない', () => {
    expect(denied('/system')).toBe(true);
  });

  test('/system/ と /system/rooms/xxx も横取りしない', () => {
    expect(denied('/system/')).toBe(true);
    expect(denied('/system/rooms/abc')).toBe(true);
  });

  test('★ /systems や /system-foo のような別のページは巻き込まない', () => {
    expect(denied('/systems')).toBe(false);
    expect(denied('/system-foo')).toBe(false);
  });

  test('本体アプリのページは横取りしてよい (SW の index.html で動く)', () => {
    expect(denied('/')).toBe(false);
    expect(denied('/rooms/abc')).toBe(false);
    expect(denied('/talk')).toBe(false);
  });

  test('既存の対象 (media / api / agent-api / rtc / mcp) はそのまま', () => {
    for (const u of ['/media/x', '/api/x', '/agent-api/x', '/rtc/x', '/mcp/x']) expect(denied(u)).toBe(true);
  });
});
