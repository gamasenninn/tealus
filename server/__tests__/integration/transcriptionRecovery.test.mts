/**
 * #536 整えている最中に本体が再起動されると、文字起こしが「AIが文章を整えています…」のまま止まる
 *
 * ★ 整える処理は status を formatting にしてから AI を呼ぶ。途中でプロセスが落ちると catch を通らず、
 *   起動時に拾い直す処理も無かった (2026-10-04 16:59、行ができて 9 秒後の再起動で 1 件、5 日間止まったまま)
 * ★ 起動時に、最新の版が formatting のまま止まっていて生の文字起こしがあるものを整え直す
 */
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { recoverStuckFormatting } from '../../src/services/transcriptionRecovery.mts';

describe('#536 起動時に、整えている途中で止まった文字起こしを整え直す', () => {
  let roomId: string;
  let userId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const u = await createTestUser({ login_id: 'EMP001', display_name: '話した人' });
    userId = u.user.id;
    const { rows } = await getTestPool().query<{ id: string }>(
      `INSERT INTO rooms (type, name) VALUES ('group', '部屋') RETURNING id`);
    roomId = rows[0].id;
  });

  const voice = async (opts: { status: string; raw?: string | null; deleted?: boolean; versions?: string[]; type?: string }) => {
    const { rows } = await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, type, is_deleted) VALUES ($1, $2, $3, $4) RETURNING id`,
      [roomId, userId, opts.type ?? 'voice', opts.deleted ?? false]);
    const statuses = opts.versions ?? [opts.status];
    for (let i = 0; i < statuses.length; i++) {
      await getTestPool().query(
        `INSERT INTO voice_transcriptions (message_id, version, raw_text, status) VALUES ($1, $2, $3, $4)`,
        [rows[0].id, i + 1, opts.raw === undefined ? '生の文字起こし' : opts.raw, statuses[i]]);
    }
    return rows[0].id;
  };

  it('★★ 最新の版が formatting のまま止まっているものを、その版で整え直す', async () => {
    const stuck = await voice({ status: 'formatting' });
    const format = jest.fn().mockResolvedValue('整えた文');
    const n = await recoverStuckFormatting({ format, io: null });
    expect(n).toBe(1);
    expect(format).toHaveBeenCalledWith(stuck, '生の文字起こし', null, roomId, 1, 'voice');
  });

  it('★ 動画の文字起こしも、種類を添えて整え直す', async () => {
    const stuck = await voice({ status: 'formatting', type: 'video' });
    const format = jest.fn().mockResolvedValue('整えた文');
    await recoverStuckFormatting({ format, io: null });
    expect(format).toHaveBeenCalledWith(stuck, '生の文字起こし', null, roomId, 1, 'video');
  });

  it('済んだもの・失敗したもの・消した投稿・生の文字起こしが無いものは拾わない', async () => {
    await voice({ status: 'done' });
    await voice({ status: 'error' });
    await voice({ status: 'formatting', deleted: true });
    await voice({ status: 'formatting', raw: null });
    const format = jest.fn();
    const n = await recoverStuckFormatting({ format, io: null });
    expect(n).toBe(0);
    expect(format).not.toHaveBeenCalled();
  });

  it('★ 古い版が formatting でも、最新の版が済んでいれば拾わない', async () => {
    await voice({ status: 'done', versions: ['formatting', 'done'] });
    const format = jest.fn();
    expect(await recoverStuckFormatting({ format, io: null })).toBe(0);
  });

  it('★ 1 件が失敗しても、残りは整え直す (起動を止めない)', async () => {
    await voice({ status: 'formatting' });
    await voice({ status: 'formatting' });
    const format = jest.fn().mockRejectedValueOnce(new Error('AI が落ちた')).mockResolvedValueOnce('整えた文');
    await expect(recoverStuckFormatting({ format, io: null })).resolves.toBe(2);
    expect(format).toHaveBeenCalledTimes(2);
  });
});
