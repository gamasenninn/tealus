/**
 * 起動の入口の部品 (改善ループ 81、docs/12 §5・§7・§12.3・§12.6)
 * - bridges.json の読み込み (形の違う行は使わない・同じ班が 2 回なら止まる)
 * - 鼓動を送る (ログインの鍵は使い回し、401 のときだけ取り直す・失敗しても配達は止めない)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadBridges } from '../src/config.mts';
import { heartbeatSender } from '../src/sendHeartbeat.mts';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-e-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('loadBridges', () => {
  const write = (v: unknown) => fs.writeFileSync(path.join(dir, 'bridges.json'), JSON.stringify(v));

  it('有効な登録だけを返す (enabled が false は外す)', () => {
    write([
      { project: 'panedeck', adapter: 'herdr', agent: 'pd', enabled: true },
      { project: 'tealus', adapter: 'herdr', agent: 'tl', enabled: false },
    ]);
    expect(loadBridges(dir)).toEqual({ ok: true, bridges: [{ project: 'panedeck', adapter: 'herdr', agent: 'pd', dryRun: true, queue: 'file' }], skipped: [] });
  });

  it('★ 形の違う行は使わず、理由を返す (班の名前・届け先の種類・名前)', () => {
    write([
      { project: '../x', adapter: 'herdr', agent: 'a', enabled: true },
      { project: 'a', adapter: 'ssh-anything', agent: 'a', enabled: true },
      { project: 'b', adapter: 'herdr', agent: 'a b"; rm', enabled: true },
    ]);
    const r = loadBridges(dir);
    expect(r.ok && r.bridges).toEqual([]);
    expect(r.ok && r.skipped).toHaveLength(3);
  });

  it('★ 同じ班が 2 回あれば読み込まない (配る人は 1 人)', () => {
    write([
      { project: 'panedeck', adapter: 'herdr', agent: 'a', enabled: true },
      { project: 'panedeck', adapter: 'herdr', agent: 'b', enabled: true },
    ]);
    expect(loadBridges(dir).ok).toBe(false);
  });

  it('★ 班ごとの空回し: 既定は空回し。dry_run が false と書いた班だけ本当に配る', () => {
    write([
      { project: 'panedeck', adapter: 'herdr', agent: 'pd', enabled: true },
      { project: 'lp', adapter: 'herdr', agent: 'lp', enabled: true, dry_run: false },
      { project: 'x', adapter: 'herdr', agent: 'x', enabled: true, dry_run: 'no' },
    ]);
    const r = loadBridges(dir);
    expect(r.ok && r.bridges.map((b) => [b.project, b.dryRun])).toEqual([['panedeck', true], ['lp', false], ['x', true]]);
  });

  it('無い・壊れているは ok=false', () => {
    expect(loadBridges(dir).ok).toBe(false);
    fs.writeFileSync(path.join(dir, 'bridges.json'), '{壊');
    expect(loadBridges(dir).ok).toBe(false);
  });
});

describe('heartbeatSender', () => {
  const auth = { api_url: 'http://t', login_id: 'courier', password: 'p' };

  it('★ ログインは初回だけ。2 回目は同じ鍵で送る', async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/api/auth/login')) return { status: 200, json: async () => ({ token: 'T1' }) };
      return { status: 200, json: async () => ({ success: true }) };
    });
    const send = heartbeatSender(auth, fetchImpl as never);
    expect(await send({ bridges: {} })).toBe(true);
    expect(await send({ bridges: {} })).toBe(true);
    expect(calls.filter((u) => u.endsWith('/login'))).toHaveLength(1);
    const hb = (fetchImpl.mock.calls as unknown[][]).find((c) => String(c[0]).endsWith('/api/bot/heartbeat'))!;
    expect(JSON.parse((hb[1] as { body: string }).body)).toEqual({ name: 'courier', info: { bridges: {} } });
  });

  it('★ 401 なら 1 回だけ取り直して送り直す', async () => {
    let hbCount = 0;
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.endsWith('/login')) return { status: 200, json: async () => ({ token: 'T' }) };
      hbCount++;
      return { status: hbCount === 1 ? 401 : 200, json: async () => ({}) };
    });
    expect(await heartbeatSender(auth, fetchImpl as never)({})).toBe(true);
    expect(hbCount).toBe(2);
  });

  it('★ 失敗しても投げない (配達は止めない)', async () => {
    const send = heartbeatSender(auth, (async () => { throw new Error('down'); }) as never);
    await expect(send({})).resolves.toBe(false);
  });
});
