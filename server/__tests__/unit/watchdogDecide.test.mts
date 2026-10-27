/**
 * 見張り: 設定の読み込みと判定 (#595、docs/09)
 *
 * ★ 判定は時計を受け取る純関数。★★ 知らせるのは「変わったとき」だけ (§3.2):
 *   正常 → 異常 で 1 回、異常 → 正常 で 1 回。異常が続いても鳴らさない。
 */
import { loadWatchdogsFrom, markFor, type Watch, type RoomQuietWatch, type HeartbeatWatch } from '../../src/services/watchdogs.mts';
import { judgeRoomQuiet, judgeHeartbeat, judgeBackupLog, judgePushReach, decideNotice } from '../../src/services/watchdogDecide.mts';

const ROOM = '00000000-0000-0000-0000-000000000002';
const USER = '00000000-0000-0000-0000-000000000001';
const BOT = '00000000-0000-0000-0000-000000000003';
const jst = (s: string) => new Date(`${s}+09:00`);

const notify = { room_id: ROOM, room: '業務メモ', as_user_id: USER };
const callLog = {
  id: 'call-log', name: '通話履歴の取り込み', kind: 'room_quiet', room_id: ROOM, room: '通話履歴',
  from_user_ids: [BOT], max_quiet_minutes: 150, hours: '09:00-17:00', days: 'mon,tue,thu,fri,sat,sun', enabled: true,
};
const radio = {
  id: 'radio', name: '無線', kind: 'heartbeat', heartbeat: 'radio-sender', from_user_id: BOT,
  max_silence_minutes: 10, max_send_lag_minutes: 15, enabled: true,
};
const backup = { id: 'backup', name: 'バックアップ', kind: 'backup_log', dir: 'S:\\tealus-bak\\logs', enabled: true };

function load(watches: unknown[]) {
  const r = loadWatchdogsFrom({ notify, watches });
  if (r.warnings.length) throw new Error(`設定が不正: ${r.warnings.join()}`);
  return r.config!;
}
const one = (w: Record<string, unknown>): Watch => load([w]).watches[0];

describe('設定の読み込み', () => {
  it('3 種類を読める', () => {
    expect(load([callLog, radio, backup]).watches.map((w) => w.kind)).toEqual(['room_quiet', 'heartbeat', 'backup_log']);
  });

  it('★ 壊れた行は落とすが、必ず warn を返す (黙って減らさない)', () => {
    const r = loadWatchdogsFrom({ notify, watches: [callLog, { ...radio, max_silence_minutes: 0 }, { ...backup, kind: 'nope' }] });
    expect(r.config!.watches.map((w) => w.id)).toEqual(['call-log']);
    expect(r.warnings).toHaveLength(2);
  });

  it('★ 相手の決めた形を読む http_health は、もう受け付けない (docs/09 §0)', () => {
    const r = loadWatchdogsFrom({ notify, watches: [{ id: 'x', name: 'x', kind: 'http_health', url: 'http://localhost:9320/api/health', services: ['vox'] }] });
    expect(r.config!.watches).toEqual([]);
    expect(r.warnings[0]).toContain('http_health');
  });

  it('鼓動: 名前・送り手・閾値が要る。送り込みの遅れの閾値は省略できる', () => {
    expect(loadWatchdogsFrom({ notify, watches: [{ ...radio, heartbeat: 'a b' }] }).warnings).toHaveLength(1);
    expect(loadWatchdogsFrom({ notify, watches: [{ ...radio, from_user_id: 'x' }] }).warnings).toHaveLength(1);
    const { max_send_lag_minutes: _drop, ...noLag } = radio;
    expect((one(noLag) as HeartbeatWatch).max_send_lag_minutes).toBeUndefined();
  });

  it('稼働時間・曜日の書き間違いは warn', () => {
    expect(loadWatchdogsFrom({ notify, watches: [{ ...callLog, hours: '9-17' }] }).warnings).toHaveLength(1);
    expect(loadWatchdogsFrom({ notify, watches: [{ ...callLog, days: 'mon,xyz' }] }).warnings).toHaveLength(1);
  });

  it('★ id の重複は後の行を落とす (印から前回の状態を引けなくなる)', () => {
    const r = loadWatchdogsFrom({ notify, watches: [radio, { ...radio, name: '二つ目' }] });
    expect(r.config!.watches).toHaveLength(1);
    expect(r.warnings[0]).toContain('重複');
  });

  it('notify が無ければ全体を使わない (知らせる先が無い)', () => {
    const r = loadWatchdogsFrom({ watches: [radio] });
    expect(r.config).toBeNull();
    expect(r.warnings[0]).toContain('notify');
  });

  it('印はルームトリガーと別の語 (トリガーの「前回撃った時刻」に混ざらない)', () => {
    expect(markFor('radio')).toBe('— 見張り (watchdogs: radio)');
    expect(markFor('radio')).not.toContain('room-triggers');
  });
});

describe('room_quiet', () => {
  const w = one(callLog) as RoomQuietWatch;

  it('稼働時間の中で、最後の投稿から閾値以内なら ok', () => {
    expect(judgeRoomQuiet(w, jst('2026-10-13T10:00:00'), jst('2026-10-13T12:00:00')).state).toBe('ok');
  });

  it('閾値を超えたら down。最後の投稿の時刻を添える', () => {
    const o = judgeRoomQuiet(w, jst('2026-10-13T09:30:00'), jst('2026-10-13T12:01:00'));
    expect(o.state).toBe('down');
    expect(o.detail).toContain('150 分');
    expect(o.detail).toContain('10-13 09:30');
  });

  it('★ 稼働時間に入ったら稼働開始から数える (前夜の投稿から数えると毎朝鳴る)', () => {
    expect(judgeRoomQuiet(w, jst('2026-10-12T16:55:00'), jst('2026-10-13T11:00:00')).state).toBe('ok');
    expect(judgeRoomQuiet(w, jst('2026-10-12T16:55:00'), jst('2026-10-13T11:31:00')).state).toBe('down');
  });

  it('稼働時間の外・定休日は判定しない (skip)', () => {
    expect(judgeRoomQuiet(w, null, jst('2026-10-13T20:00:00')).state).toBe('skip');
    expect(judgeRoomQuiet(w, null, jst('2026-10-13T08:59:00')).state).toBe('skip');
    expect(judgeRoomQuiet(w, null, jst('2026-10-14T12:00:00')).state).toBe('skip'); // 水曜
  });

  it('投稿が 1 件も無ければ、稼働開始から数える', () => {
    expect(judgeRoomQuiet(w, null, jst('2026-10-13T11:00:00')).state).toBe('ok');
    const o = judgeRoomQuiet(w, null, jst('2026-10-13T11:31:00'));
    expect(o.state).toBe('down');
    expect(o.detail).toContain('なし');
  });
});

describe('heartbeat', () => {
  const w = one(radio) as HeartbeatWatch;
  const now = jst('2026-10-13T12:00:00');
  const hb = (lastSeen: string, info: Record<string, unknown> = {}) => ({ last_seen: jst(lastSeen), info });

  it('鼓動が閾値以内に来ていれば ok', () => {
    expect(judgeHeartbeat(w, hb('2026-10-13T11:59:00'), now).state).toBe('ok');
  });

  it('鼓動が閾値を超えて来なければ down。最後の時刻を添える', () => {
    const o = judgeHeartbeat(w, hb('2026-10-13T11:49:00'), now);
    expect(o.state).toBe('down');
    expect(o.detail).toContain('10 分');
    expect(o.detail).toContain('10-13 11:49');
  });

  it('一度も来ていなければ down (★ 見ていないものを正常と言わない)', () => {
    const o = judgeHeartbeat(w, null, now);
    expect(o.state).toBe('down');
    expect(o.detail).toContain('一度も');
  });

  it('★ 鼓動は来ていても、最新のファイルを送っていなければ down (生きているが働いていない)', () => {
    const o = judgeHeartbeat(w, hb('2026-10-13T11:59:00', {
      latest_file_at: jst('2026-10-13T11:40:00').toISOString(),
      last_sent_at: jst('2026-10-13T11:20:00').toISOString(),
    }), now);
    expect(o.state).toBe('down');
    expect(o.detail).toContain('送っていません');
  });

  it('遅れが閾値以内・時刻が無い・壊れている は遅れとして扱わない', () => {
    const fresh = '2026-10-13T11:59:00';
    expect(judgeHeartbeat(w, hb(fresh, {
      latest_file_at: jst('2026-10-13T11:40:00').toISOString(), last_sent_at: jst('2026-10-13T11:30:00').toISOString(),
    }), now).state).toBe('ok');
    expect(judgeHeartbeat(w, hb(fresh, { latest_file_at: 'x', last_sent_at: null }), now).state).toBe('ok');
  });

  it('遅れの閾値を書いていなければ、遅れは見ない', () => {
    const { max_send_lag_minutes: _drop, ...noLag } = radio;
    const w2 = one(noLag) as HeartbeatWatch;
    expect(judgeHeartbeat(w2, hb('2026-10-13T11:59:00', {
      latest_file_at: jst('2026-10-13T11:40:00').toISOString(), last_sent_at: jst('2026-10-13T10:00:00').toISOString(),
    }), now).state).toBe('ok');
  });
});

describe('backup_log', () => {
  it('ok なら ok、それ以外は down', () => {
    expect(judgeBackupLog({ kind: 'ok', name: 'backup-20261013.log', hours: 8 }).state).toBe('ok');
    expect(judgeBackupLog({ kind: 'bad', name: 'backup-20261011.log', hours: 56, why: '26 時間より古い' }).state).toBe('down');
    expect(judgeBackupLog({ kind: 'none' }).state).toBe('down');
    expect(judgeBackupLog({ kind: 'read-error', error: 'EACCES' }).detail).toContain('EACCES');
  });
});

describe('decideNotice — 変わったときだけ知らせる', () => {
  const w = one(radio);
  const now = jst('2026-10-13T12:00:00');
  const down = { state: 'down' as const, detail: '鼓動が 10 分を超えて来ていません (最後の鼓動: 10-13 11:40)' };
  const ok = { state: 'ok' as const, detail: '鼓動が来ています (最後の鼓動: 10-13 12:00)' };

  it('正常 → 異常 (前回の知らせ無し) で ⚠ を出す。2 行目に印', () => {
    const d = decideNotice(w, down, null, now);
    expect(d.kind).toBe('alert');
    const lines = d.body!.split('\n');
    expect(lines[0]).toMatch(/^⚠ 無線 が止まっているようです/);
    expect(lines[1]).toBe(markFor('radio'));
    expect(d.body).toContain('鼓動が 10 分');
  });

  it('★ 異常が続いても鳴らさない (前回が ⚠)', () => {
    expect(decideNotice(w, down, { kind: 'alert', at: jst('2026-10-13T11:00:00') }, now).kind).toBeNull();
  });

  it('異常 → 正常 で ✅ を出す。止まっていた時間を添える', () => {
    const d = decideNotice(w, ok, { kind: 'alert', at: jst('2026-10-13T10:35:00') }, now);
    expect(d.kind).toBe('recover');
    expect(d.body!.split('\n')[0]).toBe('✅ 無線 が戻りました (約 1 時間 25 分止まっていました)');
    expect(d.body!.split('\n')[1]).toBe(markFor('radio'));
  });

  it('正常が続く・前回が ✅ で正常 は何もしない', () => {
    expect(decideNotice(w, ok, null, now).kind).toBeNull();
    expect(decideNotice(w, ok, { kind: 'recover', at: now }, now).kind).toBeNull();
  });

  it('前回 ✅ のあとにまた止まったら、もう一度 ⚠', () => {
    expect(decideNotice(w, down, { kind: 'recover', at: jst('2026-10-13T11:00:00') }, now).kind).toBe('alert');
  });

  it('skip は状態を変えない (⚠ のまま夜を越す)', () => {
    const skip = { state: 'skip' as const, detail: '稼働時間の外' };
    expect(decideNotice(w, skip, { kind: 'alert', at: now }, now).kind).toBeNull();
    expect(decideNotice(w, skip, null, now).kind).toBeNull();
  });
});

// ★ 4 つ目の見方 push_reach (docs/09 §3.6、2026-10-16): 通知の宛先が 0 本の人
describe('push_reach — 設定', () => {
  const pushWatch = { id: 'push', name: 'プッシュ通知', kind: 'push_reach', enabled: true };

  it('日数と外す人は省略できる (既定 30 日・外す人なし)', () => {
    const w = one(pushWatch);
    expect(w).toMatchObject({ kind: 'push_reach', active_within_days: 30, exclude_user_ids: [] });
  });

  it('日数が正の数でない・外す人が UUID の配列でないのは warn', () => {
    expect(loadWatchdogsFrom({ notify, watches: [{ ...pushWatch, active_within_days: 0 }] }).warnings[0]).toContain('active_within_days');
    expect(loadWatchdogsFrom({ notify, watches: [{ ...pushWatch, exclude_user_ids: ['x'] }] }).warnings[0]).toContain('exclude_user_ids');
  });
});

describe('push_reach — 判定 (人ごと)', () => {
  const now = jst('2026-10-16T13:00:00');
  const target = {
    user_id: USER, display_name: '田中', active_subs: 0, total_subs: 1,
    last_lost_at: jst('2026-10-13T15:18:00'), last_read_at: jst('2026-10-16T09:00:00'),
  };

  it('有効な宛先が 1 本以上なら ok', () => {
    expect(judgePushReach({ ...target, active_subs: 1 }, 30, now).state).toBe('ok');
  });

  it('★ 0 本なら down。最後の宛先が無効になった時刻と、直し方を添える', () => {
    const o = judgePushReach(target, 30, now);
    expect(o.state).toBe('down');
    expect(o.detail).toContain('10-13 15:18');
    expect(o.detail).toContain('この端末で通知を受け取る');
  });

  it('★ ログアウトで外した宛先は行ごと消えて時刻が残らない。そう読めるように書く (2026-10-27 改善ループ 17 回目)', () => {
    // 田中太郎さん: 00:00 に 1 本が 410、00:04 のログアウトでもう 1 本が消えた。便は「最後の宛先が無効になったのは 00:00」と言っていた
    const o = judgePushReach(target, 30, now);
    expect(o.detail).not.toContain('最後の宛先が無効になったのは');
    expect(o.detail).toContain('ログアウト');
    const never = judgePushReach({ ...target, total_subs: 0, last_lost_at: null }, 30, now);
    expect(never.detail).toContain('ログアウト');
  });

  it('★ 無効になった時刻が分からない (10-16 以前の行) ときは時刻を書かない', () => {
    const o = judgePushReach({ ...target, last_lost_at: null }, 30, now);
    expect(o.state).toBe('down');
    expect(o.detail).toContain('以前の宛先はすべて無効');
    expect(o.detail).not.toContain('一度も');
  });

  it('一度も登録が無ければ、そう書く', () => {
    const o = judgePushReach({ ...target, total_subs: 0, last_lost_at: null }, 30, now);
    expect(o.state).toBe('down');
    expect(o.detail).toContain('一度も');
  });

  it('★ 直近の日数に何も読んでいない人は判定しない (知らせても本人が見ない)', () => {
    expect(judgePushReach({ ...target, last_read_at: jst('2026-09-10T09:00:00') }, 30, now).state).toBe('skip');
    expect(judgePushReach({ ...target, last_read_at: null }, 30, now).state).toBe('skip');
  });
});
