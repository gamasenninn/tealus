/**
 * トリガー・見張りは、無効にしたアカウントの名義では投稿しない (改善ループ 39)
 *
 * ★ 以前は as_user_id の人が無効でも、その名前で投稿していた (人の画面・通知・ログインはもう止まっているのに、
 *   機械の投稿だけがその人の名前で出続ける)。無効なら「見つからない」と同じ道 (投稿しない・記録に残す) へ。
 */
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { resolveTriggerSender } from '../../src/services/roomTriggerRunner.mts';
import { resolveWatchdogSender } from '../../src/services/watchdogRunner.mts';

describe('トリガー・見張りの投稿名義は有効な人だけ', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); });

  it('有効な人なら名義になる (前提の確認)', async () => {
    const u = await createTestUser({ login_id: 'EMP801', display_name: '在籍' });
    expect((await resolveWatchdogSender(u.user.id))?.display_name).toBe('在籍');
    expect((await resolveTriggerSender({ as_user_id: u.user.id } as never))?.display_name).toBe('在籍');
  });

  it('★ 無効にした人は名義にならない (投稿しない)', async () => {
    const u = await createTestUser({ login_id: 'EMP802', display_name: '退職' });
    await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [u.user.id]);
    expect(await resolveWatchdogSender(u.user.id)).toBeNull();
    expect(await resolveTriggerSender({ as_user_id: u.user.id } as never)).toBeNull();
  });
});
