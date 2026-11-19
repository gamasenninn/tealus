/**
 * 届け先 herdr と配る輪 (改善ループ 79、docs/12 §6・§8・courier-design.md の「最初に書くべき試験」2・3・5)
 * ★ この機械にはまだ herdr が入っていないので、外のコマンドは偽の run で差し替える
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { herdrCourier, mapAgentStatus, type Courier, type CourierStatus, type Run } from '../src/herdr.mts';
import { tickBridge, resetTickMemory, type TickDeps } from '../src/tick.mts';
import { RateLimiter, isHeld } from '../src/limit.mts';
import { loadCursor, saveCursor } from '../src/cursor.mts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('herdr の届け先', () => {
  const runWith = (r: { code: number; stdout?: string; stderr?: string }): Run => jest.fn(async () => ({ code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }));

  it('agent_status を状態へ (idle・done は渡してよい / working は待つ / blocked は打たない)', () => {
    expect(mapAgentStatus('idle')).toBe('idle');
    expect(mapAgentStatus('done')).toBe('idle');
    expect(mapAgentStatus('working')).toBe('busy');
    expect(mapAgentStatus('blocked')).toBe('blocked');
    expect(mapAgentStatus('???')).toBe('unknown');
  });

  it('★ 状態は JSON の agent_status だけを見る (「not running」を running と読まない)', async () => {
    // ★ herdr 0.9.5 の実物 (2026-11-19 PaneDeck 班がバックアップ PC で取った): agent_status は result.agent の中
    const real = '{"id":"cli:agent:get","result":{"agent":{"agent":"claude","agent_status":"idle","completion_seq":3,"name":"hb1","pane_id":"w6:p1"},"type":"agent_info"}}';
    expect(await herdrCourier(runWith({ code: 0, stdout: real }), 'a').status()).toBe('idle');
    expect(await herdrCourier(runWith({ code: 0, stdout: real.replace('"idle"', '"working"') }), 'a').status()).toBe('busy');
    expect(await herdrCourier(runWith({ code: 0, stdout: real.replace('"idle"', '"blocked"') }), 'a').status()).toBe('blocked');
    // 中身の無い成功は分からない (上の階層の agent_status だけでは読まない)
    expect(await herdrCourier(runWith({ code: 0, stdout: '{"agent_status":"idle"}' }), 'a').status()).toBe('unknown');
    expect(await herdrCourier(runWith({ code: 0, stdout: 'status: not running' }), 'a').status()).toBe('unknown');
    expect(await herdrCourier(runWith({ code: 1, stderr: 'agent not found' }), 'a').status()).toBe('missing');
    expect(await herdrCourier(runWith({ code: 1, stderr: 'boom' }), 'a').status()).toBe('unknown');
    // ★ herdr 0.9.5 の実物 (2026-11-19 にこの機械で確かめた): 失敗は stdout の JSON {"error":{"code":…}}
    expect(await herdrCourier(runWith({ code: 1, stdout: '{"id":"cli:agent:get","error":{"code":"server_not_running","message":"no herdr server is running"}}' }), 'a').status()).toBe('missing');
    expect(await herdrCourier(runWith({ code: 1, stdout: '{"error":{"code":"agent_not_found"}}' }), 'a').status()).toBe('missing');
  });

  it('★ 渡すのは agent prompt (動き出すまで相手の側で待つ)。pane send-text は使わない', async () => {
    const run = runWith({ code: 0 });
    const r = await herdrCourier(run, 'pd').deliver('文面');
    expect(r.ok).toBe(true);
    const args = (run as jest.Mock).mock.calls[0][1] as string[];
    expect(args.slice(0, 4)).toEqual(['agent', 'prompt', 'pd', '文面']);
    expect(args).toContain('--wait');
    expect(args).not.toContain('send-text');
  });

  it('確認待ちで断られたら blocked、ほかの失敗は理由つき', async () => {
    expect(await herdrCourier(runWith({ code: 2, stderr: 'agent_blocked' }), 'a').deliver('x')).toEqual({ ok: false, error: 'blocked' });
    expect(await herdrCourier(runWith({ code: 1, stdout: '{"error":{"code":"agent_blocked"}}' }), 'a').deliver('x')).toEqual({ ok: false, error: 'blocked' });
    // ★ 受け付けたが 5 秒で動き出さなかった (herdr 0.9.5 の agent_prompt_stalled)。押し直しはせず、理由を返す
    expect(await herdrCourier(runWith({ code: 1, stdout: '{"error":{"code":"agent_prompt_stalled"}}' }), 'a').deliver('x')).toEqual({ ok: false, error: 'agent_prompt_stalled' });
    const r = await herdrCourier(runWith({ code: 3 }), 'a').deliver('x');
    expect(r.ok).toBe(false);
  });
});

describe('配る輪 (tickBridge)', () => {
  let queueDir: string, stateDir: string;
  let t = 0;
  let events: Array<Record<string, unknown>>;
  const deps = (over: Partial<TickDeps> = {}): TickDeps => ({
    queueDir, stateDir, limiter: new RateLimiter(20, 3600_000, () => t), now: () => t, dryRun: false,
    record: (e) => events.push(e), ...over,
  });
  const writeQueue = (...ns: number[]) => fs.writeFileSync(path.join(queueDir, 'pd.jsonl'), ns.map((n) => JSON.stringify({ id: id(n), content: '本文' }) + '\n').join(''));
  const fake = (status: CourierStatus, deliverOk = true): Courier & { delivered: string[] } => {
    const delivered: string[] = [];
    return {
      delivered,
      status: async () => status,
      deliver: async (text) => { delivered.push(text); return deliverOk ? { ok: true, ref: 'r' } : { ok: false, error: 'x' }; },
    };
  };

  beforeEach(() => {
    queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-q-'));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'courier-s-'));
    events = [];
    t = 1_000_000;
    resetTickMemory();
  });
  afterEach(() => { fs.rmSync(queueDir, { recursive: true, force: true }); fs.rmSync(stateDir, { recursive: true, force: true }); });

  it('★ 初回は末尾から (過去分は配らない)', async () => {
    writeQueue(1, 2);
    const c = fake('idle');
    expect((await tickBridge({ project: 'pd', courier: c }, deps())).state).toBe('idle');
    expect(c.delivered).toEqual([]);
    expect(loadCursor(stateDir, 'pd')).toBe(id(2));
  });

  it('★ 新着はまとめて 1 通。受け付けられてからカーソルを進める', async () => {
    writeQueue(1);
    saveCursor(stateDir, 'pd', id(1));
    writeQueue(1, 2, 3);
    const c = fake('idle');
    const r = await tickBridge({ project: 'pd', courier: c }, deps());
    expect(r.state).toBe('delivered');
    expect(c.delivered).toHaveLength(1);
    expect(c.delivered[0]).toContain('新着 2 件');
    expect(c.delivered[0]).toContain(id(3));
    expect(c.delivered[0]).not.toContain('本文');
    expect(loadCursor(stateDir, 'pd')).toBe(id(3));
  });

  it('★ 忙しい・確認待ち・落ちている・渡せなかったときはカーソルを進めない', async () => {
    for (const st of ['busy', 'blocked', 'missing', 'unknown'] as const) {
      saveCursor(stateDir, 'pd', id(1));
      writeQueue(1, 2);
      const c = fake(st);
      const r = await tickBridge({ project: 'pd', courier: c }, deps());
      expect([st, r.state, r.pending, c.delivered.length]).toEqual([st, st, 1, 0]);
      expect(loadCursor(stateDir, 'pd')).toBe(id(1));
    }
    const failing = fake('idle', false);
    expect((await tickBridge({ project: 'pd', courier: failing }, deps())).state).toBe('failed');
    expect(loadCursor(stateDir, 'pd')).toBe(id(1));
  });

  it('★ 確認待ちが続いた時間を返す (鼓動で「確認待ち N 分」を出すため)', async () => {
    saveCursor(stateDir, 'pd', id(1));
    writeQueue(1, 2);
    const c = fake('blocked');
    const first = await tickBridge({ project: 'pd', courier: c }, deps());
    t += 11 * 60_000;
    const later = await tickBridge({ project: 'pd', courier: c }, deps());
    expect(later.since).toBe(first.since);
    expect(t - (later.since as number)).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('★ 読めない (無い) ときは何もしない (新着ともカーソルの消失ともみなさない)', async () => {
    saveCursor(stateDir, 'pd', id(1));
    const c = fake('idle');
    expect((await tickBridge({ project: 'pd', courier: c }, deps())).state).toBe('unreadable');
    expect(c.delivered).toEqual([]);
    expect(loadCursor(stateDir, 'pd')).toBe(id(1));
  });

  it('★ queue のファイルがまだ無い班は、現れた最初の便から配る (2026-11-19 オントロジー本班で最初の 1 便を飛ばしかけた)', async () => {
    const c = fake('idle');
    expect((await tickBridge({ project: 'pd', courier: c }, deps())).state).toBe('unreadable');
    writeQueue(1);
    const r = await tickBridge({ project: 'pd', courier: c }, deps());
    expect(r.state).toBe('delivered');
    expect(c.delivered).toHaveLength(1);
    expect(c.delivered[0]).toContain('新着 1 件');
    expect(loadCursor(stateDir, 'pd')).toBe(id(1));
  });

  it('★ 同じことを空回しでも (印は手元で覚える・ファイルは作らない)', async () => {
    const c = fake('idle');
    await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }));
    writeQueue(1);
    await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }));
    expect(events.filter((e) => e.kind === 'dry-run').map((e) => e.ids)).toEqual([[id(1)]]);
    expect(loadCursor(stateDir, 'pd')).toBeNull();
  });

  it('★ 新着が無くても、10 秒ごとに届け先の状態を見て返す (管理画面の一覧・確認待ちの知らせのため、2026-11-20)', async () => {
    writeQueue(1);
    saveCursor(stateDir, 'pd', id(1));
    let calls = 0;
    let st: CourierStatus = 'blocked';
    const c: Courier = { status: async () => { calls++; return st; }, deliver: async () => ({ ok: true, ref: 'r' }) };
    expect((await tickBridge({ project: 'pd', courier: c }, deps())).state).toBe('blocked');
    st = 'busy';
    t += 3_000;
    expect((await tickBridge({ project: 'pd', courier: c }, deps())).state).toBe('blocked');   // 10 秒たつまでは前の結果
    expect(calls).toBe(1);
    t += 10_000;
    expect((await tickBridge({ project: 'pd', courier: c }, deps())).state).toBe('busy');
    expect(calls).toBe(2);
    expect(loadCursor(stateDir, 'pd')).toBe(id(1));   // 見ただけでカーソルは動かない
  });

  it('★ 空回しの班は、新着が無いときに届け先を見に行かない (まだ移していない班が「居ない」と鳴るため)', async () => {
    writeQueue(1);
    let calls = 0;
    const c: Courier = { status: async () => { calls++; return 'missing'; }, deliver: async () => ({ ok: true, ref: 'r' }) };
    await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }));   // 初回 (末尾から)
    t += 60_000;
    expect((await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }))).state).toBe('idle');
    expect(calls).toBe(0);
  });

  it('★ カーソルが消えていたら (切り詰め) 件数を数えず「新着あり」', async () => {
    saveCursor(stateDir, 'pd', id(1));
    writeQueue(5, 6);
    const c = fake('idle');
    await tickBridge({ project: 'pd', courier: c }, deps());
    expect(c.delivered[0]).toContain('新着あり');
  });

  it('★ 上限を超えたら保留の印を置き、配らない。印がある間は何もしない', async () => {
    const holds: string[] = [];
    const lim = new RateLimiter(1, 3600_000, () => t);
    saveCursor(stateDir, 'pd', id(1));
    writeQueue(1, 2);
    const c = fake('idle');
    await tickBridge({ project: 'pd', courier: c }, deps({ limiter: lim }));
    writeQueue(1, 2, 3);
    const r = await tickBridge({ project: 'pd', courier: c }, deps({ limiter: lim, onHold: (p) => holds.push(p) }));
    expect(r.state).toBe('held');
    expect(isHeld(stateDir, 'pd')).toBe(true);
    expect(holds).toEqual(['pd']);
    expect(c.delivered).toHaveLength(1);
    writeQueue(1, 2, 3, 4);
    expect((await tickBridge({ project: 'pd', courier: c }, deps({ limiter: lim }))).state).toBe('held');
    expect(c.delivered).toHaveLength(1);
  });

  it('★ 空回しは打たずに記録だけ。カーソルも進めず、同じ判断を 2 度記録しない', async () => {
    saveCursor(stateDir, 'pd', id(1));
    writeQueue(1, 2);
    const c = fake('idle');
    await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }));
    await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }));
    expect(c.delivered).toEqual([]);
    expect(loadCursor(stateDir, 'pd')).toBe(id(1));
    expect(events.filter((e) => e.kind === 'dry-run')).toHaveLength(1);
  });

  it('★ 空回しでカーソルのファイルが無いとき、2 回目以降を「初回」と見なさない (2026-11-19 の本番で 4 便を記録しなかった)', async () => {
    writeQueue(1);
    const c = fake('missing');
    await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }));   // 初回: 末尾 (1) から
    writeQueue(1, 2, 3);
    await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }));
    const e = events.filter((x) => x.kind === 'dry-run');
    expect(e).toHaveLength(1);
    expect(e[0].ids).toEqual([id(2), id(3)]);
    expect(loadCursor(stateDir, 'pd')).toBeNull();   // 空回しはカーソルのファイルを作らない
  });

  it('★ 空回しは届け先が居なくても (herdr を起こす前でも) 判断を ids つきで記録する', async () => {
    saveCursor(stateDir, 'pd', id(1));
    writeQueue(1, 2, 3);
    const c = fake('missing');
    await tickBridge({ project: 'pd', courier: c }, deps({ dryRun: true }));
    const e = events.find((x) => x.kind === 'dry-run')!;
    expect(e.ids).toEqual([id(2), id(3)]);
    expect(e.courier_status).toBe('missing');
    expect(c.delivered).toEqual([]);
  });
});
