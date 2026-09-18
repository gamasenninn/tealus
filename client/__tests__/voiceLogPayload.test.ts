import { describe, it, expect } from 'vitest';
import { trimEventsForKeepalive, KEEPALIVE_MAX_BYTES } from '../src/services/voiceLogPayload';

/**
 * ★★★★★ なぜ要るか (2026-09-18)
 *
 * 会話モードでいちばん困っているのは **「返ってこない回」** (利用者の言葉)。★ ところが計測の記録は
 * `stop()` / 切断検知 / 自動で閉じたとき **の 3 つでしか飛ばない**。
 * ★★ **固まってリロードした回は、記録が 1 件も残らない** —— ★★★ いちばん困った回ほど証拠が無い。
 *
 * ★ 離脱中は `fetch` が届かないので `keepalive` で送る。★★ ただし **64KB 上限**がある。
 *   ★★★ 実測: いまの最大 1 便が **54,098 バイト**。★★★★ **もう上限に近い。**
 *
 * → ★ 溢れたら **古い方から捨てる**。★★ 固まった瞬間は **末尾**にあるので、末尾を守る。
 * → ★★★ 捨てたら **件数を残す** (黙って捨てると「短い会話だった」と読める)。
 */

const ev = (i: number, pad = '') => ({ t: i * 100, type: 'ptt_release', data: { i, pad } });

describe('#423/#432 離脱時に送る記録の詰め方', () => {
  it('★ 上限に収まるならそのまま。★★ 1 件も捨てない', () => {
    const events = [ev(1), ev(2), ev(3)];
    const r = trimEventsForKeepalive('s1', events);
    expect(r.events).toEqual(events);
    expect(r.dropped).toBe(0);
    expect(r.bytes).toBeLessThan(KEEPALIVE_MAX_BYTES);
  });

  it('★★★★ 溢れたら **古い方から** 捨てる (★ 末尾を守る)', () => {
    const big = Array.from({ length: 400 }, (_, i) => ev(i, 'x'.repeat(400)));
    const r = trimEventsForKeepalive('s1', big);
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.bytes).toBeLessThanOrEqual(KEEPALIVE_MAX_BYTES);
    // ★ 残ったものの最後は、元の最後と同じであること
    expect(r.events[r.events.length - 1]).toEqual(big[big.length - 1]);
    // ★★ 先頭は捨てられているので、元の先頭とは違う
    expect(r.events[0]).not.toEqual(big[0]);
    expect(r.dropped + r.events.length).toBe(big.length);
  });

  it('★ 1 件でも上限を超えるなら、その 1 件だけを送る (★★ 捨て切らない)', () => {
    const huge = [ev(1, 'y'.repeat(KEEPALIVE_MAX_BYTES * 2))];
    const r = trimEventsForKeepalive('s1', huge);
    expect(r.events).toHaveLength(1);
    expect(r.dropped).toBe(0);
    // ★ 収まらないことは隠さない (呼び出し側が判断できるよう bytes を返す)
    expect(r.bytes).toBeGreaterThan(KEEPALIVE_MAX_BYTES);
  });

  it('★ 空なら空のまま (★★ 例外にしない)', () => {
    const r = trimEventsForKeepalive('s1', []);
    expect(r.events).toEqual([]);
    expect(r.dropped).toBe(0);
  });

  it('★★ session_id の長さも勘定に入れる (★ 本文だけで測らない)', () => {
    const events = Array.from({ length: 200 }, (_, i) => ev(i, 'z'.repeat(400)));
    const short = trimEventsForKeepalive('s', events);
    const long = trimEventsForKeepalive('s'.repeat(2000), events);
    // ★ 長い session_id のぶんだけ、載る件数は減るか同じ
    expect(long.events.length).toBeLessThanOrEqual(short.events.length);
  });

  it('★★★ 捨てた件数は 呼び出し側に返す (★ 黙って減らさない)', () => {
    const big = Array.from({ length: 400 }, (_, i) => ev(i, 'w'.repeat(400)));
    const r = trimEventsForKeepalive('s1', big);
    expect(r.dropped).toBe(big.length - r.events.length);
    expect(r.dropped).toBeGreaterThan(0);
  });
});
