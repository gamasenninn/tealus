/**
 * 音声便を保存したあと (COMMIT 後) の付随処理が失敗しても、201 を返して文字起こしを始める (2026-10-30 改善ループ 28 回目)
 *
 * ★ 以前は付随処理 (配信・通知・AI 通知) が投げると 500 を返し、文字起こしも始めなかった。投稿は残っているので、
 *   画面・無線の送り込みは「失敗」と見て送り直し、二重の便ができ、最初の便は「処理中」のまま次の再起動まで残る
 */
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';

jest.mock('../../src/services/postEffects.mts', () => {
  const actual = jest.requireActual('../../src/services/postEffects.mts');
  return { ...actual, announcePost: jest.fn(async () => { throw new Error('配信に失敗'); }) };
});
const mockTranscribe = jest.fn(async () => {});
jest.mock('../../src/services/transcription.mts', () => {
  const actual = jest.requireActual('../../src/services/transcription.mts');
  return { ...actual, transcribeVoiceMessage: (...args: unknown[]) => mockTranscribe(...(args as [])) };
});

import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('音声便: COMMIT 後の付随処理の失敗', () => {
  const fixture = path.join(import.meta.dirname, '../fixtures/test.webm');
  beforeAll(async () => {
    await setupTestDb();
    if (!fs.existsSync(fixture)) { fs.mkdirSync(path.dirname(fixture), { recursive: true }); fs.writeFileSync(fixture, Buffer.alloc(1024, 0)); }
  });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); mockTranscribe.mockClear(); });

  it('★★ 付随処理が投げても 201 を返し、文字起こしを始める (送り直しで二重の便を作らせない)', async () => {
    const u = await createTestUser({ login_id: 'EMP001', display_name: '田中' });
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${u.token}`)
      .send({ name: '部屋', member_ids: [] })).body.room.id;
    const res = await request(app).post(`/api/rooms/${roomId}/voice`).set('Authorization', `Bearer ${u.token}`).attach('voice', fixture);
    expect(res.status).toBe(201);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
  });
});
