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

const ROOM = '00000000-0000-0000-0000-000000000002';
const USER = '00000000-0000-0000-0000-000000000001';
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
      now: jst('2026-08-23T10:42:00'),
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
      now: jst('2026-08-23T10:42:00'), lastFiredAt: null, latestMatchAt: jst('2026-08-23T10:38:00'),
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

/**
 * ★ 初回の基準 (2026-08-23 の dogfood で発覚)
 *
 * 一度も撃っていないトリガーは lastFiredAt が null なので、「前回以降」が
 * **部屋の全履歴**になる。テストE2E で有効化した瞬間、**4 週間前の画像**で発火した。
 * 本番の朝礼で同じことをすると、既に議事録がある動画に対してもう一度撃つ。
 *
 * → 設定ファイルの mtime (= 有効にした時刻) を初回の基準にする。
 *   **有効化より前の出来事では撃たない**、という 1 本の規則にまとめる。
 */
describe('bootstrapAt — 有効化より前の出来事では撃たない', () => {
  test('★ 初回、有効化より前の投稿では撃たない', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T14:04:00'),
      lastFiredAt: null,
      latestMatchAt: jst('2026-07-26T19:03:00'),   // 4 週間前
      bootstrapAt: jst('2026-08-23T14:03:32'),      // 設定を置いた時刻
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('有効化前');
  });

  test('★ 初回でも、有効化より後の投稿なら撃つ', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T14:09:00'),
      lastFiredAt: null,
      latestMatchAt: jst('2026-08-23T14:05:26'),
      bootstrapAt: jst('2026-08-23T14:03:32'),
    });
    expect(d.fire).toBe(true);
  });

  test('一度撃ったあとは bootstrapAt を使わない (前回発火が優先)', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T15:00:00'),
      lastFiredAt: jst('2026-08-23T14:05:29'),
      latestMatchAt: jst('2026-08-23T14:50:00'),
      bootstrapAt: jst('2026-08-23T14:58:00'),   // ★ 設定を触っても既存には効かない
    });
    expect(d.fire).toBe(true);
  });

  test('bootstrapAt が無ければ従来どおり (履歴があれば撃つ)', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T14:04:00'),
      lastFiredAt: null,
      latestMatchAt: jst('2026-07-26T19:03:00'),
      bootstrapAt: null,
    });
    expect(d.fire).toBe(true);
  });

  test('every も同じ (初回は有効化より後の投稿だけ)', () => {
    const t = make({ when: 'every', interval_minutes: 30 });
    const d = decide(t, {
      now: jst('2026-08-23T14:04:00'),
      lastFiredAt: null,
      latestMatchAt: jst('2026-07-26T19:03:00'),
      bootstrapAt: jst('2026-08-23T14:03:32'),
    });
    expect(d.fire).toBe(false);
  });

  test('★ schedule も同じ — 有効化より前の時刻は その日ぶんを撃たない', () => {
    const t = make({ when: 'schedule', at: '08:00', types: undefined });
    const d = decide(t, {
      now: jst('2026-08-23T14:04:00'),
      lastFiredAt: null,
      latestMatchAt: null,
      bootstrapAt: jst('2026-08-23T14:03:32'),   // 08:00 はもう過ぎている
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('有効化前');
  });

  test('schedule — 有効化が指定時刻より前なら その日から撃つ', () => {
    const t = make({ when: 'schedule', at: '08:00', types: undefined });
    const d = decide(t, {
      now: jst('2026-08-23T08:01:00'),
      lastFiredAt: null,
      latestMatchAt: null,
      bootstrapAt: jst('2026-08-23T07:00:00'),
    });
    expect(d.fire).toBe(true);
  });

  test('schedule — 前日に有効化していれば翌日は普通に撃つ', () => {
    const t = make({ when: 'schedule', at: '08:00', types: undefined });
    const d = decide(t, {
      now: jst('2026-08-23T08:01:00'),
      lastFiredAt: null,
      latestMatchAt: null,
      bootstrapAt: jst('2026-08-22T14:00:00'),
    });
    expect(d.fire).toBe(true);
  });
});

/**
 * ★ 静穏待ち (#385)
 *
 * 朝礼は 直近 25 営業日のうち 3 日 (12%) が 動画 2 本以上だった。
 * `immediate` は「前回発火より後に投稿があれば撃つ」なので、2 本の日は 2 回撃つ。
 * 人は 2 本揃うのを待って 1 回打っている (10:38 に 2 本目 → 10:39 に打つ)。
 *
 * → **最後の該当投稿から N 分静かになったら撃つ。** 既定 3 分。
 *   `now − latestMatchAt` は毎周の計算で出るので、**新しい状態を持たない**。
 */
describe('quiet_minutes — 投稿が止まってから撃つ', () => {
  test('★ 既定は 3 分。最後の投稿から 3 分経っていなければ撃たない', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T10:39:00'),
      lastFiredAt: null,
      latestMatchAt: jst('2026-08-23T10:38:00'),   // 1 分前
      bootstrapAt: jst('2026-08-22T00:00:00'),
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('静穏待ち');
  });

  test('★ 3 分経てば撃つ', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T10:41:00'),
      lastFiredAt: null,
      latestMatchAt: jst('2026-08-23T10:38:00'),
      bootstrapAt: jst('2026-08-22T00:00:00'),
    });
    expect(d.fire).toBe(true);
  });

  test('★ 2 本の日: 1 本目で撃たず、2 本目から数え直して 1 回だけ撃つ', () => {
    const t = make();
    const ctx = { lastFiredAt: null, bootstrapAt: jst('2026-08-22T00:00:00') };
    // 10:37 に 1 本目 → 10:38 時点では静穏待ち
    expect(decide(t, { ...ctx, now: jst('2026-08-23T10:38:00'), latestMatchAt: jst('2026-08-23T10:37:00') }).fire)
      .toBe(false);
    // 10:38 に 2 本目 → 10:40 でもまだ静穏待ち (2 本目から数える)
    expect(decide(t, { ...ctx, now: jst('2026-08-23T10:40:00'), latestMatchAt: jst('2026-08-23T10:38:00') }).fire)
      .toBe(false);
    // 10:41.5 で発火。★ 2 本とも対象に入った状態で 1 回だけ
    expect(decide(t, { ...ctx, now: jst('2026-08-23T10:41:30'), latestMatchAt: jst('2026-08-23T10:38:00') }).fire)
      .toBe(true);
  });

  test('quiet_minutes: 0 なら従来どおり即時', () => {
    const d = decide(make({ quiet_minutes: 0 }), {
      now: jst('2026-08-23T10:38:10'),
      lastFiredAt: null,
      latestMatchAt: jst('2026-08-23T10:38:00'),
      bootstrapAt: jst('2026-08-22T00:00:00'),
    });
    expect(d.fire).toBe(true);
  });

  test('明示指定が既定より優先される', () => {
    const d = decide(make({ quiet_minutes: 10 }), {
      now: jst('2026-08-23T10:43:00'),   // 5 分後 = 既定 3 分なら撃つが 10 分なら撃たない
      lastFiredAt: null,
      latestMatchAt: jst('2026-08-23T10:38:00'),
      bootstrapAt: jst('2026-08-22T00:00:00'),
    });
    expect(d.fire).toBe(false);
  });

  test('★ every にも効く (待ち処理は immediate 固有ではない)', () => {
    const t = make({ when: 'every', interval_minutes: 30, quiet_minutes: 3 });
    const d = decide(t, {
      now: jst('2026-08-23T11:00:00'),
      lastFiredAt: jst('2026-08-23T10:00:00'),
      latestMatchAt: jst('2026-08-23T10:59:00'),   // 1 分前
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('静穏待ち');
  });

  test('★ 「発火済み」が先に出る (新しい投稿が無いのに静穏待ちと言わない)', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T10:38:30'),
      lastFiredAt: jst('2026-08-23T10:38:00'),
      latestMatchAt: jst('2026-08-23T10:37:00'),
    });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('発火済み');
  });

  test('★ 「投稿なし」が先に出る', () => {
    const d = decide(make(), { now: jst('2026-08-23T10:38:00'), lastFiredAt: null, latestMatchAt: null });
    expect(d.reason).toContain('投稿なし');
  });

  test('schedule には効かない (時刻で撃つので静穏の概念が無い)', () => {
    const t = make({ when: 'schedule', at: '08:00', types: undefined, quiet_minutes: 60 });
    const d = decide(t, { now: jst('2026-08-23T08:01:00'), lastFiredAt: null, latestMatchAt: null });
    expect(d.fire).toBe(true);
  });

  test('待っている間も理由に残り時間が出る (沈黙にしない)', () => {
    const d = decide(make(), {
      now: jst('2026-08-23T10:39:00'), lastFiredAt: null, latestMatchAt: jst('2026-08-23T10:38:00'),
    });
    expect(d.reason).toMatch(/静穏待ち.*\d/);
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
      now: jst('2026-08-23T10:42:00'), lastFiredAt: null, latestMatchAt: jst('2026-08-23T10:38:00'),
    });
    expect(d.reason.length).toBeGreaterThan(0);
  });
});
