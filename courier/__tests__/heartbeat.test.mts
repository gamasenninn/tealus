/**
 * 鼓動に載せる中身 (改善ループ 80、docs/12 §7・§12.6)
 * ★ 載せるのは班の名前・状態・件数だけ (PC の名前・会話の id・届け先の名前は載せない)。info は 2,000 字まで
 * ★ 「確認待ちが 10 分以上」(2026-11-19 利用者) と、落ちている・保留を problem に入れる (見張りが業務メモに知らせる)
 */
import { heartbeatInfo, BLOCKED_ALERT_MS } from '../src/heartbeat.mts';
import type { BridgeReport } from '../src/tick.mts';

const now = 100 * 60_000;
const rep = (project: string, state: BridgeReport['state'], minutesAgo: number, pending = 0): BridgeReport =>
  ({ project, state, pending, since: now - minutesAgo * 60_000 });

describe('heartbeatInfo', () => {
  it('問題が無ければ problem を付けない。班ごとの状態と件数だけ', () => {
    const info = heartbeatInfo([rep('panedeck', 'idle', 30), rep('tealus', 'busy', 2, 1)], now);
    expect(info).toEqual({ bridges: {
      panedeck: { state: 'idle', pending: 0, since: new Date(now - 30 * 60_000).toISOString() },
      tealus: { state: 'busy', pending: 1, since: new Date(now - 2 * 60_000).toISOString() },
    } });
  });

  it('★ 配達役の起動時刻を載せる (それより前の状態は覚えていない。画面が「○時より前から」と出すため、2026-11-20)', () => {
    const startedAt = now - 90 * 60_000;
    expect(heartbeatInfo([rep('lp', 'idle', 90)], now, startedAt).started_at).toBe(new Date(startedAt).toISOString());
    expect(heartbeatInfo([rep('lp', 'idle', 90)], now).started_at).toBeUndefined();
  });

  it('★ 確認待ちが 10 分を超えたら problem に入れる (10 分未満は入れない)', () => {
    expect(BLOCKED_ALERT_MS).toBe(10 * 60_000);
    expect(heartbeatInfo([rep('panedeck', 'blocked', 9, 1)], now).problem).toBeUndefined();
    expect(heartbeatInfo([rep('panedeck', 'blocked', 11, 1)], now).problem).toMatch(/panedeck.*確認待ち.*11 分/);
  });

  it('★ 落ちている (missing・unknown) が 10 分を超えたら・保留は、すぐに problem に入れる', () => {
    expect(heartbeatInfo([rep('a', 'missing', 12)], now).problem).toMatch(/a.*見つかりません/);
    expect(heartbeatInfo([rep('b', 'held', 0, 3)], now).problem).toMatch(/b.*保留/);
  });

  it('★ 届かない (failed) が 10 分を超えたら problem に入れる (それまでは打ち直しが黙って続いていた、改善ループ 104)', () => {
    expect(heartbeatInfo([rep('c', 'failed', 9, 2)], now).problem).toBeUndefined();
    expect(heartbeatInfo([rep('c', 'failed', 11, 2)], now).problem).toMatch(/c.*届けられません.*11 分.*新着 2 件/);
  });

  it('★ 2,000 字を超えない', () => {
    const many = Array.from({ length: 200 }, (_, i) => rep(`team-${i}`, 'blocked', 30, 5));
    expect(JSON.stringify(heartbeatInfo(many, now)).length).toBeLessThanOrEqual(2000);
  });
});
