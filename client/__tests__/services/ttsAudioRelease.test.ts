/**
 * 読み上げの再生が終わったら、つないだ部品を外す (2026-10-29 改善ループ 23 回目)
 *
 * ★ 以前は再生ごとに createMediaElementSource + createGain をつなぎ、終わっても disconnect しなかった。
 *   MediaElementSource は audio 要素を掴むので、読み込んだ音声ごと画面を閉じるまで残った。
 *   ★ 次の読み上げで前の再生を止めたときは onEnded も呼ばれず、呼び出し側の blob URL が revoke されなかった。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Node = { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
const nodes: Node[] = [];
const mkNode = (): Node => { const n = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }; nodes.push(n); return n; };
vi.mock('../../src/services/audioContext', () => ({
  getSharedAudioContext: () => ({ createMediaElementSource: () => mkNode(), createGain: () => mkNode(), destination: {} }),
}));

class FakeAudio {
  listeners: Record<string, Array<() => void>> = {};
  src: string; volume = 1; currentTime = 0;
  constructor(src: string) { this.src = src; }
  play() { return Promise.resolve(); }
  pause() {}
  addEventListener(t: string, f: () => void) { (this.listeners[t] ??= []).push(f); }
  removeEventListener(t: string, f: () => void) { this.listeners[t] = (this.listeners[t] ?? []).filter((g) => g !== f); }
  removeAttribute() {}
  load() {}
  fire(t: string) { for (const f of [...(this.listeners[t] ?? [])]) f(); }
}
vi.stubGlobal('Audio', FakeAudio);

const { playTtsSrc, stopCurrentTts } = await import('../../src/services/ttsAudioPlayer');

describe('読み上げの部品の後片付け', () => {
  beforeEach(() => { nodes.length = 0; stopCurrentTts(); nodes.length = 0; });

  it('★ 最後まで鳴ったら、つないだ部品を外し、listener も外す', () => {
    const a = playTtsSrc('blob:1') as unknown as FakeAudio;
    a.fire('ended');
    expect(nodes).toHaveLength(2);
    for (const n of nodes) expect(n.disconnect).toHaveBeenCalled();
    expect(a.listeners.ended).toHaveLength(0);
  });

  it('★★ 次の読み上げで止められた方も、部品を外し onEnded を呼ぶ (呼び出し側が blob を revoke できる)', () => {
    const onEnded = vi.fn();
    playTtsSrc('blob:1', { onEnded });
    const first = [...nodes];
    playTtsSrc('blob:2');
    for (const n of first) expect(n.disconnect).toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('★ 停止ボタン (stopCurrentTts) でも同じ。onEnded は 1 回だけ', () => {
    const onEnded = vi.fn();
    const a = playTtsSrc('blob:1', { onEnded }) as unknown as FakeAudio;
    stopCurrentTts();
    a.fire('ended');
    for (const n of nodes) expect(n.disconnect).toHaveBeenCalled();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
