/**
 * 鍵・上限・文面 (改善ループ 78、docs/12 §4.4・§8 の 3・7・8・16・§12.4)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, releaseLock } from '../src/lock.mts';
import { RateLimiter, isHeld, setHold } from '../src/limit.mts';
import { buildNotice } from '../src/notice.mts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-g-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('鍵 (1 つの班に配る人は 1 人)', () => {
  it('★ 1 人目は取れ、生きている 2 人目は取れない', () => {
    expect(acquireLock(dir, 'panedeck', 100, () => true)).toBe(true);
    expect(acquireLock(dir, 'panedeck', 200, () => true)).toBe(false);
  });

  it('★ 持ち主のプロセスが死んでいたら取り返す (強制終了で古い鍵が残った)', () => {
    expect(acquireLock(dir, 'panedeck', 100, () => true)).toBe(true);
    expect(acquireLock(dir, 'panedeck', 200, (pid) => pid !== 100)).toBe(true);
    expect(acquireLock(dir, 'panedeck', 300, () => true)).toBe(false);
  });

  it('自分の鍵は取り直せる・外せば別の人が取れる・班が違えば別', () => {
    expect(acquireLock(dir, 'panedeck', 100, () => true)).toBe(true);
    expect(acquireLock(dir, 'panedeck', 100, () => true)).toBe(true);
    expect(acquireLock(dir, 'tealus', 200, () => true)).toBe(true);
    releaseLock(dir, 'panedeck', 100);
    expect(acquireLock(dir, 'panedeck', 300, () => true)).toBe(true);
  });

  it('壊れた鍵のファイルは取り返す', () => {
    fs.writeFileSync(path.join(dir, 'lock-panedeck.json'), '{壊');
    expect(acquireLock(dir, 'panedeck', 100, () => true)).toBe(true);
  });
});

describe('上限 (班ごとに 1 時間に 20 通、docs/12 §12.4)', () => {
  it('★ 20 通までは通し、21 通目で止める', () => {
    let t = 0;
    const lim = new RateLimiter(20, 60 * 60_000, () => t);
    for (let i = 0; i < 20; i++) { expect(lim.take('panedeck')).toBe(true); t += 1000; }
    expect(lim.take('panedeck')).toBe(false);
  });

  it('1 時間たてば数え直す・班ごとに別', () => {
    let t = 0;
    const lim = new RateLimiter(2, 60 * 60_000, () => t);
    expect(lim.take('a')).toBe(true);
    expect(lim.take('a')).toBe(true);
    expect(lim.take('a')).toBe(false);
    expect(lim.take('b')).toBe(true);
    t = 60 * 60_000 + 1;
    expect(lim.take('a')).toBe(true);
  });

  it('★ 保留の印はファイルに残り、人が消すまで保留のまま (捨てない・勝手に戻さない)', () => {
    expect(isHeld(dir, 'panedeck')).toBe(false);
    setHold(dir, 'panedeck', '1 時間に 20 通を超えた');
    expect(isHeld(dir, 'panedeck')).toBe(true);
    fs.rmSync(path.join(dir, 'hold-panedeck.json'));
    expect(isHeld(dir, 'panedeck')).toBe(false);
  });
});

describe('文面 (id だけ、handle-tealus を指すひな型、docs/12 §8 の 1・16)', () => {
  it('★ 件数と最新の id と手順の名前だけ。本文は入らない・1 行', () => {
    const t = buildNotice('panedeck', 3, id(5), false);
    expect(t).toContain('@cc-panedeck');
    expect(t).toContain('3 件');
    expect(t).toContain(id(5));
    expect(t).toContain('handle-tealus');
    expect(t).not.toMatch(/[\r\n]/);
  });

  it('★ カーソルが消えていたら件数を数えず「新着あり」', () => {
    const t = buildNotice('panedeck', 1600, id(5), true);
    expect(t).toContain('新着あり');
    expect(t).not.toContain('1600');
  });

  it('★ 形の違う id・project では文面を作らない (引用で壊れる文字を通さない)', () => {
    expect(() => buildNotice('panedeck', 1, 'x" & del', false)).toThrow();
    expect(() => buildNotice('pane"deck', 1, id(1), false)).toThrow();
  });
});
