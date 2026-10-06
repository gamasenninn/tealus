/**
 * #509 親が同じ Tealus のパネルの中かを見分ける
 */
import { describe, it, expect } from 'vitest';
import { isEmbeddedInSameApp } from '../src/utils/embedded';

describe('isEmbeddedInSameApp (#509)', () => {
  const self = { location: { origin: 'https://app.example' } };

  it('埋め込まれていなければ false', () => {
    const w = { ...self } as { top?: unknown; location: { origin: string } };
    w.top = w;
    expect(isEmbeddedInSameApp(w as never)).toBe(false);
  });

  it('★ 親が同じオリジン (マルチトークのパネル) なら true', () => {
    const w = { ...self, top: { location: { origin: 'https://app.example' } } };
    expect(isEmbeddedInSameApp(w as never)).toBe(true);
  });

  it('★ 親が別のサイトなら false (よそに埋め込まれた Tealus の通知は止めない)', () => {
    const w = { ...self, top: { location: { origin: 'https://other.example' } } };
    expect(isEmbeddedInSameApp(w as never)).toBe(false);
  });

  it('親のオリジンが読めない (別サイトで読むと例外) なら false', () => {
    const top = {};
    Object.defineProperty(top, 'location', { get: () => { throw new Error('SecurityError'); } });
    expect(isEmbeddedInSameApp({ ...self, top } as never)).toBe(false);
  });
});

