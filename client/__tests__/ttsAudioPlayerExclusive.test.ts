import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { playTtsSrc } from '../src/services/ttsAudioPlayer';
import { useTtsStore } from '../src/stores/ttsStore';
import { notifyAudioStarted, VOICE_STARTED } from '../src/utils/audioExclusive';

/**
 * #413 (#380 の宿題) 読み上げを同時再生の規約に乗せる。
 *
 * ★ これまで `ttsAudioPlayer` は **独自の `currentAudio` で 1 つに絞っていただけ**で、
 *   規約 (`voice:started`) には参加していなかった。だから
 *   **会話モードや音声メッセージと重なって鳴っていた**。
 *
 * ★★ 「掴んでいる間は始めない」(#413 の本体) は鳴らす側 (useSocketSync) の判断で、
 *   こちらは **鳴り出したものを止める / 自分が鳴ることを知らせる** 側を担当する。
 */
class FakeAudio {
  static last: FakeAudio | null = null;
  paused = false;
  currentTime = 0;
  volume = 1;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn(() => { this.paused = true; });
  addEventListener = vi.fn();
  src: string;
  // ★ パラメータプロパティは erasableSyntaxOnly で使えない (Node の型剥がしに合わせた設定)
  constructor(src: string) { this.src = src; FakeAudio.last = this; }
}

describe('ttsAudioPlayer — 同時再生の規約 (#413)', () => {
  const heard: string[] = [];
  const rec = (e: Event) => heard.push((e as CustomEvent<{ messageId?: string }>).detail?.messageId || '');

  beforeEach(() => {
    heard.length = 0;
    FakeAudio.last = null;
    vi.stubGlobal('Audio', FakeAudio);
    window.addEventListener(VOICE_STARTED, rec);
  });
  afterEach(() => {
    window.removeEventListener(VOICE_STARTED, rec);
    vi.unstubAllGlobals();
  });

  it('★ 再生を始めたら開始の合図を流す (音声メッセージの再生が止まる)', () => {
    playTtsSrc('blob:tts-1');
    expect(heard.some((id) => id.startsWith('tts:'))).toBe(true);
  });

  it('★★ 他の音声が始まったら止まる (会話を開いた瞬間に鳴っていた読み上げも止まる)', () => {
    playTtsSrc('blob:tts-1');
    const audio = FakeAudio.last!;

    notifyAudioStarted('voice-chat:s1');

    expect(audio.pause).toHaveBeenCalled();
    expect(useTtsStore.getState().isPlaying).toBe(false);
  });

  it('★ 自分の合図では止まらない (鳴り始めた瞬間に自分で自分を止めない)', () => {
    playTtsSrc('blob:tts-1');
    const audio = FakeAudio.last!;
    expect(audio.pause).not.toHaveBeenCalled();
    expect(useTtsStore.getState().isPlaying).toBe(true);
  });
});
