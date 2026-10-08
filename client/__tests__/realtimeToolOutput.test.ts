import { describe, it, expect, vi } from 'vitest';
import { deliverToolOutput } from '../src/utils/realtimeToolOutput';

/**
 * #432 会話モードが「調べています…」で固まった (2026-10-09 00:09 KAIROS で再現)。
 *
 * ★ 道具の結果をデータチャネルで送る send が、大きすぎて例外を出した (68,444 バイト > 64KB)。
 *   例外で処理が止まり、道具の数を減らす所まで届かなかった (記録に tool_count end が無い)。
 * → 送るのに失敗しても、短い「渡せなかった」を代わりに送り、結果を呼び出し側に返す。
 *   ★★ この関数は例外を外に出さない (呼び出し側が必ず数を減らせるように)。
 */
describe('deliverToolOutput', () => {
  it('送れたら ok と送った大きさを返す', () => {
    const send = vi.fn();
    const r = deliverToolOutput(send, 'call_1', '結果');
    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(new TextEncoder().encode(JSON.stringify({
      type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'call_1', output: '結果' },
    })).length);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'call_1', output: '結果' } });
  });

  it('★ 送るのに失敗したら、短い「渡せなかった」を同じ call_id で送り直す', () => {
    const send = vi.fn()
      .mockImplementationOnce(() => { throw new TypeError('RTCDataChannel send queue is full'); })
      .mockImplementationOnce(() => {});
    const r = deliverToolOutput(send, 'call_2', 'あ'.repeat(70000));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('send queue');
    expect(r.fallbackSent).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const retry = send.mock.calls[1][0] as { item: { call_id: string; output: string } };
    expect(retry.item.call_id).toBe('call_2');
    expect(retry.item.output).toContain('渡せませんでした');
    expect(retry.item.output.length).toBeLessThan(500);
  });

  it('★★ 送り直しも失敗しても、例外を外に出さない', () => {
    const send = vi.fn(() => { throw new Error('closed'); });
    let r: ReturnType<typeof deliverToolOutput> | undefined;
    expect(() => { r = deliverToolOutput(send, 'call_3', 'x'); }).not.toThrow();
    expect(r!.ok).toBe(false);
    expect(r!.fallbackSent).toBe(false);
  });
});
