/**
 * #475 通知の送り先から外すのを「その部屋をいま見ている人」だけにする
 *
 * 以前は「どの端末からでも接続している人」を外していたので、PC を開いたままだと
 * スマホに 1 件も届かなかった。接続ごとに「見ている部屋」を覚え、送るときに引く。
 */
import { beforeEach, describe, expect, test } from '@jest/globals';
import {
  setViewing, removeSocket, viewingUserIds, clearViewing,
} from '../../src/socket/viewingRooms.mts';

const R1 = '00000000-0000-0000-0000-0000000000a1';
const R2 = '00000000-0000-0000-0000-0000000000a2';

describe('viewingRooms — 接続ごとに見ている部屋を覚える', () => {
  beforeEach(() => clearViewing());

  test('見ている人だけが返る', () => {
    setViewing('s1', 'u1', R1, true);
    expect(viewingUserIds(R1)).toEqual(['u1']);
    expect(viewingUserIds(R2)).toEqual([]);
  });

  test('★ 見なくなったら外れる (画面が裏に回った・部屋を離れた)', () => {
    setViewing('s1', 'u1', R1, true);
    setViewing('s1', 'u1', R1, false);
    expect(viewingUserIds(R1)).toEqual([]);
  });

  test('★★ 同じ人の別の端末が見ていれば、1 台が見なくなっても見ている扱い', () => {
    setViewing('pc', 'u1', R1, true);
    setViewing('phone', 'u1', R1, true);
    setViewing('phone', 'u1', R1, false);
    expect(viewingUserIds(R1)).toEqual(['u1']);
  });

  test('★ 1 つの接続が複数の部屋を見ていてもよい', () => {
    setViewing('s1', 'u1', R1, true);
    setViewing('s1', 'u1', R2, true);
    expect(viewingUserIds(R1)).toEqual(['u1']);
    expect(viewingUserIds(R2)).toEqual(['u1']);
  });

  test('★★ 接続が切れたら、その接続の分は消える', () => {
    setViewing('s1', 'u1', R1, true);
    setViewing('s2', 'u2', R1, true);
    removeSocket('s1');
    expect(viewingUserIds(R1)).toEqual(['u2']);
  });

  test('同じ人が 2 台で見ていても 1 回だけ返る', () => {
    setViewing('pc', 'u1', R1, true);
    setViewing('tab', 'u1', R1, true);
    expect(viewingUserIds(R1)).toEqual(['u1']);
  });
});
