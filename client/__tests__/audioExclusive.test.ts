import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VOICE_STARTED, VOICE_STOP_CONTINUOUS,
  notifyAudioStarted, notifyAudioStopped, subscribeAudioStarted,
} from '../src/utils/audioExclusive';

/**
 * #380: 同時再生の抑制は「再生バーの機能」ではなく **window に流れる合図の規約**。
 *
 * ★ 規約は VoiceBubble が持っていたものをそのまま使う (新しい名前を作らない):
 *   - `voice:started` {messageId} … 再生開始。他は止まる + Wake Lock 取得
 *   - `voice:stop-continuous`     … 連続再生の終了 = Wake Lock 解放
 *
 * これに標準の <audio> も参加させれば、部品を統一しなくても協調する。
 */
describe('audioExclusive — 合図の規約 (#380)', () => {
  const seen: Array<{ type: string; id?: string }> = [];
  const rec = (e: Event) => seen.push({
    type: e.type,
    id: (e as CustomEvent<{ messageId?: string }>).detail?.messageId,
  });

  beforeEach(() => {
    seen.length = 0;
    window.addEventListener(VOICE_STARTED, rec);
    window.addEventListener(VOICE_STOP_CONTINUOUS, rec);
  });
  afterEach(() => {
    window.removeEventListener(VOICE_STARTED, rec);
    window.removeEventListener(VOICE_STOP_CONTINUOUS, rec);
  });

  it('★ 既存の規約と同じ名前・同じ形で投げる (VoiceBubble が聞き取れること)', () => {
    notifyAudioStarted('media-1');
    expect(seen).toEqual([{ type: 'voice:started', id: 'media-1' }]);
  });

  it('停止の合図は detail 無しの voice:stop-continuous', () => {
    notifyAudioStopped();
    expect(seen).toEqual([{ type: 'voice:stop-continuous', id: undefined }]);
  });

  it('★ 自分以外が始まったら通知が来る', () => {
    const onOther = vi.fn();
    const off = subscribeAudioStarted('me', onOther);
    notifyAudioStarted('other');
    expect(onOther).toHaveBeenCalledTimes(1);
    off();
  });

  it('★ 自分が始めた合図では自分を止めない', () => {
    const onOther = vi.fn();
    const off = subscribeAudioStarted('me', onOther);
    notifyAudioStarted('me');
    expect(onOther).not.toHaveBeenCalled();
    off();
  });

  it('解除したら以後は反応しない (購読の後始末)', () => {
    const onOther = vi.fn();
    subscribeAudioStarted('me', onOther)();
    notifyAudioStarted('other');
    expect(onOther).not.toHaveBeenCalled();
  });

  /**
   * ★★★ 罠: 他が再生を始めて自分が止められたとき、pause を素朴に通知すると
   * `voice:stop-continuous` が飛び、**直前に相手が取った Wake Lock を解放してしまう**
   * (useVoiceContinuousPlay が voice:started で取得し stop-continuous で解放するため)。
   * 「自分の意思で止めた」ときだけ通知する、が要件。
   */
  it('★★★ 他に止められた場合は stop-continuous を投げない (相手の Wake Lock を消さない)', () => {
    let pausedByOther = false;
    const off = subscribeAudioStarted('me', () => { pausedByOther = true; });
    notifyAudioStarted('other');           // 相手が開始 → 自分は止められる
    if (!pausedByOther) notifyAudioStopped();
    off();

    expect(seen.map((s) => s.type)).toEqual(['voice:started']);   // stop-continuous は無い
  });
});
