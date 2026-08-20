import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useExclusiveAudio } from '../src/hooks/useExclusiveAudio';
import { VOICE_STARTED, VOICE_STOP_CONTINUOUS, notifyAudioStarted } from '../src/utils/audioExclusive';

/**
 * #380: 標準の <audio controls> を 同時再生抑制の規約に参加させる React 側の接続。
 *
 * ★ 肝は「なぜ止まったか」の区別。他に止められた pause で `voice:stop-continuous` を
 *   投げると、**直前に相手が取った Wake Lock を解放**してしまう。
 */
describe('useExclusiveAudio (#380)', () => {
  const seen: string[] = [];
  const rec = (e: Event) => seen.push(e.type);

  beforeEach(() => {
    seen.length = 0;
    window.addEventListener(VOICE_STARTED, rec);
    window.addEventListener(VOICE_STOP_CONTINUOUS, rec);
  });
  afterEach(() => {
    window.removeEventListener(VOICE_STARTED, rec);
    window.removeEventListener(VOICE_STOP_CONTINUOUS, rec);
  });

  /** ref に挿す最小の audio 代役 (jsdom の play() は未実装なので本物は使わない) */
  function attachFakeAudio(result: { current: ReturnType<typeof useExclusiveAudio> }) {
    const pause = vi.fn();
    (result.current.ref as { current: unknown }).current = { pause };
    return pause;
  }

  it('★ 再生開始で voice:started を投げる', () => {
    const { result } = renderHook(() => useExclusiveAudio('m1'));
    act(() => result.current.onPlay());
    expect(seen).toEqual([VOICE_STARTED]);
  });

  it('★ 自分の意思で止めたら voice:stop-continuous を投げる', () => {
    const { result } = renderHook(() => useExclusiveAudio('m1'));
    act(() => result.current.onPlay());
    act(() => result.current.onPause());
    expect(seen).toEqual([VOICE_STARTED, VOICE_STOP_CONTINUOUS]);
  });

  it('★ 他が再生を始めたら自分の audio を pause する', () => {
    const { result } = renderHook(() => useExclusiveAudio('m1'));
    const pause = attachFakeAudio(result);
    act(() => notifyAudioStarted('other'));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('★★★ 他に止められた直後の pause では stop-continuous を投げない', () => {
    const { result } = renderHook(() => useExclusiveAudio('m1'));
    attachFakeAudio(result);
    act(() => result.current.onPlay());
    seen.length = 0;

    act(() => notifyAudioStarted('other'));   // 相手が開始 → こちらは止められる
    act(() => result.current.onPause());      // ブラウザが発火させる pause

    expect(seen).toEqual([VOICE_STARTED]);    // ★ 相手の started だけ。stop-continuous は無い
  });

  it('★ 止められた後、次に自分で再生して止めたときは通知が戻る (一度きりの抑止)', () => {
    const { result } = renderHook(() => useExclusiveAudio('m1'));
    attachFakeAudio(result);
    act(() => notifyAudioStarted('other'));
    act(() => result.current.onPause());      // 抑止される
    seen.length = 0;

    act(() => result.current.onPlay());
    act(() => result.current.onPause());
    expect(seen).toEqual([VOICE_STARTED, VOICE_STOP_CONTINUOUS]);
  });

  it('自分が投げた started で自分を pause しない', () => {
    const { result } = renderHook(() => useExclusiveAudio('m1'));
    const pause = attachFakeAudio(result);
    act(() => result.current.onPlay());
    expect(pause).not.toHaveBeenCalled();
  });

  it('unmount で購読を解除する', () => {
    const { result, unmount } = renderHook(() => useExclusiveAudio('m1'));
    const pause = attachFakeAudio(result);
    unmount();
    act(() => notifyAudioStarted('other'));
    expect(pause).not.toHaveBeenCalled();
  });
});
