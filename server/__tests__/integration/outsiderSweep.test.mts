/**
 * 部外者の総当たり (2026-10-01)
 *
 * ★ なぜ要るか: 2026-09-30〜10-01 に塞いだ穴は、どれも「口を足したときにメンバー確認を書き忘れた」形だった
 *   (socket 4 操作 / /api/bot 3 口 / メッセージ ID を部屋で確かめない 3 口 …)。docs/05 に約束を書いたが、
 *   **約束は構造ではない**。口を足した人が忘れたら、ここが落ちるようにする
 * ★ 口の一覧は**ソースから読む** (app.mts の mount + routes/*.mts の定義)。足した口も自動で対象に入る
 * ★ 口ごとに期待する status は書かない (形ごとに違い、書くと口を足すたびに表を直すことになる)。
 *   代わりに **全部の口に同じ約束** を当てる:
 *     1. 部外者への応答に、部屋 B の中身 (印の文字列) が出ない
 *     2. 一通り叩いた後、部外者が部屋 B に何も書いていない (投稿・リアクション・既読位置・メンバー・タグ)
 *     3. 500 を返さない (★ 崩れた ID も 400 で返す決まり、#477 / a0f74ee)
 */
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

const SRC = path.join(import.meta.dirname, '../../src');
const SECRET = '部外秘マーカー-7c1e';
const SECRET_EDIT = '直す前の部外秘-7c1e';

type Route = { method: string; path: string; file: string };

/** app.mts の mount と routes/*.mts の定義から、口の一覧を作る */
function collectRoutes(): Route[] {
  const appSrc = fs.readFileSync(path.join(SRC, 'app.mts'), 'utf8');
  // import { router as X, roomRouter as Y } from './routes/file.mts'
  const varToExport = new Map<string, { file: string; exported: string }>();
  for (const m of appSrc.matchAll(/import \{([^}]+)\} from '\.\/routes\/([^']+)';/g)) {
    for (const part of m[1].split(',')) {
      const [exported, local] = part.trim().split(/\s+as\s+/);
      if (local) varToExport.set(local.trim(), { file: m[2], exported: exported.trim() });
    }
  }
  const routes: Route[] = [];
  const defs = (file: string, exported: string, prefix: string) => {
    const src = fs.readFileSync(path.join(SRC, 'routes', file), 'utf8');
    for (const m of src.matchAll(new RegExp(`^${exported}\\.(get|post|put|patch|delete)\\(\\s*'([^']+)'`, 'gm'))) {
      routes.push({ method: m[1], path: (prefix + m[2]).replace(/\/$/, '') || '/', file });
    }
  };
  for (const m of appSrc.matchAll(/^app\.use\('(\/api[^']*)',(?:[^\n]*?,)?\s*(\w+)\);/gm)) {
    const target = varToExport.get(m[2]);
    if (!target) continue;
    if (target.file === 'admin/index.mts') {
      // ★ admin は index が子の router を '/' に付けている
      for (const f of fs.readdirSync(path.join(SRC, 'routes', 'admin')).filter((x) => x !== 'index.mts')) {
        defs(`admin/${f}`, 'router', m[1]);
      }
      continue;
    }
    defs(target.file, target.exported, m[1]);
  }
  return routes;
}

describe('部外者の総当たり', () => {
  const routes = collectRoutes();

  it('口の一覧がソースから取れている (★ 0 件や少なすぎで素通りしない)', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((r) => r.path === '/api/rooms/:id/messages/:msgId/edits')).toBe(true);
    expect(routes.some((r) => r.path === '/api/bot/unread')).toBe(true);
    expect(routes.some((r) => r.path.startsWith('/api/admin/'))).toBe(true);
  });

  let outsider: { id: string; token: string };
  let roomA: string; // ★ 部外者がメンバーの部屋。「A の住所で B のメッセージ ID」の形を叩くのに使う
  let roomB: string;
  let msgB: string;
  let tagB: string;
  let ownerB: string;

  beforeAll(async () => {
    await setupTestDb();
    await cleanTestDb();
    const owner = await createTestUser({ login_id: 'EMP901', display_name: '部屋Bの持ち主' });
    const out = await createTestUser({ login_id: 'EMP902', display_name: '部外者' });
    ownerB = owner.user.id;
    outsider = { id: out.user.id, token: out.token };
    roomB = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '部屋B', member_ids: [] })).body.room.id;
    roomA = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${out.token}`)
      .send({ name: '部外者の部屋A', member_ids: [] })).body.room.id;
    const pool = getTestPool();
    msgB = (await pool.query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, $3, 'text') RETURNING id`,
      [roomB, ownerB, SECRET])).rows[0].id;
    await pool.query('INSERT INTO message_edits (message_id, version, content, edited_by) VALUES ($1, 1, $2, $3)', [msgB, SECRET_EDIT, ownerB]);
    tagB = (await pool.query<{ id: string }>(`INSERT INTO tags (room_id, name, created_by) VALUES ($1, '総当たり', $2) RETURNING id`, [roomB, ownerB])).rows[0].id;
  });
  afterAll(async () => { await closeTestDb(); });

  /**
   * 口の :param を埋める。★ URL の部屋は 2 通り試す:
   *   B  … 部外者がメンバーでない部屋 (入口の requireMember で止まるか)
   *   A  … 部外者がメンバーの部屋。メッセージ・タグの ID だけ B のものを渡す (2026-09-30 に塞いだ形)
   */
  const fill = (p: string, urlRoom: string) => p
    .replace(/^\/api\/rooms\/:id/, `/api/rooms/${urlRoom}`)
    .replace(/^\/api\/messages\/:id/, `/api/messages/${msgB}`)
    .replace(/\/messages\/:id/g, `/messages/${msgB}`)
    .replace(/:msgId/g, msgB)
    .replace(/:tagId/g, tagB)
    .replace(/:userId/g, ownerB)
    .replace(/:id/g, roomB)
    .replace(/:[a-zA-Z_]+/g, 'TODO');

  it('★ どの口も、部外者に部屋 B の中身を返さず・書き込ませず・500 を返さない', async () => {
    const leaks: string[] = [];
    const errors: string[] = [];
    const body = {
      room_id: roomB, content: 'x', message_ids: [msgB], emoji: '✅', status: 'thinking', prompt: 'ねこ',
      text: 'x', tag_name: 'TODO', name: 'TODO', source_message_id: msgB, partner_id: ownerB, member_ids: [outsider.id],
    };
    for (const r of routes.flatMap((x) => [{ ...x, urlRoom: roomB }, { ...x, urlRoom: roomA }])) {
      if (r.path.startsWith('/api/line')) continue; // ★ LINE の受け口は署名で守る別の仕組み (この総当たりの対象外)
      // ★ 部屋 A を消す口は叩かない (2 周目の住所が無くなる)
      if (r.method === 'delete' && r.path === '/api/rooms/:id' && r.urlRoom === roomA) continue;
      const url = `${fill(r.path, r.urlRoom)}?room_id=${roomB}&q=${encodeURIComponent('部外秘')}`;
      const req = request(app)[r.method as 'get'](url).set('Authorization', `Bearer ${outsider.token}`);
      const res = r.method === 'get' || r.method === 'delete' ? await req : await req.send(body);
      const text = JSON.stringify(res.body ?? '') + (res.text ?? '');
      const label = `${r.method.toUpperCase()} ${r.path} [URL=${r.urlRoom === roomA ? 'A' : 'B'}] (${r.file}) → ${res.status}`;
      if (text.includes(SECRET) || text.includes(SECRET_EDIT)) leaks.push(label);
      if (res.status >= 500) errors.push(label);
    }

    const pool = getTestPool();
    const wrote = {
      messages: (await pool.query('SELECT 1 FROM messages WHERE room_id = $1 AND sender_id = $2', [roomB, outsider.id])).rowCount,
      reactions: (await pool.query('SELECT 1 FROM message_reactions WHERE message_id = $1 AND user_id = $2', [msgB, outsider.id])).rowCount,
      cursors: (await pool.query('SELECT 1 FROM room_read_cursors WHERE room_id = $1 AND user_id = $2', [roomB, outsider.id])).rowCount,
      members: (await pool.query('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [roomB, outsider.id])).rowCount,
      tags: (await pool.query('SELECT 1 FROM tags WHERE room_id = $1 AND created_by = $2', [roomB, outsider.id])).rowCount,
      messageTags: (await pool.query('SELECT 1 FROM message_tags WHERE message_id = $1 AND created_by = $2', [msgB, outsider.id])).rowCount,
      edits: (await pool.query('SELECT 1 FROM message_edits WHERE message_id = $1 AND edited_by = $2', [msgB, outsider.id])).rowCount,
    };
    const msgNow = (await pool.query<{ content: string; is_deleted: boolean }>('SELECT content, is_deleted FROM messages WHERE id = $1', [msgB])).rows[0];

    expect(leaks).toEqual([]);
    expect(wrote).toEqual({ messages: 0, reactions: 0, cursors: 0, members: 0, tags: 0, messageTags: 0, edits: 0 });
    expect(msgNow).toEqual({ content: SECRET, is_deleted: false });
    expect(errors).toEqual([]);
  }, 120_000);
});
