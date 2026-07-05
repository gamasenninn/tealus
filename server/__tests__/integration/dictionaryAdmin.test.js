/**
 * #327 辞書育成（admin）API のテスト。
 * トリアージ: 一覧(scope=auto) / 承認(active+manual) / 却下(tombstone) / 読み修正。
 */
const request = require('supertest');
const { app } = require('../../src/app');
const repo = require('../../src/services/dictionaryRepo');
const { setupTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

let admin;
let user;

beforeAll(async () => {
  await setupTestDb();
  admin = await createTestUser({ login_id: 'DICTADM', display_name: '管理者' });
  await getTestPool().query("UPDATE users SET role='admin' WHERE id=$1", [admin.user.id]);
  user = await createTestUser({ login_id: 'DICTUSR', display_name: '一般' });
});
afterAll(async () => {
  await closeTestDb();
  await require('../../src/db/pool').end();
});
beforeEach(async () => {
  await getTestPool().query('TRUNCATE dictionary_aliases, dictionary_terms CASCADE');
});

const authGet = (path, tok) => request(app).get(path).set('Authorization', `Bearer ${tok}`);

async function seed() {
  const t = await repo.upsertTerm({ term: '保坂', reading: 'ほさか', source: 'organon' });
  const pend = await repo.upsertAlias({ termId: t.id, alias: 'ホタカ', source: 'auto', count: 1, status: 'pending' });
  await repo.upsertAlias({ termId: t.id, alias: 'ガマさん', source: 'organon', count: 0, status: 'active' }); // organon(auto でない)
  return { term: t, pendingAliasId: pend.row.id };
}

describe('認可', () => {
  test('未認証は 401', async () => {
    const res = await request(app).get('/api/admin/dictionary/aliases');
    expect(res.status).toBe(401);
  });
  test('非 admin は 403', async () => {
    const res = await authGet('/api/admin/dictionary/aliases', user.token);
    expect(res.status).toBe(403);
  });
});

describe('GET /dictionary/aliases', () => {
  test('scope=auto は自己成長分のみ返す（organon は除外）', async () => {
    await seed();
    const res = await authGet('/api/admin/dictionary/aliases', admin.token);
    expect(res.status).toBe(200);
    expect(res.body.aliases).toHaveLength(1);
    expect(res.body.aliases[0].alias).toBe('ホタカ');
    expect(res.body.aliases[0].term).toBe('保坂');
    expect(res.body.aliases[0].reading).toBe('ほさか');
  });
  test('scope=all は organon も含む', async () => {
    await seed();
    const res = await authGet('/api/admin/dictionary/aliases?scope=all', admin.token);
    expect(res.body.aliases.length).toBe(2);
  });
});

describe('承認 / 却下 / 読み修正', () => {
  test('承認 → active + source=manual', async () => {
    const { pendingAliasId } = await seed();
    const res = await request(app)
      .post(`/api/admin/dictionary/aliases/${pendingAliasId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.alias.status).toBe('active');
    expect(res.body.alias.source).toBe('manual');
  });

  test('却下 → rejected(tombstone)', async () => {
    const { pendingAliasId } = await seed();
    const res = await request(app)
      .post(`/api/admin/dictionary/aliases/${pendingAliasId}/reject`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.alias.status).toBe('rejected');
  });

  test('読み修正 → term.reading 上書き', async () => {
    const { term } = await seed();
    const res = await request(app)
      .patch(`/api/admin/dictionary/terms/${term.id}/reading`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reading: 'ほさかしゅうせい' });
    expect(res.status).toBe(200);
    expect(res.body.term.reading).toBe('ほさかしゅうせい');
  });

  test('空の読みは 400', async () => {
    const { term } = await seed();
    const res = await request(app)
      .patch(`/api/admin/dictionary/terms/${term.id}/reading`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reading: '  ' });
    expect(res.status).toBe(400);
  });

  test('存在しない別名の承認は 404', async () => {
    const res = await request(app)
      .post('/api/admin/dictionary/aliases/00000000-0000-0000-0000-000000000000/approve')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });
});
