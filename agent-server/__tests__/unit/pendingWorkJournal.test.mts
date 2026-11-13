/**
 * 予告なしに止まったときも「中断しました」を知らせる (改善ループ 49、2026-11-13)
 * ★ 計画的な停止 (Ctrl+C) では停止の手順が部屋に知らせる (droppedWorkNotice)。電源断・Windows の再起動・クラッシュでは
 *   手順が走らず、仕事が黙って消える (11-13 01:11 の再起動では 0 件だったが、作りとしては残っていた)。
 *   仕事が残っている間だけ控えをファイルに置き、起動したときに残っていれば「予告なく止まった」とみなして知らせる
 */
jest.mock('dotenv', () => ({ config: jest.fn() }));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPendingWorkJournal } from '../../src/webhook/pendingWorkJournal.mts';
import { droppedWorkText, isDroppedWorkNotice } from '../../src/webhook/droppedWorkNotice.mts';

let dir: string;
let file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-')); file = path.join(dir, 'sub', 'pending-work.json'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('createPendingWorkJournal', () => {
  test('★ 仕事が残っている間は控えを書き、読み戻せる (置き場のフォルダが無くても作る)', () => {
    const j = createPendingWorkJournal(file, () => new Date('2026-11-13T01:10:00Z'));
    j.record([{ roomId: 'r1', count: 2 }]);
    expect(j.readLeftover()).toEqual({ at: '2026-11-13T01:10:00.000Z', pending: [{ roomId: 'r1', count: 2 }] });
  });

  test('★ 仕事が無くなったら控えを消す (= 起動したときに残っていなければ、きちんと終わっていた)', () => {
    const j = createPendingWorkJournal(file);
    j.record([{ roomId: 'r1', count: 1 }]);
    j.record([]);
    expect(fs.existsSync(file)).toBe(false);
    expect(j.readLeftover()).toBeNull();
  });

  test('clear で消す (停止の手順で知らせた後は、次の起動で二重に知らせない)', () => {
    const j = createPendingWorkJournal(file);
    j.record([{ roomId: 'r1', count: 1 }]);
    j.clear();
    expect(j.readLeftover()).toBeNull();
  });

  test('壊れた控えは投げずに無いものとして扱う', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ broken');
    expect(createPendingWorkJournal(file).readLeftover()).toBeNull();
  });

  test('書けない場所でも投げない (AI の仕事を止めない)', () => {
    const j = createPendingWorkJournal(path.join(dir, 'x\u0000y', 'a.json'));
    expect(() => j.record([{ roomId: 'r1', count: 1 }])).not.toThrow();
  });
});

describe('予告なしに止まったときの文', () => {
  test('★ 止まったおおよその時刻を入れ、自分の知らせとして見分けられる (再起動後の自分が返事をしない)', () => {
    const t = droppedWorkText(3, { unplannedSince: '2026-11-13T01:10:00.000Z' });
    expect(t).toContain('予告なく');
    expect(t).toContain('10:10');   // JST
    expect(t).toContain('3 件');
    expect(isDroppedWorkNotice(t)).toBe(true);
  });

  test('計画的な停止の文は今までどおり', () => {
    expect(droppedWorkText(2)).toContain('AI を再起動したため');
    expect(isDroppedWorkNotice(droppedWorkText(2))).toBe(true);
  });
});

/**
 * 改善ループ 50: 起動時に控えを即消すと、Bot のログインが済む前にもう一度落ちたとき知らせが失われた。
 * 起動時は退避 (.prev) し、知らせが済んでから消す
 */
describe('takeLeftover / clearLeftover (改善ループ 50)', () => {
  test('★ 起動時は控えを退避し、新しい控えには上書きされない', () => {
    const j = createPendingWorkJournal(file, () => new Date('2026-11-13T01:10:00Z'));
    j.record([{ roomId: 'r1', count: 2 }]);
    expect(j.takeLeftover()).toEqual({ at: '2026-11-13T01:10:00.000Z', pending: [{ roomId: 'r1', count: 2 }] });
    j.record([{ roomId: 'r9', count: 1 }]);   // 起動後の新しい仕事
    expect(j.takeLeftover()?.pending).toEqual(expect.arrayContaining([{ roomId: 'r1', count: 2 }]));
  });

  test('★ 知らせる前にもう一度落ちたら、退避した分と新しい控えを合わせて次に渡す (時刻は古い方)', () => {
    const t = ['2026-11-13T01:10:00Z', '2026-11-13T01:30:00Z'];
    let i = 0;
    const j = createPendingWorkJournal(file, () => new Date(t[Math.min(i++, 1)]));
    j.record([{ roomId: 'r1', count: 2 }]);
    j.takeLeftover();                               // 1 回目の起動 (知らせる前に落ちた)
    j.record([{ roomId: 'r1', count: 1 }, { roomId: 'r2', count: 1 }]);
    const v = j.takeLeftover();                     // 2 回目の起動
    expect(v?.at).toBe('2026-11-13T01:10:00.000Z');
    expect(v?.pending).toEqual(expect.arrayContaining([{ roomId: 'r1', count: 3 }, { roomId: 'r2', count: 1 }]));
  });

  test('clearLeftover で退避した分を消す (知らせが済んだら)', () => {
    const j = createPendingWorkJournal(file);
    j.record([{ roomId: 'r1', count: 1 }]);
    j.takeLeftover();
    j.clearLeftover();
    expect(j.takeLeftover()).toBeNull();
  });

  test('clear は書きかけ (.tmp) も消す', () => {
    const j = createPendingWorkJournal(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, '{}');
    j.clear();
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });
});
