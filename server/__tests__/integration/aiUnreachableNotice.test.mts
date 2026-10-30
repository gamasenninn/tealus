/**
 * AI に届かなかった便に、部屋へ 1 行返す (2026-10-30 小野さん判断 C)
 * ★ 以前は webhook の失敗が記録 1 行だけで、投稿した人は返事を待ち続けた
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { noticeAiUnreachable, _resetAiUnreachableNotice } from '../../src/services/aiUnreachableNotice.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('AI に届かなかったときの 1 行', () => {
  let human: TestUser, bot: TestUser, other: TestUser;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    _resetAiUnreachableNotice();
    human = await createTestUser({ login_id: 'EMP001', display_name: '田中' });
    other = await createTestUser({ login_id: 'EMP002', display_name: '鈴木' });
    bot = await createTestUser({ login_id: 'AI_AGENT', display_name: 'アシスタント' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
  });

  const group = async () => (await request(app).post('/api/rooms').set('Authorization', `Bearer ${human.token}`)
    .send({ name: '部屋', member_ids: [bot.user.id, other.user.id] })).body.room.id as string;
  const systemLines = async (roomId: string) => (await getTestPool().query(
    "SELECT sender_id, content FROM messages WHERE room_id = $1 AND type = 'system' AND content LIKE '%AI に届きませんでした%'", [roomId])).rows;
  const payload = (content: string) => ({ message: { content, sender: { id: human.user.id } } });

  it('★★ 行頭が @<機械の名前> の便なら、機械を送り主にして 1 行出す', async () => {
    const roomId = await group();
    expect(await noticeAiUnreachable('message.created', roomId, payload('@アシスタント 明日の予定は?'))).toBe(true);
    const lines = await systemLines(roomId);
    expect(lines).toHaveLength(1);
    expect(lines[0].sender_id).toBe(bot.user.id);
  });

  it('★★ AI に宛てていない便では出さない (グループの普通の会話)', async () => {
    const roomId = await group();
    expect(await noticeAiUnreachable('message.created', roomId, payload('お疲れさまです'))).toBe(false);
    expect(await systemLines(roomId)).toHaveLength(0);
  });

  it('★ 相手が機械の 1 対 1 なら、宛名なしでも出す', async () => {
    const roomId = (await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${human.token}`)
      .send({ partner_id: bot.user.id })).body.room.id as string;
    expect(await noticeAiUnreachable('message.created', roomId, payload('こんにちは'))).toBe(true);
  });

  it('★ 同じ部屋には 10 分に 1 回まで (障害の間に並ばない)', async () => {
    const roomId = await group();
    const t = Date.now();
    await noticeAiUnreachable('message.created', roomId, payload('@アシスタント 1'), t);
    expect(await noticeAiUnreachable('message.created', roomId, payload('@アシスタント 2'), t + 60_000)).toBe(false);
    expect(await noticeAiUnreachable('message.created', roomId, payload('@アシスタント 3'), t + 11 * 60_000)).toBe(true);
  });
});
