/**
 * #536 整えている最中に本体が再起動されると、文字起こしが「AIが文章を整えています…」のまま止まる
 *
 * ★ 整える処理は status を formatting にしてから AI を呼ぶ。途中でプロセスが落ちると catch を通らず、
 *   起動時に拾い直す処理も無かった (2026-10-04 16:59、行ができて 9 秒後の再起動で 1 件、5 日間止まったまま)
 * ★ 起動時に、最新の版が formatting のまま止まっていて生の文字起こしがあるものを整え直す
 */
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { recoverStuckFormatting, recoverStuckTranscribing } from '../../src/services/transcriptionRecovery.mts';

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

  it('★ #585 受付を始めた後に作られた行は拾わない (起動直後の投稿を二重に整えない)', async () => {
    await voice({ status: 'formatting' });
    const format = jest.fn();
    const n = await recoverStuckFormatting({ format, io: null, startedAt: new Date(Date.now() - 60_000) });
    expect(n).toBe(0);
    expect(format).not.toHaveBeenCalled();
  });

  it('★ 1 件が失敗しても、残りは整え直す (起動を止めない)', async () => {
    await voice({ status: 'formatting' });
    await voice({ status: 'formatting' });
    const format = jest.fn().mockRejectedValueOnce(new Error('AI が落ちた')).mockResolvedValueOnce('整えた文');
    await expect(recoverStuckFormatting({ format, io: null })).resolves.toBe(2);
    expect(format).toHaveBeenCalledTimes(2);
  });
});

/**
 * ★ #579 音を文字にしている途中 (pending / transcribing) で本体が再起動されると、「⏳ 文字起こし中...」のまま止まる。
 *   #536 は formatting しか拾っておらず、より長い transcribing の窓 (投稿→生の文字 p50 4.4 秒) は無防備だった
 */
describe('★ #579 起動時に、音を文字にしている途中で止まったものをやり直す', () => {
  let roomId: string;
  let userId: string;
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const u = await createTestUser({ login_id: 'EMP001', display_name: '話した人' });
    userId = u.user.id;
    const { rows } = await getTestPool().query<{ id: string }>(`INSERT INTO rooms (type, name) VALUES ('group', '部屋') RETURNING id`);
    roomId = rows[0].id;
  });
  const voice = async (status: string, opts: { deleted?: boolean; type?: string; media?: boolean } = {}) => {
    const { rows } = await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, type, is_deleted) VALUES ($1, $2, $3, $4) RETURNING id`,
      [roomId, userId, opts.type ?? 'voice', opts.deleted ?? false]);
    if (opts.media !== false) {
      await getTestPool().query(`INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size) VALUES ($1, $2, 'a.wav', 'audio/wav', 10)`,
        [rows[0].id, `voices/${rows[0].id}.wav`]);
    }
    await getTestPool().query(`INSERT INTO voice_transcriptions (message_id, version, status) VALUES ($1, 1, $2)`, [rows[0].id, status]);
    return rows[0].id;
  };

  it('★ pending / transcribing のまま止まっているものを、添付のファイルでやり直す', async () => {
    const a = await voice('transcribing');
    const b = await voice('pending', { type: 'video' });
    await voice('done');
    await voice('formatting');                 // 整える途中は #536 の役目
    await voice('transcribing', { deleted: true });
    await voice('transcribing', { media: false }); // ファイルが無いものはやり直せない
    const calls: Array<{ id: string; file: string; opts: Record<string, unknown> }> = [];
    const n = await recoverStuckTranscribing({ transcribe: async (id, file, opts) => { calls.push({ id, file, opts: opts as Record<string, unknown> }); return null; } });
    expect(n).toBe(2);
    expect(calls.map((c) => c.id).sort()).toEqual([a, b].sort());
    const vb = calls.find((c) => c.id === b)!;
    expect(vb.file).toBe(`voices/${b}.wav`);
    expect(vb.opts).toMatchObject({ roomId, version: 1, isVideo: true, messageType: 'video' });
  });

  it('★ #585 受付を始めた後に作られた行は拾わない (起動直後の投稿を二重に文字起こししない)', async () => {
    await voice('pending');
    const transcribe = jest.fn();
    const n = await recoverStuckTranscribing({ transcribe, startedAt: new Date(Date.now() - 60_000) });
    expect(n).toBe(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('1 件が失敗しても残りは続ける', async () => {
    await voice('transcribing');
    await voice('transcribing');
    let n = 0;
    const done = await recoverStuckTranscribing({ transcribe: async () => { n += 1; if (n === 1) throw new Error('boom'); return null; } });
    expect(done).toBe(2);
    expect(n).toBe(2);
  });
});
