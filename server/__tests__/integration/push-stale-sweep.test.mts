import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { deactivateStaleSubscriptions, deleteOldInactiveSubscriptions } from '../../src/services/push.mts';

/**
 * 30 日送り直されない通知の宛先を外す (2026-10-16、改善ループ 7 回目の 3)
 *
 * ★ 画面はログイン・起動・表に出たとき (6 時間に 1 回まで) に宛先を送り直し、本体は updated_at を進める。
 *   送り直されない宛先は、入れ直し・別のブラウザなどで置き去りになったもの (開発者 1 人に有効 9 本、1 回の通知で 9〜12 本送っていた)。
 * ★ 外しても、その端末で開き直せば送り直しで戻る (routes/push.mts の is_active = true)。
 */
describe('deactivateStaleSubscriptions', () => {
  type TestUser = Awaited<ReturnType<typeof createTestUser>>;
  let user: TestUser;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    user = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
  });

  async function sub(endpoint: string, daysAgo: number, active = true) {
    await getTestPool().query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, is_active, created_at, updated_at)
       VALUES ($1, $2, 'p', 'a', $3, now() - make_interval(days => $4), now() - make_interval(days => $4))`,
      [user.user.id, endpoint, active, daysAgo],
    );
  }
  async function state() {
    const { rows } = await getTestPool().query<{ endpoint: string; is_active: boolean; fresh: boolean }>(
      `SELECT endpoint, is_active, updated_at > now() - interval '1 minute' AS fresh FROM push_subscriptions ORDER BY endpoint`,
    );
    return rows;
  }

  it('★ 30 日より前から送り直されていない宛先だけ外し、外した時刻を残す', async () => {
    await sub('https://e/old', 31);
    await sub('https://e/recent', 29);
    const n = await deactivateStaleSubscriptions(30);
    expect(n).toBe(1);
    expect(await state()).toEqual([
      { endpoint: 'https://e/old', is_active: false, fresh: true },
      { endpoint: 'https://e/recent', is_active: true, fresh: false },
    ]);
  });

  it('すでに外れている宛先は触らない (外れた時刻を書き換えない)', async () => {
    await sub('https://e/gone', 60, false);
    expect(await deactivateStaleSubscriptions(30)).toBe(0);
    expect((await state())[0].fresh).toBe(false);
  });

  // ★ 2026-10-27 小野さん判断 (承認 13): 毎日使っている人 (西村さん) の唯一の宛先を、古い版の画面が送り直さないため外していた。
  //   その宛先には 14 日で 1,483 回送っていて失敗は無かった。置き去りの宛先を外す目的は、残りがある人だけで果たせる
  it('★★ その人の有効な宛先が 1 本だけなら、古くても外さない', async () => {
    await sub('https://e/only', 45);
    expect(await deactivateStaleSubscriptions(30)).toBe(0);
    expect((await state())[0].is_active).toBe(true);
  });

  it('★ 古い宛先が何本あっても、いちばん新しい 1 本は残す (新しいのがあれば古いのは全部外す)', async () => {
    await sub('https://e/a-old', 60);
    await sub('https://e/b-older', 90);
    expect(await deactivateStaleSubscriptions(30)).toBe(1);
    expect((await state()).map((r) => [r.endpoint, r.is_active])).toEqual([['https://e/a-old', true], ['https://e/b-older', false]]);
    await sub('https://e/c-new', 1);
    expect(await deactivateStaleSubscriptions(30)).toBe(1);
    expect((await state()).find((r) => r.endpoint === 'https://e/a-old')!.is_active).toBe(false);
  });

  it('日数が正の数でなければ何もしない (壊れた設定で全部外さない)', async () => {
    await sub('https://e/old', 31);
    expect(await deactivateStaleSubscriptions(0)).toBe(0);
    expect(await deactivateStaleSubscriptions(Number.NaN)).toBe(0);
    expect((await state())[0].is_active).toBe(true);
  });
});

describe('deleteOldInactiveSubscriptions — 古い無効の宛先を消す (2026-10-31 小野さん判断 3)', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    user = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
  });
  const sub = (endpoint: string, daysAgo: number, active: boolean) => getTestPool().query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, is_active, created_at, updated_at)
     VALUES ($1, $2, 'p', 'a', $3, now() - make_interval(days => $4), now() - make_interval(days => $4))`,
    [user.user.id, endpoint, active, daysAgo],
  );
  const left = async () => (await getTestPool().query<{ endpoint: string }>('SELECT endpoint FROM push_subscriptions ORDER BY endpoint')).rows.map((r) => r.endpoint);

  it('★★ 90 日より前に無効になった宛先だけ消す。有効なもの・最近無効になったものは残す', async () => {
    await sub('https://e/a-old-inactive', 91, false);
    await sub('https://e/b-recent-inactive', 89, false);
    await sub('https://e/c-old-active', 200, true);
    expect(await deleteOldInactiveSubscriptions(90)).toBe(1);
    expect(await left()).toEqual(['https://e/b-recent-inactive', 'https://e/c-old-active']);
  });

  it('壊れた日数では何も消さない', async () => {
    await sub('https://e/old', 400, false);
    expect(await deleteOldInactiveSubscriptions(0)).toBe(0);
    expect(await deleteOldInactiveSubscriptions(Number.NaN)).toBe(0);
    expect(await left()).toHaveLength(1);
  });
});
