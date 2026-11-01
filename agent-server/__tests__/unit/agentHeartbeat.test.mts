/**
 * agent-server の鼓動 (docs/09 §3.2、2026-11-01 改善ループ 33〜35 の承認 1)
 *
 * ★ 10-31 に agent-server は生きていたが tealus の道具がつながらず、AI が 28 分答えられなかった。
 *   本体から見ると webhook は届いていたので、何も鳴らなかった。気づいたのは人が @アシスタント を送ったとき
 * ここで固定する:
 *   1. 1 分ごとに { name: 'agent-server', info } を本体へ送る (止まれば、本体の見張りが「来ていない」を拾う)
 *   2. 共有の tealus の道具が欠けていれば info.problem に一文を入れる (見張りが「動いてはいますが…」を出す)
 *   3. 何回呼んでも 1 本だけ (ログインの試し直しで initializeAgent が何度も走る)
 *   4. 送れなくても落ちない (本体が再起動中など)
 */
let tealusProblem: string | null = null;
jest.mock('../../src/mcp/roomMcpManager.mts', () => ({
  sharedTealusProblem: () => tealusProblem,
}));
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

import { agentHeartbeatInfo, startAgentHeartbeat, stopAgentHeartbeat } from '../../src/setup/agentHeartbeat.mts';

beforeEach(() => { tealusProblem = null; jest.useFakeTimers(); });
afterEach(() => { stopAgentHeartbeat(); jest.useRealTimers(); });

describe('agentHeartbeatInfo', () => {
  test('道具がそろっていれば problem を入れない', () => {
    expect(agentHeartbeatInfo()).toEqual({});
  });

  test('★ 共有の tealus が欠けていれば problem に一文', () => {
    tealusProblem = '会話モードの tealus の道具がつながっていません';
    expect(agentHeartbeatInfo()).toEqual({ problem: '会話モードの tealus の道具がつながっていません' });
  });
});

describe('startAgentHeartbeat', () => {
  test('★ すぐ 1 回送り、そのあと 1 分ごとに送る', async () => {
    const send = jest.fn(async () => {});
    startAgentHeartbeat(send, 60_000);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('agent-server', {});
    jest.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('★ 何回呼んでも 1 本だけ', () => {
    const send = jest.fn(async () => {});
    startAgentHeartbeat(send, 60_000);
    startAgentHeartbeat(send, 60_000);
    jest.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('★ 送るたびに今の状態を入れる (欠けたら次の鼓動から problem が付く)', () => {
    const send = jest.fn(async () => {});
    startAgentHeartbeat(send, 60_000);
    tealusProblem = 'x';
    jest.advanceTimersByTime(60_000);
    expect(send).toHaveBeenLastCalledWith('agent-server', { problem: 'x' });
  });

  test('送れなくても落ちない', async () => {
    const send = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    startAgentHeartbeat(send, 60_000);
    await Promise.resolve();
    expect(() => jest.advanceTimersByTime(60_000)).not.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
