/**
 * #327 辞書育成（admin）API のテスト。
 * トリアージ: 一覧(scope=auto) / 承認(active+manual) / 却下(tombstone) / 読み修正。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import * as repo from '../../src/services/dictionaryRepo.mts';
import { setupTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { pool } from '../../src/db/pool.mts';

let admin: Awaited<ReturnType<typeof createTestUser>>;
let user: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  await setupTestDb();
  admin = await createTestUser({ login_id: 'DICTADM', display_name: '管理者' });
  await getTestPool().query("UPDATE users SET role='admin' WHERE id=$1", [admin.user.id]);
  user = await createTestUser({ login_id: 'DICTUSR', display_name: '一般' });
});
afterAll(async () => {
  await closeTestDb();
  await pool.end();
});
beforeEach(async () => {
  await getTestPool().query('TRUNCATE dictionary_aliases, dictionary_terms CASCADE');
});

const authGet = (path: string, tok: string) => request(app).get(path).set('Authorization', `Bearer ${tok}`);

async function seed() {
  const t = await repo.upsertTerm({ term: '保坂', reading: 'ほさか', source: 'organon' });
  const pend = await repo.upsertAlias({ termId: t.id, alias: 'ホタカ', source: 'auto', count: 1, status: 'pending' });
  await repo.upsertAlias({ termId: t.id, alias: 'ガマさん', source: 'organon', count: 0, status: 'active' }); // organon(auto でない)
  return { term: t, pendingAliasId: pend.row!.id };
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

describe('語(term)ビュー', () => {
  test('GET /dictionary/terms は term を別名数付きで返す（検索可）', async () => {
    const t = await repo.upsertTerm({ term: '五月女', reading: 'さおとめ', category: 'person', source: 'organon' });
    await repo.upsertAlias({ termId: t.id, alias: 'ソトメ', source: 'organon', count: 0, status: 'active' });
    await repo.upsertTerm({ term: 'ガマ', reading: 'がま', source: 'organon' });

    const all = await authGet('/api/admin/dictionary/terms', admin.token);
    expect(all.status).toBe(200);
    expect(all.body.terms.length).toBe(2);
    const sao = all.body.terms.find((x: { term: string }) => x.term === '五月女');
    expect(sao.alias_count).toBe(1);
    expect(sao.reading).toBe('さおとめ');

    const q = await authGet('/api/admin/dictionary/terms?search=五月', admin.token);
    expect(q.body.terms).toHaveLength(1);
    expect(q.body.terms[0].term).toBe('五月女');
  });

  test('PATCH /dictionary/terms/:id で読みと description を更新', async () => {
    const t = await repo.upsertTerm({ term: '五月女', reading: 'さおとめ', source: 'organon' });
    const res = await request(app)
      .patch(`/api/admin/dictionary/terms/${t.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reading: 'そうとめ', description: '難読姓' });
    expect(res.status).toBe(200);
    expect(res.body.term.reading).toBe('そうとめ');
    expect(res.body.term.description).toBe('難読姓');
  });

  test('PATCH で分類(category)を更新', async () => {
    const t = await repo.upsertTerm({ term: '五月女', category: 'other', source: 'organon' });
    const res = await request(app)
      .patch(`/api/admin/dictionary/terms/${t.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ category: 'person' });
    expect(res.status).toBe(200);
    expect(res.body.term.category).toBe('person');
  });

  test('POST /dictionary/terms で新規語を登録（読みは指定 or pykakasi）', async () => {
    const res = await request(app)
      .post('/api/admin/dictionary/terms')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ term: '新人名', reading: 'しんじんめい', category: 'person', description: '新入社員' });
    expect(res.status).toBe(201);
    expect(res.body.term.term).toBe('新人名');
    expect(res.body.term.source).toBe('manual');
    expect(res.body.term.category).toBe('person');
    expect(res.body.term.reading).toBe('しんじんめい');
  });

  test('既存の語を POST すると 409', async () => {
    await repo.upsertTerm({ term: '五月女', source: 'organon' });
    const res = await request(app)
      .post('/api/admin/dictionary/terms')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ term: '五月女', reading: 'そうとめ' });
    expect(res.status).toBe(409);
  });

  test('語が空の POST は 400', async () => {
    const res = await request(app)
      .post('/api/admin/dictionary/terms')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reading: 'x' });
    expect(res.status).toBe(400);
  });

  test('更新項目が無ければ 400', async () => {
    const t = await repo.upsertTerm({ term: '五月女', source: 'organon' });
    const res = await request(app)
      .patch(`/api/admin/dictionary/terms/${t.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('存在しない term は 404', async () => {
    const res = await request(app)
      .patch('/api/admin/dictionary/terms/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reading: 'x' });
    expect(res.status).toBe(404);
  });

  test('非 admin は 403', async () => {
    const res = await authGet('/api/admin/dictionary/terms', user.token);
    expect(res.status).toBe(403);
  });
});

/**
 * ★ #375 語(term)の取り消し。別名に「却下」があるのに語には無く、
 * 一度入れた語は管理画面から取り消せなかった (term 本体の編集手段も無い)。
 */
describe('語(term)の取り消し POST /dictionary/terms/:id/reject', () => {
  test('★ 取り消すと rejected になり、用語リストから外れる', async () => {
    const t = await repo.upsertTerm({ term: 'ガマ / マンタ', reading: 'がま / まんた', source: 'manual' });
    await repo.upsertTerm({ term: '保坂', reading: 'ほさか' });
    const res = await request(app).post(`/api/admin/dictionary/terms/${t.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.term.status).toBe('rejected');
    const vocab = await repo.listActiveVocabulary();
    expect(vocab.map((v) => v.term)).toEqual(['保坂']);
  });

  test('★ 取り消した語は organon 取り込みで復活しない', async () => {
    const t = await repo.upsertTerm({ term: '把握 / 把握しておく', source: 'manual' });
    await request(app).post(`/api/admin/dictionary/terms/${t.id}/reject`)
      .set('Authorization', `Bearer ${admin.token}`);
    await repo.upsertTerm({ term: '把握 / 把握しておく', source: 'organon', status: 'active' });
    expect((await repo.listActiveVocabulary()).map((v) => v.term)).not.toContain('把握 / 把握しておく');
  });

  test('存在しない語は 404', async () => {
    const res = await request(app).post('/api/admin/dictionary/terms/00000000-0000-4000-8000-000000000000/reject')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });

  test('★ 取り消しは取り消せる — restore で用語リストに戻る (誤操作が永久に残らない)', async () => {
    const t = await repo.upsertTerm({ term: '保坂', reading: 'ほさか' });
    await request(app).post(`/api/admin/dictionary/terms/${t.id}/reject`).set('Authorization', `Bearer ${admin.token}`);
    expect((await repo.listActiveVocabulary())).toHaveLength(0);

    const res = await request(app).post(`/api/admin/dictionary/terms/${t.id}/restore`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.term.status).toBe('active');
    expect((await repo.listActiveVocabulary()).map((v) => v.term)).toEqual(['保坂']);
  });

  test('restore も存在しない語は 404 / 非 admin は 403', async () => {
    const t = await repo.upsertTerm({ term: '保坂' });
    expect((await request(app).post('/api/admin/dictionary/terms/00000000-0000-4000-8000-000000000000/restore')
      .set('Authorization', `Bearer ${admin.token}`)).status).toBe(404);
    expect((await request(app).post(`/api/admin/dictionary/terms/${t.id}/restore`)
      .set('Authorization', `Bearer ${user.token}`)).status).toBe(403);
  });

  test('非 admin は 403', async () => {
    const t = await repo.upsertTerm({ term: '保坂' });
    const res = await request(app).post(`/api/admin/dictionary/terms/${t.id}/reject`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });
});

describe('手動追加 POST /dictionary/aliases', () => {
  test('既存 term に別名を追加（source=manual, active）', async () => {
    const t = await repo.upsertTerm({ term: '五月女', reading: 'さおとめ', source: 'organon' });
    const res = await request(app)
      .post('/api/admin/dictionary/aliases')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ term: '五月女', alias: 'ソフトメイ' });
    expect(res.status).toBe(201);
    expect(res.body.alias.alias).toBe('ソフトメイ');
    expect(res.body.alias.source).toBe('manual');
    expect(res.body.alias.status).toBe('active');
    expect(res.body.term.id).toBe(t.id);
  });

  test('term が無ければ作成して別名を追加（読みは pykakasi 経由でも空でも可）', async () => {
    const res = await request(app)
      .post('/api/admin/dictionary/aliases')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ term: '新規語X', alias: 'シンキゴエックス', reading: 'しんきご' });
    expect(res.status).toBe(201);
    const t = await repo.getTermByName('新規語X');
    expect(t).toBeTruthy();
    expect(t!.source).toBe('manual');
    expect(t!.reading).toBe('しんきご');
  });

  test('tombstone(却下済) を手動追加で復活できる（人間の明示は最上位）', async () => {
    const t = await repo.upsertTerm({ term: '五月女', reading: 'さおとめ', source: 'organon' });
    const { row } = await repo.upsertAlias({ termId: t.id, alias: 'ソフトメイ', source: 'auto', count: 1, status: 'pending' });
    await repo.setAliasStatus(row!.id, 'rejected');
    const res = await request(app)
      .post('/api/admin/dictionary/aliases')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ term: '五月女', alias: 'ソフトメイ' });
    expect(res.status).toBe(201);
    expect(res.body.alias.status).toBe('active');
    expect(res.body.alias.source).toBe('manual');
  });

  test('語 or 別名が空なら 400', async () => {
    const res = await request(app)
      .post('/api/admin/dictionary/aliases')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ term: '五月女', alias: '  ' });
    expect(res.status).toBe(400);
  });

  test('非 admin は 403', async () => {
    const res = await request(app)
      .post('/api/admin/dictionary/aliases')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ term: '五月女', alias: 'ソフトメイ' });
    expect(res.status).toBe(403);
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
