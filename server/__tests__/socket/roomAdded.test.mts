/**
 * #486 新しく入った部屋が、読み込み直すまで出ない・投稿も届かない
 *
 * ★ 各端末は接続時の部屋の一覧についてだけ room:join する。あとから入った部屋は登録されず、
 *   入ったことを本人に知らせるイベントも無かった。管理者は接続時に全部屋を受信するので、管理者の画面では起きない。
 * ★ 人が部屋に入ったら (グループ作成・1 対 1・メンバー追加・ボットの参加)、その人の接続を部屋に入れ、本人に room:added を送る。
 * ★ 各項に「入っていない人には届かない」を並べて置く (全員に配れば通る形にしないため)
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

describe('Socket.IO — 新しく入った部屋 (#486)', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let a: { id: string; token: string };
  let b: { id: string; token: string };
  let c: { id: string; token: string };   // どの部屋にも入れない

  // ★ room:join は一切しない (= 接続時点で知らない部屋)
  const connect = (token: string) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { clients.push(s); setTimeout(() => resolve(s), 200); });
    s.on('connect_error', reject);
  });
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const events = (s: ClientSocket, name: string) => {
    const got: Array<Record<string, unknown>> = [];
    s.on(name, (d: Record<string, unknown>) => got.push(d));
    return got;
  };
  // ★ 画面と同じ socket の送信で投稿する。REST の text 投稿はもともと配信しない口 (docs/07 の表の 9) なので使えない
  const post = async (token: string, roomId: string, content: string) => {
    const s = await connect(token);
    s.emit('message:send', { room_id: roomId, content });
    return { expect: async (_status: number) => { await settle(300); } };
  };

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
  });
  afterAll(async () => {
    appServer.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    const ua = await createTestUser({ login_id: 'EMP861', display_name: 'Aさん' });
    const ub = await createTestUser({ login_id: 'EMP862', display_name: 'Bさん' });
    const uc = await createTestUser({ login_id: 'EMP863', display_name: 'Cさん' });
    a = { id: ua.user.id, token: ua.token };
    b = { id: ub.user.id, token: ub.token };
    c = { id: uc.user.id, token: uc.token };
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('グループ作成: 招かれた B に room:added が届き、その後の投稿も届く。入っていない C には何も届かない', async () => {
    const sb = await connect(b.token);
    const sc = await connect(c.token);
    const bAdded = events(sb, 'room:added');
    const bMsgs = events(sb, 'message:new');
    const cAdded = events(sc, 'room:added');
    const cMsgs = events(sc, 'message:new');

    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'あとからの部屋', member_ids: [b.id] })).body.room.id;
    await settle();
    expect(bAdded.map((e) => e.room_id)).toEqual([roomId]);

    await (await post(a.token, roomId, '最初の投稿')).expect(201);
    await settle();
    expect(bMsgs.map((m) => m.content)).toContain('最初の投稿');
    expect(cAdded).toEqual([]);
    expect(cMsgs).toEqual([]);
  });

  it('グループ作成: 作った本人の別の端末にも届く (自分の部屋が増えたことは自分の他の端末も知るべき)', async () => {
    const sa = await connect(a.token);
    const aAdded = events(sa, 'room:added');
    const aMsgs = events(sa, 'message:new');
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`)
      .send({ name: '自分の部屋', member_ids: [b.id] })).body.room.id;
    await settle();
    expect(aAdded.map((e) => e.room_id)).toEqual([roomId]);
    await (await post(b.token, roomId, 'B から')).expect(201);
    await settle();
    expect(aMsgs.map((m) => m.content)).toContain('B から');
  });

  it('1 対 1: 相手の B に room:added が届き、その後の投稿も届く。C には届かない', async () => {
    const sb = await connect(b.token);
    const sc = await connect(c.token);
    const bAdded = events(sb, 'room:added');
    const bMsgs = events(sb, 'message:new');
    const cAdded = events(sc, 'room:added');

    const roomId = (await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${a.token}`)
      .send({ partner_id: b.id })).body.room.id;
    await settle();
    expect(bAdded.map((e) => e.room_id)).toEqual([roomId]);
    await (await post(a.token, roomId, '1対1 の最初')).expect(201);
    await settle();
    expect(bMsgs.map((m) => m.content)).toContain('1対1 の最初');
    expect(cAdded).toEqual([]);
  });

  it('メンバー追加: 追加された B に room:added が届き、その後の投稿も届く。C には届かない', async () => {
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'あとで足す部屋', member_ids: [] })).body.room.id;
    const sb = await connect(b.token);
    const sc = await connect(c.token);
    const bAdded = events(sb, 'room:added');
    const bMsgs = events(sb, 'message:new');
    const cMsgs = events(sc, 'message:new');

    await request(app).post(`/api/rooms/${roomId}/members`).set('Authorization', `Bearer ${a.token}`)
      .send({ user_id: b.id }).expect(200);
    await settle();
    expect(bAdded.map((e) => e.room_id)).toEqual([roomId]);
    await (await post(a.token, roomId, '足した後')).expect(201);
    await settle();
    expect(bMsgs.map((m) => m.content)).toContain('足した後');
    expect(cMsgs).toEqual([]);
  });

  it('ボットの参加: 入ったボット自身の接続にも room:added が届き、その後の投稿も届く', async () => {
    const bot = await createTestUser({ login_id: 'BOT861', display_name: '入るボット' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'ボットが入る部屋', member_ids: [] })).body.room.id;
    const sbot = await connect(bot.token);
    const added = events(sbot, 'room:added');
    const msgs = events(sbot, 'message:new');

    await request(app).post(`/api/bot/rooms/${roomId}/join`).set('Authorization', `Bearer ${bot.token}`).expect(200);
    await settle();
    expect(added.map((e) => e.room_id)).toEqual([roomId]);
    await (await post(a.token, roomId, 'ボットへ')).expect(201);
    await settle();
    expect(msgs.map((m) => m.content)).toContain('ボットへ');
  });

  it('★ 退会させた後は届かない (逆向きが今もふさがっていること)', async () => {
    // ★ B を先に接続して、部屋に入った (受信している) 状態から外す。後から接続すると最初から受信しておらず、
    //   外す処理を消しても「届かない」が通ってしまう (最初そう書いて、穴を開けても通った)
    const sb = await connect(b.token);
    const bMsgs = events(sb, 'message:new');
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`)
      .send({ name: '出入りの部屋', member_ids: [b.id] })).body.room.id;
    await settle();
    await (await post(a.token, roomId, '退会の前')).expect(201);
    expect(bMsgs.map((m) => m.content)).toContain('退会の前');   // ★ 入っている間は届く

    await request(app).delete(`/api/rooms/${roomId}/members/${b.id}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    await settle();
    await (await post(a.token, roomId, '退会の後')).expect(201);
    await settle();
    expect(bMsgs.map((m) => m.content)).not.toContain('退会の後');
  });
});
