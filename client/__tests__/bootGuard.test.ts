/**
 * 読み込みの繰り返しを画面の側で止める (改善ループ 41)
 *
 * ★ 2026-11-04 10〜13 時、Mac の 1 台 (Safari の Dock のアプリ) が開いては数十ミリ秒で消されるのを 3 時間繰り返し、
 *   本体へ約 11 万回の要求を送った。Tealus の画面に自分で読み込み直す道は無く、原因は端末の側 (推測)。
 *   画面にできるのは、繰り返しに気づいたら本体を叩かずに止まり、本体へ 1 回だけ知らせること
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { recordBoot, BOOT_LOOP_LIMIT } from '../src/services/bootGuard';

const T0 = Date.parse('2026-11-04T01:29:00Z');

describe('recordBoot', () => {
  beforeEach(() => localStorage.clear());

  it('ふつうの読み込み直し (数回) では止めない', () => {
    for (let i = 0; i < 5; i++) expect(recordBoot(localStorage, T0 + i * 1000).looping).toBe(false);
  });

  it('★ 30 秒に上限を超えて起動したら止める (回数を返す)', () => {
    let r = recordBoot(localStorage, T0);
    for (let i = 1; i <= BOOT_LOOP_LIMIT; i++) r = recordBoot(localStorage, T0 + i * 300);
    expect(r.looping).toBe(true);
    expect(r.count).toBe(BOOT_LOOP_LIMIT + 1);
  });

  it('30 秒より前の起動は数えない', () => {
    for (let i = 0; i < BOOT_LOOP_LIMIT; i++) recordBoot(localStorage, T0 + i * 300);
    expect(recordBoot(localStorage, T0 + 60_000).looping).toBe(false);
  });

  it('保存領域が使えない端末では止めない (起動はする)', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(recordBoot(broken, T0).looping).toBe(false);
  });
});
