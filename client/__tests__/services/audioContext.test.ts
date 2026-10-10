/**
 * #562 画面で 1 つの AudioContext。iPhone はタップの処理の中で作る / 動かし始めないと止まったまま (suspended)。
 * ★ 以前は録音・読み上げ・トランシーバーがそれぞれ await の後で new AudioContext() していた (= タップの外)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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

describe('new AudioContext は 1 か所だけ (#562)', () => {
  it('★ src の中で AudioContext を作っているのは services/audioContext.ts だけ', () => {
    const SRC = path.resolve(__dirname, '../../src');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const makers = walk(SRC).filter((f) => /new\s+(window\.)?(AudioContext|Ctx)\s*\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'));
    // ★ 例外: 会話モードの計器 (AI の声の立ち上がりを測る、#410 の基準)。閉じ方・測り方が別なので #562 では触らない
    //   (会話モードでも iPhone では同じく止まったままになりうる。#562 に記録)
    const ALLOWED = ['hooks/useRealtimeVoice.ts'];
    expect(makers.filter((m) => !ALLOWED.includes(m))).toEqual(['services/audioContext.ts']);
  });
});
