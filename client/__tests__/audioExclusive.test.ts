import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VOICE_STARTED, VOICE_STOP_CONTINUOUS,
  notifyAudioStarted, notifyAudioStopped, subscribeAudioStarted,
  requestAudioSeek, subscribeAudioSeek,
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

/**
 * ★ シーク要求 (2026-08-29)。通話履歴の時刻タグから再生位置を動かすために足した。
 *
 * ★ 「再生バーの機能」ではなく **規約に 1 つイベントを増やす** 形にしてある。
 *   再生バーの実装は 標準 <audio controls> と 手作り の 2 系統あり、#380 で
 *   「規約に参加させる」ことで 2 か所に配線を複製する問題を解いた。同じ形に乗せる。
 */
describe('シーク要求', () => {
  it('自分宛の絶対シークを受け取る', () => {
    const got: unknown[] = [];
    const off = subscribeAudioSeek('a', (r) => got.push(r));
    requestAudioSeek('a', { to: 62 });
    off();
    expect(got).toEqual([{ to: 62 }]);
  });

  it('★ 他人宛は受け取らない (1 メッセージに音声が 2 つ付く場合がある)', () => {
    const got: unknown[] = [];
    const off = subscribeAudioSeek('a', (r) => got.push(r));
    requestAudioSeek('b', { to: 10 });
    off();
    expect(got).toEqual([]);
  });

  it('相対シーク (10 秒送り / 戻し) も同じ経路で渡す', () => {
    const got: unknown[] = [];
    const off = subscribeAudioSeek('a', (r) => got.push(r));
    requestAudioSeek('a', { by: -10 });
    requestAudioSeek('a', { by: 10 });
    off();
    expect(got).toEqual([{ by: -10 }, { by: 10 }]);
  });

  it('購読解除したら届かない', () => {
    const got: unknown[] = [];
    const off = subscribeAudioSeek('a', (r) => got.push(r));
    off();
    requestAudioSeek('a', { to: 1 });
    expect(got).toEqual([]);
  });
});
