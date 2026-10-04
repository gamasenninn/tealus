/**
 * #498 名前を変えた直後の投稿が、相手には古い名前で届いていた
 *
 * ★ socket はつながったときに読んだ表示名・アイコンを持ち続け、それで配っていた (読み込み直すまで)。
 *   プロフィール・アイコンを更新したら、その人のつながっている socket の値も書き換える
 */
import path from 'node:path';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import sharp from 'sharp';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

type NewMessage = { content: string; sender_display_name: string; sender_avatar_url: string | null };

describe('Socket.IO — 名前を変えたあとの投稿 (#498)', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let a: { id: string; token: string };
  let b: { id: string; token: string };
  let roomId: string;

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
    const ua = await createTestUser({ login_id: 'EMP981', display_name: '旧い名前' });
    const ub = await createTestUser({ login_id: 'EMP982', display_name: 'Bさん' });
    a = { id: ua.user.id, token: ua.token };
    b = { id: ub.user.id, token: ub.token };
    roomId = (await request(app).post('/api/rooms').set(auth(a.token))
      .send({ name: '名前の部屋', member_ids: [b.id] })).body.room.id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('★★★ つないだまま名前を変えて投稿すると、相手には新しい名前で届く', async () => {
    const sa = await connect(a.token, [roomId]);   // ★ 名前を変える前につないでおく
    const sb = await connect(b.token, [roomId]);
    const got: NewMessage[] = [];
    sb.on('message:new', (m: NewMessage) => got.push(m));

    await request(app).put('/api/auth/profile').set(auth(a.token)).send({ display_name: '新しい名前' }).expect(200);
    sa.emit('message:send', { room_id: roomId, content: '変えた直後の投稿', type: 'text' });
    await settle();

    expect(got.map((m) => [m.content, m.sender_display_name])).toEqual([['変えた直後の投稿', '新しい名前']]);
  });

  it('★ アイコンを変えたあとも新しいアイコンで届く', async () => {
    const fixtures = path.join(import.meta.dirname, '../fixtures');
    fs.mkdirSync(fixtures, { recursive: true });
    const avatar = path.join(fixtures, 'avatar-498.png');
    if (!fs.existsSync(avatar)) {
      await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toFile(avatar);
    }
    const sa = await connect(a.token, [roomId]);
    const sb = await connect(b.token, [roomId]);
    const got: NewMessage[] = [];
    sb.on('message:new', (m: NewMessage) => got.push(m));

    const up = await request(app).post('/api/auth/avatar').set(auth(a.token)).attach('avatar', avatar).expect(200);
    sa.emit('message:send', { room_id: roomId, content: 'アイコンを変えた直後', type: 'text' });
    await settle();

    expect(got[0].sender_avatar_url).toBe(up.body.user.avatar_url);
  });

  it('★ 同じ人の別の端末 (2 本目の socket) も書き換わる', async () => {
    await connect(a.token, [roomId]);
    const sa2 = await connect(a.token, [roomId]);
    const sb = await connect(b.token, [roomId]);
    const got: NewMessage[] = [];
    sb.on('message:new', (m: NewMessage) => got.push(m));

    await request(app).put('/api/auth/profile').set(auth(a.token)).send({ display_name: '新しい名前' }).expect(200);
    sa2.emit('message:send', { room_id: roomId, content: '2 本目から', type: 'text' });
    await settle();

    expect(got[0].sender_display_name).toBe('新しい名前');
  });
});
