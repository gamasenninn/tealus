/**
 * トランシーバーの返事待ち (改善ループ 65、#649 A-3)
 *
 * ★ 以前は時間切れが無く、rtc-server が返事をしないと「接続中」のまま止まり、
 *   接続ボタンも idle / error からしか効かないので、やり直しもできなかった
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForSignal, type SignalHandler } from '../../src/utils/transceiverSignal';

type Msg = { type: string };

afterEach(() => { vi.useRealTimers(); });

describe('waitForSignal', () => {
  it('合う返事が来たら、その便で解決し、待ち手を外す', async () => {
    const handlers: SignalHandler<Msg>[] = [];
    const p = waitForSignal<Msg>(handlers, (m) => m.type === 'joined', 1000);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]({ type: 'other' })).toBe(false);
    expect(handlers[0]({ type: 'joined' })).toBe(true);
    await expect(p).resolves.toEqual({ type: 'joined' });
    expect(handlers).toHaveLength(0);
  });

  it('★ 時間までに来なければ失敗にし、待ち手を外す (「接続中」のまま止まらない)', async () => {
    vi.useFakeTimers();
    const handlers: SignalHandler<Msg>[] = [];
    const p = waitForSignal<Msg>(handlers, (m) => m.type === 'joined', 1000);
    const caught = p.catch((e: Error) => e.message);
    vi.advanceTimersByTime(1000);
    expect(await caught).toMatch(/応答/);
    expect(handlers).toHaveLength(0);
  });

  it('解決したあとに時間が来ても、何も起きない', async () => {
    vi.useFakeTimers();
    const handlers: SignalHandler<Msg>[] = [];
    const p = waitForSignal<Msg>(handlers, (m) => m.type === 'joined', 1000);
    handlers[0]({ type: 'joined' });
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toEqual({ type: 'joined' });
  });
});
