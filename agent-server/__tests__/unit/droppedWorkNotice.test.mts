/**
 * 停止で捨てる仕事の知らせ (改善ループ 45、2026-11-12)
 * ★ 部屋ごとの仕事の列はメモリの中だけにあり、停止すると黙って消えていた
 *   (11-05 18:40 に走り 1 + 待ち 6。ログにも部屋にも痕跡なし)
 */
jest.mock('dotenv', () => ({ config: jest.fn() }));

import { noticeDroppedWork, droppedWorkText } from '../../src/webhook/droppedWorkNotice.mts';

function makeDeps() {
  return {
    pushStatus: jest.fn().mockResolvedValue(undefined),
    pushMessage: jest.fn().mockResolvedValue({}),
    log: jest.fn(),
  };
}

describe('noticeDroppedWork', () => {
  test('仕事の残っている部屋ごとに、考え中を消して 1 回だけ知らせ、ログに数を残す', async () => {
    const deps = makeDeps();
    await noticeDroppedWork([{ roomId: 'r1', count: 7 }, { roomId: 'r2', count: 1 }], deps, 1000);

    expect(deps.pushStatus).toHaveBeenCalledTimes(2);
    expect(deps.pushStatus).toHaveBeenCalledWith('r1', 'idle');
    expect(deps.pushStatus).toHaveBeenCalledWith('r2', 'idle');
    expect(deps.pushMessage).toHaveBeenCalledTimes(2);
    expect(deps.pushMessage).toHaveBeenCalledWith('r1', droppedWorkText(7));
    expect(deps.pushMessage).toHaveBeenCalledWith('r2', droppedWorkText(1));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('8 件'));
  });

  test('残っている仕事が無ければ何もしない', async () => {
    const deps = makeDeps();
    await noticeDroppedWork([], deps, 1000);
    expect(deps.pushStatus).not.toHaveBeenCalled();
    expect(deps.pushMessage).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });

  test('知らせに失敗しても投げない (停止処理を止めない)', async () => {
    const deps = makeDeps();
    deps.pushMessage.mockRejectedValue(new Error('本体が止まっている'));
    await expect(noticeDroppedWork([{ roomId: 'r1', count: 2 }], deps, 1000)).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('2 件'));
  });

  test('本体が応えなくても上限の時間で戻る (停止が止まらない)', async () => {
    const deps = makeDeps();
    deps.pushMessage.mockImplementation(() => new Promise(() => {}));
    const t0 = Date.now();
    await noticeDroppedWork([{ roomId: 'r1', count: 1 }], deps, 50);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test('知らせの文に件数と、もう一度送ってほしいことが入る', () => {
    expect(droppedWorkText(3)).toContain('3 件');
    expect(droppedWorkText(3)).toContain('もう一度');
  });
});

describe('予告なしに止まったときの知らせ (改善ループ 49)', () => {
  test('★ unplannedSince を渡すと、予告なしの文で知らせる', async () => {
    const deps = makeDeps();
    await noticeDroppedWork([{ roomId: 'r1', count: 2 }], deps, 1000, { unplannedSince: '2026-11-13T01:10:00.000Z' });
    expect(deps.pushMessage).toHaveBeenCalledWith('r1', droppedWorkText(2, { unplannedSince: '2026-11-13T01:10:00.000Z' }));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('予告なく'));
  });
});
