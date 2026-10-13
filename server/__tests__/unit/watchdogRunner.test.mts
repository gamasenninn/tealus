/**
 * 見張り: 1 周の配線 (#595、docs/09)
 *
 * ★ DB・HTTP・ファイルは注入する。ここで確かめるのは「見方ごとに正しい観測を渡し、
 *   変わったときだけ業務メモへ投稿し、1 行の失敗が他を止めない」こと。
 */
import { loadWatchdogsFrom, markFor } from '../../src/services/watchdogs.mts';
import { runOnce, type RunDeps } from '../../src/services/watchdogRunner.mts';

const NOTIFY_ROOM = '00000000-0000-0000-0000-000000000009';
const USER = '00000000-0000-0000-0000-000000000001';
const BOT = '00000000-0000-0000-0000-000000000003';
const jst = (s: string) => new Date(`${s}+09:00`);
const NOW = jst('2026-10-13T12:00:00');

const config = loadWatchdogsFrom({
  notify: { room_id: NOTIFY_ROOM, room: '業務メモ', as_user_id: USER },
  watches: [
    { id: 'backup', name: 'バックアップ', kind: 'backup_log', dir: 'X:\\logs', enabled: true },
    { id: 'call-log', name: '通話履歴', kind: 'room_quiet', room_id: '00000000-0000-0000-0000-000000000002', room: '通話履歴',
      from_user_ids: [BOT], max_quiet_minutes: 150, hours: '09:00-17:00', days: 'mon,tue,thu,fri,sat,sun', enabled: true },
    { id: 'radio', name: '無線', kind: 'heartbeat', heartbeat: 'radio-sender', from_user_id: BOT, max_silence_minutes: 10, enabled: true },
    { id: 'off', name: '止めた行', kind: 'heartbeat', heartbeat: 'off', from_user_id: BOT, max_silence_minutes: 10, enabled: false },
  ],
}).config!;

const OK_LOG = { name: 'backup-20261013.log', content: '=== 終了: 成功 ===', mtime: jst('2026-10-13T03:00:25') };

function deps(over: Partial<RunDeps> = {}): RunDeps & { posts: { roomId: string; content: string }[] } {
  const posts: { roomId: string; content: string }[] = [];
  return {
    now: NOW,
    lastNotice: async () => null,
    lastPostAt: async () => jst('2026-10-13T11:50:00'),
    heartbeatOf: async () => ({ last_seen: jst('2026-10-13T11:59:00'), info: {} }),
    readBackup: () => ({ latest: OK_LOG }),
    resolveSender: async () => ({ id: USER, display_name: 'Claude', avatar_url: null }),
    post: async (input) => { posts.push({ roomId: input.roomId, content: input.content }); return { ok: true, messageId: 'm' } as never; },
    ...over,
    posts,
  };
}

describe('runOnce', () => {
  it('全部正常なら何も投稿しない。止めた行は見ない', async () => {
    const fetched: string[] = [];
    const d = deps({ heartbeatOf: async (w) => { fetched.push(w.heartbeat); return { last_seen: jst('2026-10-13T11:59:00'), info: {} }; } });
    const r = await runOnce(config, d);
    expect(d.posts).toEqual([]);
    expect(fetched).toEqual(['radio-sender']);
    expect(r.map((x) => [x.id, x.state])).toEqual([['backup', 'ok'], ['call-log', 'ok'], ['radio', 'ok']]);
  });

  it('止まったものだけ、業務メモに ⚠ を投稿する', async () => {
    const d = deps({ heartbeatOf: async () => null });
    const r = await runOnce(config, d);
    expect(d.posts).toHaveLength(1);
    expect(d.posts[0].roomId).toBe(NOTIFY_ROOM);
    expect(d.posts[0].content).toContain(markFor('radio'));
    expect(r.find((x) => x.id === 'radio')!.posted).toBe('alert');
  });

  it('★ 前回の ⚠ が残っていれば、止まったままでも投稿しない (再起動しても 2 度鳴らない)', async () => {
    const d = deps({
      heartbeatOf: async () => null,
      lastNotice: async (w) => (w.id === 'radio' ? { kind: 'alert', at: jst('2026-10-13T11:00:00') } : null),
    });
    await runOnce(config, d);
    expect(d.posts).toEqual([]);
  });

  it('戻ったら ✅ を投稿する', async () => {
    const d = deps({ lastNotice: async (w) => (w.id === 'radio' ? { kind: 'alert', at: jst('2026-10-13T11:30:00') } : null) });
    await runOnce(config, d);
    expect(d.posts).toHaveLength(1);
    expect(d.posts[0].content).toMatch(/^✅ 無線 が戻りました \(約 30 分止まっていました\)/);
  });

  it('room_quiet には部屋と送り手を、heartbeat には名前と送り手を、backup_log には置き場を渡す', async () => {
    const seen: unknown[] = [];
    const d = deps({
      heartbeatOf: async (w) => { seen.push([w.heartbeat, w.from_user_id]); return { last_seen: jst('2026-10-13T11:59:00'), info: {} }; },
      lastPostAt: async (w) => { seen.push([w.room_id, w.from_user_ids]); return jst('2026-10-13T11:50:00'); },
      readBackup: (dir) => { seen.push(dir); return { latest: OK_LOG }; },
    });
    await runOnce(config, d);
    expect(seen).toEqual(['X:\\logs', ['00000000-0000-0000-0000-000000000002', [BOT]], ['radio-sender', BOT]]);
  });

  it('★ 1 行の失敗が他の行を止めない。失敗は error に残し、投稿しない', async () => {
    const d = deps({
      lastPostAt: async () => { throw new Error('DB に届きません'); },
      heartbeatOf: async () => null,
    });
    const r = await runOnce(config, d);
    expect(r.find((x) => x.id === 'call-log')!.error).toContain('DB に届きません');
    expect(d.posts).toHaveLength(1); // radio の ⚠ は出る
  });

  it('投稿に失敗したら error に残す (次の周でもう一度試す = 前回の ⚠ が無いので)', async () => {
    const d = deps({
      heartbeatOf: async () => null,
      post: async () => ({ ok: false, reason: 'ルームが見つかりません' }) as never,
    });
    const r = await runOnce(config, d);
    const radio = r.find((x) => x.id === 'radio')!;
    expect(radio.posted).toBeNull();
    expect(radio.error).toContain('ルームが見つかりません');
  });

  it('投稿者が見つからなければ投稿せず error', async () => {
    const d = deps({ heartbeatOf: async () => null, resolveSender: async () => null });
    const r = await runOnce(config, d);
    expect(r.find((x) => x.id === 'radio')!.error).toContain(USER);
    expect(d.posts).toEqual([]);
  });
});
