/**
 * 2026-11-23 小野さん「トークが開かれていても操作がされていないものには未読をつける」
 * (マルチ画面のとき・複数の端末で使っているとき)
 *
 * 使っている = 画面に出ている かつ 窓が選ばれている かつ 最後の操作から 3 分以内
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const emb = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/utils/embedded', () => ({ isEmbeddedInSameApp: () => emb.on }));
import { isAttending, onAttentionChange, noteInput, IDLE_MS, PANEL_IDLE_MS } from '../../src/services/attention';

let visibility: DocumentVisibilityState = 'visible';
let focus = true;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focus);
  visibility = 'visible';
  focus = true;
  emb.on = false;
  noteInput(Date.now());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isAttending', () => {
  it('画面に出ていて、窓が選ばれていて、さっき触った → 使っている', () => {
    expect(isAttending()).toBe(true);
  });

  it('★ 画面が裏 (#474 と同じ) → 使っていない', () => {
    visibility = 'hidden';
    expect(isAttending()).toBe(false);
  });

  it('★★ 画面に出ていても、窓が選ばれていない (2 枚目の画面に出しっぱなし・別の窓で作業中) → 使っていない', () => {
    focus = false;
    expect(isAttending()).toBe(false);
  });

  it('★★ 選ばれていても、3 分触っていない → 使っていない', () => {
    const t = Date.now();
    expect(isAttending(t + IDLE_MS - 1)).toBe(true);
    expect(isAttending(t + IDLE_MS)).toBe(false);
  });

  it('3 分は 180 秒 (小野さんと決めた数)', () => {
    expect(IDLE_MS).toBe(180_000);
  });
});

describe('onAttentionChange', () => {
  it('★★ 触らずに 3 分経つと「使っていない」を知らせる', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    vi.advanceTimersByTime(IDLE_MS - 1000);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenLastCalledWith(false);
    stop();
  });

  it('★★ 途中で触れば 3 分は数え直し', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    vi.advanceTimersByTime(IDLE_MS - 10_000);
    document.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(20_000);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_MS);
    expect(cb).toHaveBeenLastCalledWith(false);
    stop();
  });

  it('★★ 使っていない間に触ったら、すぐ「使っている」を知らせる', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    vi.advanceTimersByTime(IDLE_MS);
    expect(cb).toHaveBeenLastCalledWith(false);
    document.dispatchEvent(new Event('pointerdown'));
    expect(cb).toHaveBeenLastCalledWith(true);
    stop();
  });

  it('★★ 窓を離れたら「使っていない」、戻ったら「使っている」', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    focus = false;
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(0);
    expect(cb).toHaveBeenLastCalledWith(false);
    focus = true;
    window.dispatchEvent(new Event('focus'));
    expect(cb).toHaveBeenLastCalledWith(true);
    stop();
  });

  it('★ 親の窓の blur でも、選択が中に残っていれば (iframe へ移っただけ) 何も知らせない', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    window.dispatchEvent(new Event('blur'));   // focus は true のまま
    vi.advanceTimersByTime(0);
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it('★ 裏に回ったら「使っていない」(今までの #474 の動き)', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cb).toHaveBeenLastCalledWith(false);
    stop();
  });

  it('★★ スクロールは操作に数えない (新着でいちばん下へ合わせると、それで「使っている」に戻ってしまう)', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    vi.advanceTimersByTime(IDLE_MS);
    document.dispatchEvent(new Event('scroll'));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(false);
    stop();
  });

  it('★ 時計が戻っても (時刻合わせ)、操作をすぐ知らせる', () => {
    const start = Date.now();   // 最後に知らせた時刻 (beforeEach の noteInput)
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    vi.advanceTimersByTime(IDLE_MS);
    expect(cb).toHaveBeenLastCalledWith(false);
    vi.setSystemTime(start - 60_000);   // 最後に知らせた時刻より前へ戻る
    document.dispatchEvent(new Event('pointerdown'));
    expect(cb).toHaveBeenLastCalledWith(true);
    stop();
  });

  it('止めたあとは知らせない (窓の切り替えの判定待ちも捨てる)', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    focus = false;
    window.dispatchEvent(new Event('blur'));
    stop();
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(cb).not.toHaveBeenCalled();
  });
});

/**
 * 2026-11-23 小野さん「マルチトークに出ているものが未読にならないとまずくない?」「1分でいこう」
 * 窓ごとにまとめて判定すると、隣のパネルで書いている間、横に出ている部屋が読んでいなくても既読になった。
 * パネルは「そのパネルを最後に触ってから 1 分」で判定する
 */
describe('マルチトークのパネル (同じ Tealus の中の iframe)', () => {
  beforeEach(() => {
    emb.on = true;
    noteInput(Date.now());
  });

  it('パネルは 1 分 (小野さんと決めた数)', () => {
    expect(PANEL_IDLE_MS).toBe(60_000);
  });

  it('★★ パネルは、そのパネルを触ってから 1 分で「使っていない」(3 分を待たない)', () => {
    const t = Date.now();
    expect(isAttending(t + PANEL_IDLE_MS - 1)).toBe(true);
    expect(isAttending(t + PANEL_IDLE_MS)).toBe(false);
  });

  it('★★ 触らずに 1 分経つと「使っていない」を知らせ、パネルの上でマウスを動かすと「使っている」に戻る', () => {
    const cb = vi.fn();
    const stop = onAttentionChange(cb);
    vi.advanceTimersByTime(PANEL_IDLE_MS - 1000);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenLastCalledWith(false);
    document.dispatchEvent(new Event('pointermove'));
    expect(cb).toHaveBeenLastCalledWith(true);
    stop();
  });

  it('★ 窓が選ばれていなければ、触ったばかりのパネルも「使っていない」', () => {
    focus = false;
    expect(isAttending()).toBe(false);
  });
});
