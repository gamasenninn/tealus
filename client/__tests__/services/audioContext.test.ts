/**
 * #562 画面で 1 つの AudioContext。iPhone はタップの処理の中で作る / 動かし始めないと止まったまま (suspended)。
 * ★ 以前は録音・読み上げ・トランシーバーがそれぞれ await の後で new AudioContext() していた (= タップの外)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeCtx { state = 'suspended'; resume = vi.fn(async () => { this.state = 'running'; }); }

describe('audioContext (#562)', () => {
  beforeEach(() => { vi.resetModules(); (window as unknown as { AudioContext: unknown }).AudioContext = vi.fn(() => new FakeCtx()); });

  it('★ unlockAudio はタップの中で 1 つ作って動かし始め、以後は同じものを返す', async () => {
    const { unlockAudio, getSharedAudioContext } = await import('../../src/services/audioContext');
    unlockAudio();
    const a = getSharedAudioContext() as unknown as FakeCtx;
    expect(a.resume).toHaveBeenCalled();
    expect(getSharedAudioContext()).toBe(a);
    expect(window.AudioContext).toHaveBeenCalledTimes(1);
  });

  it('AudioContext が無い環境では null (落ちない)', async () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = undefined;
    const { unlockAudio, getSharedAudioContext } = await import('../../src/services/audioContext');
    expect(() => unlockAudio()).not.toThrow();
    expect(getSharedAudioContext()).toBeNull();
  });
});

// ★ ソースは Vite の import.meta.glob (?raw) で文字として読む。画面の型検査は Node の型を持たないので node:fs を使わない
//   (10-10 に node:fs で書いて CI の型検査を落とした。#544 と同じ)
const SOURCES = import.meta.glob('../../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('new AudioContext は 1 か所だけ (#562)', () => {
  it('★ src の中で AudioContext を作っているのは services/audioContext.ts だけ', () => {
    const makers = Object.entries(SOURCES)
      .filter(([, src]) => /new\s+(window\.)?(AudioContext|Ctx)\s*\(/.test(src))
      .map(([f]) => f.replace('../../src/', ''));
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);   // ★ 0 件で空振りしていないこと
    // ★ 例外: 会話モードの計器 (AI の声の立ち上がりを測る、#410 の基準)。閉じ方・測り方が別なので #562 では触らない
    //   (会話モードでも iPhone では同じく止まったままになりうる。#562 に記録)
    const ALLOWED = ['hooks/useRealtimeVoice.ts'];
    expect(makers.filter((m) => !ALLOWED.includes(m))).toEqual(['services/audioContext.ts']);
  });
});
