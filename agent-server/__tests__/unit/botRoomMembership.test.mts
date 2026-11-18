/**
 * Bot がその部屋にいるか (改善ループ 71、#649 B-5)。webhook の 3 つの口で同じ判定を使う
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureBotInRoom } from '../../src/lib/botRoomMembership.mts';

describe('ensureBotInRoom', () => {
  it('手元の一覧にあれば本体に聞かない', async () => {
    const fetchRooms = jest.fn();
    expect((await ensureBotInRoom(new Set(['r1']), 'r1', fetchRooms)).result).toBe('member');
    expect(fetchRooms).not.toHaveBeenCalled();
  });

  it('無ければ取り直して、一覧を入れ替えてから判定する', async () => {
    const ids = new Set(['old']);
    const r = await ensureBotInRoom(ids, 'r2', async () => ({ rooms: [{ id: 'r2' }, { id: 'r3' }] }));
    expect(r.result).toBe('refreshed-member');
    expect([...ids].sort()).toEqual(['r2', 'r3']);
    expect((await ensureBotInRoom(ids, 'r9', async () => ({ rooms: [{ id: 'r2' }] }))).result).toBe('not-member');
  });

  it('★ 取り直しが失敗したら「メンバーでない」でなく unknown (理由つき)', async () => {
    const r = await ensureBotInRoom(new Set(['x']), 'r1', async () => { throw new Error('503'); });
    expect(r).toEqual({ result: 'unknown', error: '503' });
  });

  it('手元の一覧が空なら確かめない (前からの振る舞い)', async () => {
    const fetchRooms = jest.fn();
    expect((await ensureBotInRoom(new Set(), 'r1', fetchRooms)).result).toBe('member');
    expect(fetchRooms).not.toHaveBeenCalled();
  });

  it('★ webhook の 3 つの口はこの関数で決める (同じ 15 行を手で写さない)', () => {
    const text = fs.readFileSync(path.join(import.meta.dirname, '../../src/webhook/handler.mts'), 'utf8');
    expect(text.match(/ensureBotInRoom\(/g)?.length).toBe(3);
    expect(text).not.toMatch(/const roomData = await botApi\.getRooms\(\)/);
  });
});
