/**
 * #368 本体サーバの graceful shutdown。
 *
 * 実資源 (http server / socket.io / pool / timer) に触れずテストするため、
 * checkMigrations({ query, warn }) と同じ依存注入パターンで検証する。
 *
 * ★ 本 test の主眼は「何を呼ぶか」ではなく **どの順で呼ぶか**。
 *   予告 (notifyGateway) が接続切断より後になると、中継が先に消えて予告が届かない。
 *   順序が壊れても個々の関数は呼ばれるので、順序を固定しないと silent に壊れる。
 */
import { runShutdown, createSignalHandler } from '../../src/utils/shutdown.mts';
import type { ShutdownDeps } from '../../src/utils/shutdown.mts';

/** 呼ばれた順に label を積む deps を作る。上書きしたい項目だけ over で差し替える。 */
function makeDeps(over: Partial<ShutdownDeps> = {}): { deps: ShutdownDeps; calls: string[]; logs: string[]; warns: string[]; exits: number[] } {
  const calls: string[] = [];
  const logs: string[] = [];
  const warns: string[] = [];
  const exits: number[] = [];
  const deps: ShutdownDeps = {
    log: (m) => { logs.push(m); calls.push('log'); },
    warn: (m) => { warns.push(m); },
    notifyGateway: async () => { calls.push('notifyGateway'); },
    stopTimers: () => { calls.push('stopTimers'); },
    closeServer: () => { calls.push('closeServer'); },
    closeConnections: () => { calls.push('closeConnections'); },
    closeIo: () => { calls.push('closeIo'); },
    endPool: async () => { calls.push('endPool'); },
    sleep: async () => { calls.push('sleep'); },
    // ★ 上限時間は「絶対に来ない」を既定にする (正常系で timeout が勝たないように)
    deadline: () => new Promise<void>(() => { /* never */ }),
    exit: (c) => { exits.push(c); calls.push('exit'); },
    ...over,
  };
  return { deps, calls, logs, warns, exits };
}

describe('runShutdown — 手順と順序 (#368)', () => {
  test('定義した順に実行し、exit(0) で終わる', async () => {
    const { deps, calls, logs, exits } = makeDeps();
    await runShutdown(deps);

    expect(calls).toEqual([
      'log',              // Shutting down...
      'notifyGateway',    // ★ 中継が生きているうちに予告
      'sleep',            // 予告が proxy を通るまでの間
      'stopTimers',
      'closeServer',
      'closeConnections',
      'closeIo',
      'endPool',
      'sleep',            // winston の書き出し待ち
      'exit',
    ]);
    expect(logs[0]).toContain('Shutting down');
    expect(exits).toEqual([0]);
  });

  test('★ 予告は接続を切るより前に行う (後だと中継が消えて届かない)', async () => {
    const { deps, calls } = makeDeps();
    await runShutdown(deps);

    const notify = calls.indexOf('notifyGateway');
    expect(notify).toBeGreaterThanOrEqual(0);
    expect(notify).toBeLessThan(calls.indexOf('closeServer'));
    expect(notify).toBeLessThan(calls.indexOf('closeConnections'));
    expect(notify).toBeLessThan(calls.indexOf('closeIo'));
  });

  test('途中の失敗で以降を止めない (1 つ壊れても後始末は最後まで進む)', async () => {
    const { deps, calls, warns, exits } = makeDeps({
      // 実際に起きうる: closeIo は closeServer 後だと ERR_SERVER_NOT_RUNNING を投げうる
      closeIo: () => { throw new Error('ERR_SERVER_NOT_RUNNING'); },
      stopTimers: () => { throw new Error('timer boom'); },
    });
    await runShutdown(deps);

    // 壊れた 2 つの後ろにある手順が実行されている
    expect(calls).toContain('closeConnections');
    expect(calls).toContain('endPool');
    expect(exits).toEqual([0]);
    expect(warns.join('\n')).toContain('timer boom');
    expect(warns.join('\n')).toContain('ERR_SERVER_NOT_RUNNING');
  });

  test('予告が失敗しても停止は続行する (agent-server が落ちている場合)', async () => {
    const { deps, calls, warns, exits } = makeDeps({
      notifyGateway: async () => { throw new Error('ECONNREFUSED'); },
    });
    await runShutdown(deps);

    expect(calls).toContain('closeServer');
    expect(exits).toEqual([0]);
    expect(warns.join('\n')).toContain('ECONNREFUSED');
  });

  test('★ 返らない後始末があっても上限時間で必ず exit する', async () => {
    const { deps, warns, exits } = makeDeps({
      endPool: () => new Promise<void>(() => { /* 永久に返らない */ }),
      deadline: async () => { /* 即座に上限へ */ },
    });
    await runShutdown(deps);

    expect(exits).toEqual([0]);
    expect(warns.join('\n')).toMatch(/上限|timeout/i);
  });

  test('上限で exit した後に本体が完了しても exit は 1 回だけ', async () => {
    let release: (() => void) | undefined;
    const { deps, exits } = makeDeps({
      endPool: () => new Promise<void>((r) => { release = r; }),
      deadline: async () => { /* 即座に上限へ */ },
    });
    await runShutdown(deps);
    expect(exits).toEqual([0]);

    release?.();                          // 遅れて本体が完了する
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([0]);           // 2 回目は呼ばれない
  });
});

describe('createSignalHandler — 2 回目の signal (#368)', () => {
  test('1 回目は停止処理を始める', async () => {
    const { deps, calls } = makeDeps();
    const onSignal = createSignalHandler(deps);
    onSignal();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toContain('notifyGateway');
  });

  test('★ 2 回目は待たずに exit(1) する (止まらないときに押し直せる)', async () => {
    const { deps, exits } = makeDeps({
      endPool: () => new Promise<void>(() => { /* 止まったまま */ }),
    });
    const onSignal = createSignalHandler(deps);
    onSignal();
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([]);            // まだ停止処理の途中

    onSignal();                            // 押し直し
    expect(exits).toEqual([1]);
  });
});
