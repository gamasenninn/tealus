/**
 * 部屋の設定のアプリ一覧の編集 (改善ループ 76、#649 C)
 *
 * ★ 以前は 7 本の手続き (自動で開く・画面を消さない・通行証・割合・追加・更新・削除) が、それぞれ一覧を作り替えて
 *   丸ごと保存していて、テストが 0 だった。作り替えを 1 つの関数にして、ここで固定する
 */
import { describe, it, expect } from 'vitest';
import { editAppUrls } from '../../src/utils/appUrlsEdit';
import type { AppUrl } from '../../src/types';

const A: AppUrl = { title: 'A', url: 'https://a.example/', ratio: 50, auto_open: false, wake_lock: false };
const B: AppUrl = { title: 'B', url: 'https://b.example/', ratio: 40, auto_open: true, wake_lock: false, pass: true };

describe('editAppUrls', () => {
  it('切り替え (自動で開く・画面を消さない・通行証) はその 1 件だけ', () => {
    expect(editAppUrls([A, B], { kind: 'toggle', index: 0, field: 'auto_open' })).toEqual([{ ...A, auto_open: true }, B]);
    expect(editAppUrls([A, B], { kind: 'toggle', index: 1, field: 'wake_lock' })).toEqual([A, { ...B, wake_lock: true }]);
    expect(editAppUrls([A, B], { kind: 'toggle', index: 1, field: 'pass' })).toEqual([A, { ...B, pass: false }]);
  });

  it('割合は数にする', () => {
    expect(editAppUrls([A], { kind: 'ratio', index: 0, ratio: '70' })).toEqual([{ ...A, ratio: 70 }]);
  });

  it('追加は前後の空白を落とし、既定の値で末尾に足す', () => {
    expect(editAppUrls([A], { kind: 'add', title: ' C ', url: ' https://c.example/ ' }))
      .toEqual([A, { title: 'C', url: 'https://c.example/', ratio: 50, auto_open: false, wake_lock: false }]);
  });

  it('更新は名前と URL だけを替える (ほかの設定は残す)', () => {
    expect(editAppUrls([A, B], { kind: 'update', index: 1, title: 'B2', url: 'https://b2.example/' }))
      .toEqual([A, { ...B, title: 'B2', url: 'https://b2.example/' }]);
  });

  it('削除はその 1 件だけ', () => {
    expect(editAppUrls([A, B], { kind: 'remove', index: 0 })).toEqual([B]);
  });

  it('★ 範囲外の番号は何も変えない (古い一覧の番号で別のアプリを触らない)', () => {
    for (const a of [{ kind: 'remove', index: 5 }, { kind: 'toggle', index: 9, field: 'pass' }, { kind: 'update', index: 3, title: 'x', url: 'y' }] as const) {
      expect(editAppUrls([A], a)).toEqual([A]);
    }
  });

  it('元の一覧は書き換えない', () => {
    const list = [A];
    editAppUrls(list, { kind: 'toggle', index: 0, field: 'auto_open' });
    expect(list[0].auto_open).toBe(false);
  });
});
