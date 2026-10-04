/**
 * #496 タグ・TODO の変化が相手に届かない / 部屋のタグを誰でも消せる
 *
 * ★ 2026-10-04 の UI 試験: A が TODO を付けても完了にしても、B の画面には読み込み直すまで出なかった。
 *   タグの口はどれも配信の知らせを出していなかった。
 * ★ 部屋のタグはメンバーなら誰でも消せた。消すと付いていた投稿すべてから外れる (「TODO」なら部屋中の TODO が消える)
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

type TagsEvent = { message_id: string; room_id: string; tags: Array<{ id: string; name: string; is_todo: boolean; is_done: boolean; priority: number }> };

describe('Socket.IO — タグの知らせ (#496)', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let a: { id: string; token: string };
  let b: { id: string; token: string };
  let c: { id: string; token: string };
  let roomId: string;
  let msgId: string;

  const connect = (token: string, join: string[]) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { clients.push(s); for (const r of join) s.emit('room:join', r); setTimeout(() => resolve(s), 200); });
    s.on('connect_error', reject);
  });
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const ua = await createTestUser({ login_id: 'EMP961', display_name: 'Aさん' });
    const ub = await createTestUser({ login_id: 'EMP962', display_name: 'Bさん' });
    const uc = await createTestUser({ login_id: 'EMP963', display_name: 'Cさん' });
    a = { id: ua.user.id, token: ua.token };
    b = { id: ub.user.id, token: ub.token };
    c = { id: uc.user.id, token: uc.token };
    // A が作る = A が部屋の管理者。B・C は一般のメンバー
    roomId = (await request(app).post('/api/rooms').set(auth(a.token))
      .send({ name: 'タグの部屋', member_ids: [b.id, c.id] })).body.room.id;
    msgId = (await request(app).post(`/api/rooms/${roomId}/messages`).set(auth(a.token))
      .send({ content: 'A の投稿' })).body.message.id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  describe('1. 投稿のタグの変化を部屋に知らせる', () => {
    it('★★ 付ける → B に、その投稿の今のタグ一覧が届く', async () => {
      const sb = await connect(b.token, [roomId]);
      const got: TagsEvent[] = [];
      sb.on('message:tags', (d: TagsEvent) => got.push(d));

      await request(app).post(`/api/messages/${msgId}/tags`).set(auth(a.token)).send({ name: '見積' }).expect(201);
      await settle();

      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ message_id: msgId, room_id: roomId });
      expect(got[0].tags.map((t) => t.name)).toEqual(['見積']);
    });

    it('★★ 完了にする → is_done が true で届く', async () => {
      const tag = (await request(app).post(`/api/messages/${msgId}/tags`).set(auth(a.token)).send({ name: 'TODO' })).body.tag;
      const sb = await connect(b.token, [roomId]);
      const got: TagsEvent[] = [];
      sb.on('message:tags', (d: TagsEvent) => got.push(d));

      await request(app).patch(`/api/messages/${msgId}/tags/${tag.id}`).set(auth(a.token)).send({ is_done: true }).expect(200);
      await settle();

      expect(got).toHaveLength(1);
      expect(got[0].tags).toEqual([expect.objectContaining({ id: tag.id, name: 'TODO', is_done: true })]);
    });

    it('★ 外す → 空の一覧が届く', async () => {
      const tag = (await request(app).post(`/api/messages/${msgId}/tags`).set(auth(a.token)).send({ name: '見積' })).body.tag;
      const sb = await connect(b.token, [roomId]);
      const got: TagsEvent[] = [];
      sb.on('message:tags', (d: TagsEvent) => got.push(d));

      await request(app).delete(`/api/messages/${msgId}/tags/${tag.id}`).set(auth(a.token)).expect(200);
      await settle();

      expect(got).toEqual([expect.objectContaining({ message_id: msgId, tags: [] })]);
    });

    it('★ 部屋に入っていない人には届かない', async () => {
      const outsider = await createTestUser({ login_id: 'EMP964', display_name: '外の人' });
      const so = await connect(outsider.token, [roomId]);   // join を試みても入れない
      const got: TagsEvent[] = [];
      so.on('message:tags', (d: TagsEvent) => got.push(d));

      await request(app).post(`/api/messages/${msgId}/tags`).set(auth(a.token)).send({ name: '見積' }).expect(201);
      await settle();
      expect(got).toEqual([]);
    });
  });

  describe('2. 部屋のタグを消せる人', () => {
    let tagId: string;
    beforeEach(async () => {
      // B が作ったタグ (★ 「TODO」は部屋を作ったときに最初からあるので、B が新しく作る名前にする)
      tagId = (await request(app).post(`/api/messages/${msgId}/tags`).set(auth(b.token)).send({ name: 'B のタグ' })).body.tag.id;
    });

    it('★★★ 作っていない一般のメンバー (C) は 403。タグは残る', async () => {
      await request(app).delete(`/api/rooms/${roomId}/tags/${tagId}`).set(auth(c.token)).expect(403);
      const left = await getTestPool().query('SELECT 1 FROM message_tags WHERE tag_id = $1', [tagId]);
      expect(left.rows).toHaveLength(1);
    });

    it('★ 作った人 (B) は消せる', async () => {
      await request(app).delete(`/api/rooms/${roomId}/tags/${tagId}`).set(auth(b.token)).expect(200);
    });

    it('★ 部屋の管理者 (A) は消せる', async () => {
      await request(app).delete(`/api/rooms/${roomId}/tags/${tagId}`).set(auth(a.token)).expect(200);
    });

    it('★ システム管理者は、部屋の一般メンバーでも消せる', async () => {
      await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [c.id]);
      await request(app).delete(`/api/rooms/${roomId}/tags/${tagId}`).set(auth(c.token)).expect(200);
    });

    it('★★ 消したら部屋に room:tag_deleted を知らせる', async () => {
      const sc = await connect(c.token, [roomId]);
      const got: Array<{ room_id: string; tag_id: string }> = [];
      sc.on('room:tag_deleted', (d: { room_id: string; tag_id: string }) => got.push(d));

      await request(app).delete(`/api/rooms/${roomId}/tags/${tagId}`).set(auth(a.token)).expect(200);
      await settle();
      expect(got).toEqual([{ room_id: roomId, tag_id: tagId }]);
    });
  });
});
