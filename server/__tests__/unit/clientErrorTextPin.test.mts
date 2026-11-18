/**
 * 画面が分岐に使っている本体のエラー文言を固定する (改善ループ 74、#649 B-8)
 *
 * ★ 画面 (client/src/stores/messageStore.ts) は「403 かつ文言が ROOM_ACCESS_DENIED と一致」のときだけ、
 *   外された部屋の画面を閉じる。本体の文言を直すと、外された人の画面が黙って閉じなくなる。
 *   応答に code を足すのは大きいので、両側の文言が同じことをここで見る (画面のファイルは文字として読むだけ)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOM_ACCESS_DENIED } from '../../src/constants/errors.mts';

describe('画面が分岐に使う本体のエラー文言', () => {
  it('★ ROOM_ACCESS_DENIED が画面の写しと同じ', () => {
    const client = fs.readFileSync(path.join(import.meta.dirname, '../../../client/src/stores/messageStore.ts'), 'utf8');
    const m = client.match(/const ROOM_ACCESS_DENIED = '([^']+)';/);
    expect(m?.[1]).toBe(ROOM_ACCESS_DENIED);
  });
});
