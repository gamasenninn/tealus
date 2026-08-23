/**
 * ルームトリガー: 設定の読み込みと検証 (#382 第 1 段)
 *
 * ★ 設計書 docs/06 §6 の「外せない条件」をここで固定する。
 *   とくに **黙って減らさない** —— 壊れた行を無視するなら必ず warn を出す。
 *   「設定したのに動かない」が沈黙になると、この機能はいちばん困る形で壊れる。
 */
import { buildBody, loadTriggersFrom, markFor } from '../../src/services/roomTriggers.mts';

const ROOM = '00000000-0000-0000-0000-000000000002';
const USER = '00000000-0000-0000-0000-000000000001';

const valid = {
  id: 'chourei-gijiroku',
  room_id: ROOM,
  room: '朝礼',
  types: ['video'],
  when: 'immediate',
  message: '@アシスタント /light この動画から議事録を作成して',
  as_user_id: USER,
  enabled: true,
  description: '動画が上がったら議事録を作る',
};

describe('loadTriggersFrom', () => {
  test('正しい設定を読める', () => {
    const { triggers, warnings } = loadTriggersFrom([valid]);
    expect(warnings).toEqual([]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].id).toBe('chourei-gijiroku');
  });

  test('★ types に text があれば その行を落とす (ループ防止の本体)', () => {
    const { triggers, warnings } = loadTriggersFrom([{ ...valid, types: ['video', 'text'] }]);
    expect(triggers).toHaveLength(0);
    expect(warnings.join()).toContain('text');
  });

  test('★ 落とすときは必ず warn を出す (黙って減らさない)', () => {
    const { warnings } = loadTriggersFrom([{ ...valid, id: undefined }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('id');
  });

  test('★ 壊れた行があっても、他の行は生きる', () => {
    const other = { ...valid, id: 'other', room_id: '00000000-0000-0000-0000-000000000003' };
    const { triggers, warnings } = loadTriggersFrom([{ ...valid, types: ['text'] }, other]);
    expect(triggers.map((t) => t.id)).toEqual(['other']);
    expect(warnings).toHaveLength(1);
  });

  test('★ 設定した人と名義が同じであること — as_user_id が無ければ落とす', () => {
    const { triggers, warnings } = loadTriggersFrom([{ ...valid, as_user_id: undefined }]);
    expect(triggers).toHaveLength(0);
    expect(warnings[0]).toContain('as_user_id');
  });

  test('enabled: false は読むが、撃たない印を付けて残す (消すのと止めるのは別)', () => {
    const { triggers } = loadTriggersFrom([{ ...valid, enabled: false }]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].enabled).toBe(false);
  });

  test('★ id が重複していたら後の行を落として warn (印が引けなくなる)', () => {
    const { triggers, warnings } = loadTriggersFrom([valid, { ...valid, room: '別' }]);
    expect(triggers).toHaveLength(1);
    expect(warnings[0]).toContain('重複');
  });

  test('配列でなければ 全部落として warn (起動は止めない)', () => {
    const { triggers, warnings } = loadTriggersFrom({ nope: true });
    expect(triggers).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  test('when が 3 種類のどれでもなければ落とす', () => {
    const { warnings } = loadTriggersFrom([{ ...valid, when: 'sometimes' }]);
    expect(warnings[0]).toContain('when');
  });

  test('every は interval_minutes が要る', () => {
    const { warnings } = loadTriggersFrom([{ ...valid, when: 'every', interval_minutes: undefined }]);
    expect(warnings[0]).toContain('interval_minutes');
  });

  test('schedule は at (HH:MM) が要る', () => {
    const { warnings } = loadTriggersFrom([{ ...valid, when: 'schedule', at: '8時' }]);
    expect(warnings[0]).toContain('at');
  });

  test('schedule は types を要求しない (時刻だけで撃つ)', () => {
    const { triggers, warnings } = loadTriggersFrom([
      { ...valid, when: 'schedule', at: '08:00', types: undefined },
    ]);
    expect(warnings).toEqual([]);
    expect(triggers).toHaveLength(1);
  });

  test('immediate / every は types が要る', () => {
    const { warnings } = loadTriggersFrom([{ ...valid, types: [] }]);
    expect(warnings[0]).toContain('types');
  });
});

describe('buildBody — 自動投稿の印', () => {
  const { triggers } = loadTriggersFrom([valid]);
  const t = triggers[0];

  test('1 行目は message そのまま (mention の先頭判定を壊さない)', () => {
    expect(buildBody(t).split('\n')[0]).toBe(valid.message);
  });

  test('★ 印は 2 行目。接頭辞にしない', () => {
    expect(buildBody(t).split('\n')[1]).toBe('— 自動投稿 (room-triggers: chourei-gijiroku)');
  });

  test('★ 印に入るのは id (ルーム名ではない)', () => {
    expect(buildBody(t)).not.toContain('朝礼');
  });

  test('markFor は 前回発火を引くための検索文字列を返す', () => {
    expect(buildBody(t)).toContain(markFor('chourei-gijiroku'));
  });
});
