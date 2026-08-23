/**
 * ルームトリガー: 撃つ / 撃たない の判定 (#382 第 1 段)
 *
 * ★ この関数は時計を受け取る (docs/06 §6「テストで時計を注入できる形にする」)。
 * ★★ **必ず reason を返す。** 「撃たなかった」が記録に残らないと、
 *   議事録が来ていないときに「動画が無かった」のか「壊れて動いていない」のかが
 *   区別できない —— この機能でいちばん忘れられやすい部分 (docs/06 §6)。
 */
import { decide } from '../../src/services/roomTriggerDecide.mts';
import { loadTriggersFrom } from '../../src/services/roomTriggers.mts';

const ROOM = 'c698839a-25fb-44e3-9646-d71fce43cdc5';
const USER = '353c1076-5241-4542-bca8-9b259c47e5de';
const base = {
  id: 't', room_id: ROOM, room: '朝礼', types: ['video'], when: 'immediate',
  message: 'go', as_user_id: USER, enabled: true, description: '',
};

function make(over: Record<string, unknown> = {}) {
  const { triggers, warnings } = loadTriggersFrom([{ ...base, ...over }]);
  if (warnings.length) throw new Error(`設定が不正: ${warnings.join()}`);
  return triggers[0];
}

/** JST の時刻を Date に (テストの見た目を実運用の時間帯に合わせる) */
const jst = (s: string) => new Date(`${s}+09:00`);

describe('immediate', () => {
  const t = make();

  test('前回発火より後に該当種別が来ていたら撃つ', () => {
    const d = decide(t, {
      now: jst('2026-08-23T10:40:00'),
      lastFiredAt: jst('2026-08-22T10:40:00'),
      latestMatchAt: jst('2026-08-23T10:38:00'),
    });
    expect(d.fire).toBe(true);
  });

  test('★ 同じ元メッセージで二度撃たない (前回発火より前のものは無視)', () => {
    const d = decide(t, {
      now: jst('2026-08-23T10:45:00'),
      lastFiredAt: jst('2026-08-23T10:39:00'),
      latestMatchAt: jst('2026-08-23T10:38:00'),
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('発火済み');
  });

  test('一度も撃っていなければ、該当種別があれば撃つ', () => {
    const d = decide(t, {
      now: jst('2026-08-23T10:40:00'), lastFiredAt: null, latestMatchAt: jst('2026-08-23T10:38:00'),
    });
    expect(d.fire).toBe(true);
  });

  test('該当種別が 1 件も無ければ撃たない — 理由が「投稿なし」であること', () => {
    const d = decide(t, { now: jst('2026-08-23T10:40:00'), lastFiredAt: null, latestMatchAt: null });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('投稿なし');
  });
});

describe('every', () => {
  const t = make({ when: 'every', interval_minutes: 30 });

  test('前回発火から interval を過ぎ、その間に投稿があれば撃つ', () => {
    const d = decide(t, {
      now: jst('2026-08-23T11:00:00'),
      lastFiredAt: jst('2026-08-23T10:29:00'),
      latestMatchAt: jst('2026-08-23T10:50:00'),
    });
    expect(d.fire).toBe(true);
  });

  test('interval 内なら撃たない', () => {
    const d = decide(t, {
      now: jst('2026-08-23T10:40:00'),
      lastFiredAt: jst('2026-08-23T10:29:00'),
      latestMatchAt: jst('2026-08-23T10:35:00'),
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('間隔');
  });

  test('★ 3 時間止まっていても 1 回だけ撃つ (溜まった回数ぶん連射しない)', () => {
    const d = decide(t, {
      now: jst('2026-08-23T14:00:00'),
      lastFiredAt: jst('2026-08-23T11:00:00'),
      latestMatchAt: jst('2026-08-23T12:00:00'),
    });
    expect(d.fire).toBe(true);
    // 判定は 1 回ぶんの真偽しか返さない = 連射する余地が無い
    expect(d).not.toHaveProperty('times');
  });

  test('interval を過ぎていても、その間に投稿が無ければ撃たない', () => {
    const d = decide(t, {
      now: jst('2026-08-23T14:00:00'),
      lastFiredAt: jst('2026-08-23T11:00:00'),
      latestMatchAt: jst('2026-08-23T10:00:00'),
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('投稿なし');
  });
});

describe('schedule', () => {
  const t = make({ when: 'schedule', at: '08:00', types: undefined });

  test('★ 時刻は JST で判定する', () => {
    // 2026-08-22T23:30Z = JST 8/23 08:30 → 過ぎている
    const d = decide(t, { now: new Date('2026-08-22T23:30:00Z'), lastFiredAt: null, latestMatchAt: null });
    expect(d.fire).toBe(true);
  });

  test('指定時刻より前なら撃たない', () => {
    const d = decide(t, { now: jst('2026-08-23T07:59:00'), lastFiredAt: null, latestMatchAt: null });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('時刻前');
  });

  test('その日すでに撃っていれば撃たない', () => {
    const d = decide(t, {
      now: jst('2026-08-23T09:00:00'), lastFiredAt: jst('2026-08-23T08:00:10'), latestMatchAt: null,
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('発火済み');
  });

  test('前日に撃っていても、今日はまだなので撃つ', () => {
    const d = decide(t, {
      now: jst('2026-08-23T08:01:00'), lastFiredAt: jst('2026-08-22T08:00:05'), latestMatchAt: null,
    });
    expect(d.fire).toBe(true);
  });

  test('★ 大きく遅れた復帰でも撃つのは 1 回だけ (その日ぶん)', () => {
    const d = decide(t, {
      now: jst('2026-08-23T11:20:00'), lastFiredAt: jst('2026-08-22T08:00:00'), latestMatchAt: null,
    });
    expect(d.fire).toBe(true);
  });

  test('★ JST の日付境界をまたぐ — 前日 23:50 に撃っていても 00:10 の今日ぶんは別', () => {
    const t0 = make({ when: 'schedule', at: '00:05', types: undefined });
    const d = decide(t0, {
      now: jst('2026-08-23T00:10:00'), lastFiredAt: jst('2026-08-22T23:50:00'), latestMatchAt: null,
    });
    expect(d.fire).toBe(true);
  });
});

describe('共通', () => {
  test('★ enabled: false は撃たない。理由も残す', () => {
    const d = decide(make({ enabled: false }), {
      now: jst('2026-08-23T10:40:00'), lastFiredAt: null, latestMatchAt: jst('2026-08-23T10:38:00'),
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('無効');
  });

  test('★ 撃たないときも必ず reason が空でない', () => {
    const cases = [
      decide(make(), { now: jst('2026-08-23T10:40:00'), lastFiredAt: null, latestMatchAt: null }),
      decide(make({ enabled: false }), { now: jst('2026-08-23T10:40:00'), lastFiredAt: null, latestMatchAt: null }),
    ];
    for (const d of cases) expect(d.reason.length).toBeGreaterThan(0);
  });

  test('撃つときも reason を返す (発火の記録にそのまま使える)', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T10:40:00'), lastFiredAt: null, latestMatchAt: jst('2026-08-23T10:38:00'),
    });
    expect(d.reason.length).toBeGreaterThan(0);
  });
});
