/**
 * #475 room:viewing — 画面側が「その部屋をいま見ている」を知らせ、接続が切れたら消える
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';
import { viewingUserIds, clearViewing } from '../../src/socket/viewingRooms.mts';

describe('Socket.IO room:viewing (#475)', () => {
  let port: number;
  let client: ClientSocket | null = null;
  let userId: string, token: string, roomId: string;

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    clearViewing();
    const u = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎', password: 'pass123' });
    userId = u.user.id; token = u.token;
    const roomRes = await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`).send({ name: 'テスト', member_ids: [] });
    roomId = roomRes.body.room.id;
    client = await new Promise<ClientSocket>((resolve, reject) => {
      const c = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
      c.on('connect', () => resolve(c));
      c.on('connect_error', reject);
    });
  });
  afterEach(() => { client?.close(); client = null; });

  // emit は届くまで待てないので、少し待ってから見る
  const settle = () => new Promise((r) => setTimeout(r, 100));

  it('★ viewing: true で見ている扱いになり、false で外れる', async () => {
    client!.emit('room:viewing', { room_id: roomId, viewing: true });
    await settle();
    expect(viewingUserIds(roomId)).toEqual([userId]);

    client!.emit('room:viewing', { room_id: roomId, viewing: false });
    await settle();
    expect(viewingUserIds(roomId)).toEqual([]);
  });

  it('★★ 接続が切れたら、見ている扱いが消える', async () => {
    client!.emit('room:viewing', { room_id: roomId, viewing: true });
    await settle();
    client!.close(); client = null;
    await settle();
    expect(viewingUserIds(roomId)).toEqual([]);
  });

  it('形が違うものは無視する (UUID でない・viewing が真偽値でない)', async () => {
    client!.emit('room:viewing', { room_id: 'not-a-uuid', viewing: true });
    client!.emit('room:viewing', { room_id: roomId, viewing: 'yes' });
    client!.emit('room:viewing', null);
    await settle();
    expect(viewingUserIds(roomId)).toEqual([]);
  });
});
