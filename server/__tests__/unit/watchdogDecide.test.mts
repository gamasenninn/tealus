/**
 * 見張り: 設定の読み込みと判定 (#595、docs/09)
 *
 * ★ 判定は時計を受け取る純関数。★★ 知らせるのは「変わったとき」だけ (§3.2):
 *   正常 → 異常 で 1 回、異常 → 正常 で 1 回。異常が続いても鳴らさない。
 */
import { loadWatchdogsFrom, markFor, type Watch, type RoomQuietWatch, type HttpHealthWatch } from '../../src/services/watchdogs.mts';
import { judgeRoomQuiet, judgeHealth, judgeBackupLog, decideNotice } from '../../src/services/watchdogDecide.mts';

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
  id: 'radio', name: '無線', kind: 'http_health', url: 'http://localhost:9320/api/health',
  services: ['vox', 'transcriber'], enabled: true,
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
    expect(load([callLog, radio, backup]).watches.map((w) => w.kind)).toEqual(['room_quiet', 'http_health', 'backup_log']);
  });

  it('★ 壊れた行は落とすが、必ず warn を返す (黙って減らさない)', () => {
    const r = loadWatchdogsFrom({ notify, watches: [callLog, { ...radio, services: [] }, { ...backup, kind: 'nope' }] });
    expect(r.config!.watches.map((w) => w.id)).toEqual(['call-log']);
    expect(r.warnings).toHaveLength(2);
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

describe('http_health', () => {
  const w = one(radio) as HttpHealthWatch;
  const body = (vox: string, tr: string) => ({ overall: 'degraded', services: { vox, transcriber: tr, assistant: 'unknown' } });

  it('指定したサービスが全部 up なら ok (見ていない assistant は問わない)', () => {
    expect(judgeHealth(w, { status: 200, body: body('up', 'up') }).state).toBe('ok');
  });

  it('1 つでも up でなければ down。どれかを書く', () => {
    const o = judgeHealth(w, { status: 200, body: body('up', 'down') });
    expect(o.state).toBe('down');
    expect(o.detail).toContain('transcriber');
    expect(o.detail).not.toContain('vox');
  });

  it('届かない・200 でない・形が違う は down', () => {
    expect(judgeHealth(w, { error: 'ECONNREFUSED' }).state).toBe('down');
    expect(judgeHealth(w, { status: 502, body: null }).state).toBe('down');
    expect(judgeHealth(w, { status: 200, body: 'html' }).state).toBe('down');
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
  const down = { state: 'down' as const, detail: 'transcriber が up ではありません (down)' };
  const ok = { state: 'ok' as const, detail: 'vox・transcriber とも up' };

  it('正常 → 異常 (前回の知らせ無し) で ⚠ を出す。2 行目に印', () => {
    const d = decideNotice(w, down, null, now);
    expect(d.kind).toBe('alert');
    const lines = d.body!.split('\n');
    expect(lines[0]).toMatch(/^⚠ 無線 が止まっているようです/);
    expect(lines[1]).toBe(markFor('radio'));
    expect(d.body).toContain('transcriber');
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
