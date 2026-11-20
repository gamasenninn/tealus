/**
 * 段階 2: SSH 越しの herdr (docs/12 §13、2026-11-20)
 * ★ 相手の herdr を SSH で 1 回ずつ呼ぶ。引数は 1 つずつ "…" で囲んで 1 本の文字列に (相手のシェルを通るため)
 * ★ つながらない (SSH の 255) は「居ない」。打ったあとの戻りが失われたら「分からない」として、
 *   次の回に相手が動いたか (herdr の state_change_seq) を見てから決める (二重に届けるより遅れるほうがよい)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sshRun, isSafeRemoteArg } from '../src/ssh.mts';
import { herdrCourier, type Courier, type Run } from '../src/herdr.mts';
import { tickBridge, resetTickMemory, type TickDeps } from '../src/tick.mts';
import { RateLimiter } from '../src/limit.mts';
import { loadCursor, saveCursor } from '../src/cursor.mts';
import { loadBridges } from '../src/config.mts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('sshRun', () => {
  it('★ ssh に渡す形: 時間切れ 5 秒・対話なし・-l でユーザ・相手のコマンドは 1 本の文字列 (引数ごとに "…")', async () => {
    const base = jest.fn(async () => ({ code: 0, stdout: '{}', stderr: '' }));
    await sshRun(base, { host: '192.168.11.235', user: 'バックアップ専用pc' })('C:\\h\\herdr.exe', ['agent', 'get', 'hb1']);
    expect(base).toHaveBeenCalledWith('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', '-l', 'バックアップ専用pc', '192.168.11.235',
      '"C:/h/herdr.exe" "agent" "get" "hb1"']);   // ★ 逆斜線は斜線に (下の試験)
  });

  it('★ 道の逆斜線は斜線にして送る (途中の引数の読み直しで逆斜線が消えないように。2026-11-20 の試験で消える形を見た)', async () => {
    const base = jest.fn(async () => ({ code: 0, stdout: '{}', stderr: '' }));
    await sshRun(base, { host: 'h', user: 'u' })('C:\\Users\\x\\herdr.exe', ['agent', 'get', 'a']);
    expect((base.mock.calls[0] as unknown as [string, string[]])[1].at(-1)).toBe('"C:/Users/x/herdr.exe" "agent" "get" "a"');
  });

  it('★ 相手のシェルで意味を持つ文字 (" % 改行) を含む引数は送らない', async () => {
    expect(isSafeRemoteArg('Tealus: @cc-dbbackup に新着 2 件 (最新 id=…)。')).toBe(true);
    for (const bad of ['a"b', '50%', 'a\nb', 'a\rb']) expect(isSafeRemoteArg(bad)).toBe(false);
    const base = jest.fn();
    const r = await sshRun(base, { host: 'h', user: 'u' })('herdr', ['agent', 'prompt', 'a', 'x"; del']);
    expect(base).not.toHaveBeenCalled();
    expect(r.code).not.toBe(0);
  });

  it('★ SSH がつながらない (255) は herdr の「居ない」と同じ形の失敗にする', async () => {
    const base = jest.fn(async () => ({ code: 255, stdout: '', stderr: 'ssh: connect to host h port 22: Connection timed out' }));
    const c = herdrCourier(sshRun(base, { host: 'h', user: 'u' }), 'hb1');
    expect(await c.status()).toBe('missing');
  });
});

describe('★ 戻りが失われたとき (docs/12 §13.2)', () => {
  let queueDir: string, stateDir: string;
  let t = 0;
  let events: Array<Record<string, unknown>>;
  const deps = (): TickDeps => ({
    queueDir, stateDir, limiter: new RateLimiter(20, 3600_000, () => t), now: () => t, dryRun: false, record: (e) => events.push(e),
  });
  const writeQueue = (...ns: number[]) => fs.writeFileSync(path.join(queueDir, 'db.jsonl'), ns.map((n) => JSON.stringify({ id: id(n) }) + '\n').join(''));

  beforeEach(() => {
    queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-q-'));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-s-'));
    events = []; t = 1_000_000; resetTickMemory();
  });
  afterEach(() => { fs.rmSync(queueDir, { recursive: true, force: true }); fs.rmSync(stateDir, { recursive: true, force: true }); });

  const fake = (seqs: number[], deliverResults: Array<{ ok: true; ref: string } | { ok: false; error: string }>): Courier & { sent: number } => {
    let s = 0; let d = 0;
    const c = {
      sent: 0,
      status: async () => 'idle' as const,
      progress: async () => seqs[Math.min(s++, seqs.length - 1)],
      deliver: async () => { c.sent++; return deliverResults[Math.min(d++, deliverResults.length - 1)]; },
    };
    return c;
  };

  it('打ったが戻りが無く、相手の進み具合が変わっていた → 届いたとみなしてカーソルを進める (打ち直さない)', async () => {
    writeQueue(1); saveCursor(stateDir, 'db', id(1)); writeQueue(1, 2);
    const c = fake([5, 6], [{ ok: false, error: 'uncertain' }]);
    expect((await tickBridge({ project: 'db', courier: c }, deps())).state).toBe('unknown');
    expect(loadCursor(stateDir, 'db')).toBe(id(1));
    t += 3_000;
    await tickBridge({ project: 'db', courier: c }, deps());
    expect(c.sent).toBe(1);
    expect(loadCursor(stateDir, 'db')).toBe(id(2));
    expect(events.some((e) => e.kind === 'delivered' && e.confirmed_late === true)).toBe(true);
  });

  it('★ 打ったが戻りが無く、相手の進み具合が変わっていない → すぐには打ち直さない (30 秒待つ)。過ぎてから打ち直す', async () => {
    writeQueue(1); saveCursor(stateDir, 'db', id(1)); writeQueue(1, 2);
    const c = fake([5, 5, 5, 5], [{ ok: false, error: 'uncertain' }, { ok: true, ref: 'r' }]);
    await tickBridge({ project: 'db', courier: c }, deps());
    t += 3_000;
    expect((await tickBridge({ project: 'db', courier: c }, deps())).state).toBe('unknown');
    expect(c.sent).toBe(1);   // 相手が遅れて動き出すかもしれないので、まだ打たない
    t += 30_000;
    await tickBridge({ project: 'db', courier: c }, deps());
    expect(c.sent).toBe(2);
    expect(loadCursor(stateDir, 'db')).toBe(id(2));
  });
});

describe('bridges.json の herdr-ssh', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-c-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('host・user・herdr を読む。形の違うものは使わない', () => {
    fs.writeFileSync(path.join(dir, 'bridges.json'), JSON.stringify([
      { project: 'dbbackup', adapter: 'herdr-ssh', agent: 'dbbackup', host: '192.168.11.235', user: 'バックアップ専用pc', herdr: 'C:\\Users\\x\\AppData\\Local\\Programs\\herdr\\herdr.exe', enabled: true },
      { project: 'bad1', adapter: 'herdr-ssh', agent: 'a', host: 'h; rm', user: 'u', herdr: 'h', enabled: true },
      { project: 'bad2', adapter: 'herdr-ssh', agent: 'a', host: 'h', user: 'u"x', herdr: 'h', enabled: true },
    ]));
    const r = loadBridges(dir);
    expect(r.ok && r.bridges.map((b) => b.project)).toEqual(['dbbackup']);
    expect(r.ok && r.bridges[0]).toMatchObject({ adapter: 'herdr-ssh', host: '192.168.11.235', user: 'バックアップ専用pc' });
    expect(r.ok && r.skipped).toHaveLength(2);
  });
});

// 型だけの確かめ (Run の形)
export const _run: Run = async () => ({ code: 0, stdout: '', stderr: '' });
