/**
 * queue を読む部分とカーソル (改善ループ 77、docs/12 §4.2・§12.2・§12.3)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readQueue, newSince, QUEUE_ID_RE } from '../src/queue.mts';
import { loadCursor, saveCursor, isValidProject } from '../src/cursor.mts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const line = (n: number) => JSON.stringify({ id: id(n), room_id: id(900), content: '本文は使わない' });

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('readQueue', () => {
  it('行ごとに id を順に返す (本文は返さない)', () => {
    const f = path.join(dir, 'x.jsonl');
    fs.writeFileSync(f, `${line(1)}\n${line(2)}\n`);
    expect(readQueue(f)).toEqual({ ok: true, ids: [id(1), id(2)], bad: 0 });
  });

  it('★ 壊れた行・形の違う id は数えて飛ばし、止まらない (中身は返さない)', () => {
    const f = path.join(dir, 'x.jsonl');
    fs.writeFileSync(f, `${line(1)}\n{壊れた\n${JSON.stringify({ id: 'not-a-uuid' })}\n${line(3)}\n`);
    expect(readQueue(f)).toEqual({ ok: true, ids: [id(1), id(3)], bad: 2 });
  });

  it('★ 末尾が改行で終わらない行 (書きかけ) は、まだ無いものとして扱う', () => {
    const f = path.join(dir, 'x.jsonl');
    fs.writeFileSync(f, `${line(1)}\n${line(2).slice(0, 20)}`);
    expect(readQueue(f)).toEqual({ ok: true, ids: [id(1)], bad: 0 });
  });

  it('★ 無い・空は「読めない」(新着ともカーソルの消失ともみなさない)', () => {
    expect(readQueue(path.join(dir, 'none.jsonl'))).toEqual({ ok: false, reason: 'ENOENT' });
    const f = path.join(dir, 'empty.jsonl');
    fs.writeFileSync(f, '');
    expect(readQueue(f)).toEqual({ ok: false, reason: 'empty' });
  });

  it('★ 読んだあとファイルを開いたままにしない (agent-server の切り詰めの rename を邪魔しない)', () => {
    const f = path.join(dir, 'x.jsonl');
    fs.writeFileSync(f, `${line(1)}\n`);
    readQueue(f);
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, `${line(2)}\n`);
    expect(() => fs.renameSync(tmp, f)).not.toThrow();
  });

  it('id の形は Tealus のメッセージの UUID (docs/12 §4.1。agent-server の契約テストと同じ写し)', () => {
    expect(QUEUE_ID_RE.test(id(1))).toBe(true);
    expect(QUEUE_ID_RE.test('ABC')).toBe(false);
  });
});

describe('newSince', () => {
  it('★ カーソルが無い (初回) は末尾から始める (過去分は流さない)', () => {
    expect(newSince([id(1), id(2)], null)).toEqual({ ids: [], last: id(2), lost: false });
  });

  it('カーソルの後ろだけを新着にする', () => {
    expect(newSince([id(1), id(2), id(3)], id(1))).toEqual({ ids: [id(2), id(3)], last: id(3), lost: false });
  });

  it('★ 同じ id が 2 回入っていたら、最後に出てきた位置で探す (編集で宛名を付け直した便)', () => {
    expect(newSince([id(1), id(2), id(1), id(3)], id(1))).toEqual({ ids: [id(3)], last: id(3), lost: false });
  });

  it('★ カーソルが消えていたら (切り詰め)、残りを全部新着にし、消えたことを返す', () => {
    expect(newSince([id(5), id(6)], id(1))).toEqual({ ids: [id(5), id(6)], last: id(6), lost: true });
  });

  it('新着が無ければ空で、カーソルはそのまま', () => {
    expect(newSince([id(1)], id(1))).toEqual({ ids: [], last: id(1), lost: false });
  });
});

describe('カーソル', () => {
  it('★ 一時ファイルに書いて入れ替える。読み直すと同じ値', () => {
    saveCursor(dir, 'panedeck', id(7));
    expect(loadCursor(dir, 'panedeck')).toBe(id(7));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('無ければ null。壊れていても null (初回と同じく末尾から)', () => {
    expect(loadCursor(dir, 'panedeck')).toBeNull();
    fs.writeFileSync(path.join(dir, 'cursor-panedeck.json'), '{壊れ');
    expect(loadCursor(dir, 'panedeck')).toBeNull();
  });

  it('★ project 名はファイル名になるので形を確かめる', () => {
    expect(isValidProject('panedeck')).toBe(true);
    expect(isValidProject('hks-portal')).toBe(true);
    for (const bad of ['', '../x', 'A', 'a/b', '-a', 'a-']) expect(isValidProject(bad)).toBe(false);
    expect(() => saveCursor(dir, '../x', id(1))).toThrow();
  });
});
