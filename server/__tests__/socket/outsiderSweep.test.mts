/**
 * socket の部外者の総当たり (2026-10-01)
 *
 * ★ REST 側 (integration/outsiderSweep) と同じ考え方を socket に当てる。
 *   src/socket の `socket.on('…')` を**ソースから全部集めて**、部外者として送る
 * ★ 約束:
 *   1. 部屋 B のメンバーに、部外者が起こした通知が届かない (入力中・着信・既読数・新着 …)
 *   2. 部外者が部屋 B に何も書いていない (投稿・既読位置)
 *   3. 部外者の接続が落ちない (形の崩れた値でも)
 * ★ 通話の開始は「通話サーバが動いている」ときしか受け付けないので、手元に健康確認の口を立てる
 *   (そうしないと手前で断られ、メンバー確認を外しても通ってしまう)
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';
import * as capabilityWatcher from '../../src/services/capabilityWatcher.mts';
import { activeCalls } from '../../src/socket/handlers/call.mts';

const SOCKET_SRC = path.join(import.meta.dirname, '../../src/socket');

/** src/socket の下の socket.on('…') を全部集める */
function collectEvents(): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.mts')) files.push(p);
    }
  };
  walk(SOCKET_SRC);
  const events = new Set<string>();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/socket\.on\('([^']+)'/g)) events.add(m[1]);
  }
  events.delete('disconnect');
  return [...events].sort();
}

describe('socket の部外者の総当たり', () => {
  const events = collectEvents();
  let port: number;
  let rtc: http.Server;
  const clients: ClientSocket[] = [];
  let owner: { id: string; token: string };
  let outsider: { id: string; token: string };
  let roomB: string; // 1 対 1 (着信が飛ぶ形)
  let msgB: string;

  const connect = (token: string, join: string[] = []) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { clients.push(s); for (const r of join) s.emit('room:join', r); setTimeout(() => resolve(s), 200); });
    s.on('connect_error', reject);
  });
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    rtc = http.createServer((_q, r) => { r.statusCode = 200; r.end('ok'); });
    await new Promise<void>((r) => rtc.listen(0, '127.0.0.1', r));
    process.env.RTC_PORT = String((rtc.address() as AddressInfo).port);
    await capabilityWatcher.checkAndEmit();

    await cleanTestDb();
    activeCalls.clear();
    const o = await createTestUser({ login_id: 'EMP911', display_name: '持ち主' });
    const p = await createTestUser({ login_id: 'EMP912', display_name: '相手' });
    const x = await createTestUser({ login_id: 'EMP913', display_name: '部外者' });
    owner = { id: o.user.id, token: o.token };
    outsider = { id: x.user.id, token: x.token };
    roomB = (await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${o.token}`).send({ partner_id: p.user.id })).body.room.id;
    msgB = (await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '部屋Bの投稿', 'text') RETURNING id`, [roomB, o.user.id])).rows[0].id;
  });
  afterAll(async () => {
    while (clients.length) clients.pop()!.close();
    capabilityWatcher.stop();
    delete process.env.RTC_PORT;
    rtc.close();
    appServer.close();
    await closeTestDb();
  });

  it('集めた操作が足りている (★ 0 件で素通りしない)', () => {
    expect(events).toEqual(expect.arrayContaining(['call:start', 'call:end', 'call:reject', 'message:read', 'message:send', 'typing:start', 'room:join']));
  });

  it('★ どの操作も、部外者は部屋 B に通知を起こさず・書き込まず・接続も落ちない', async () => {
    const watcher = await connect(owner.token, [roomB]);
    const got: string[] = [];
    watcher.onAny((name: string, payload: { user_id?: string; callerId?: string; sender_id?: string; userId?: string; agent_id?: string }) => {
      // ★ 在席 (user:online / user:offline) は部屋と関係なく全員に流す設計なので数えない
      if (name === 'user:online' || name === 'user:offline') return;
      const who = payload?.user_id ?? payload?.callerId ?? payload?.sender_id ?? payload?.userId;
      // ★ 部外者が起こしたもの、または部屋 B の既読数・通話の状態が動いたもの
      if (who === outsider.id || name === 'message:read' || name === 'call:status' || name === 'call:incoming') got.push(name);
    });

    const x = await connect(outsider.token, [roomB]); // room:join は断られるはず
    const payloads = [
      roomB,
      { room_id: roomB, roomId: roomB, message_ids: [msgB], content: '部外者の投稿', callerId: owner.id, viewing: true },
      null,
      'not-a-uuid',
      { room_id: 'not-a-uuid', roomId: 'not-a-uuid', message_ids: ['x'] },
      { room_id: 'not-a-uuid', content: '崩れた ID の投稿' }, // ★ 崩れた ID が DB まで届くと例外になる
    ];
    for (const ev of events) for (const p of payloads) x.emit(ev, p);
    await settle(800);

    const pool = getTestPool();
    expect(got).toEqual([]);
    expect((await pool.query('SELECT 1 FROM messages WHERE room_id = $1 AND sender_id = $2', [roomB, outsider.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM messages WHERE room_id = $1 AND type = $2', [roomB, 'system'])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM room_read_cursors WHERE room_id = $1 AND user_id = $2', [roomB, outsider.id])).rowCount).toBe(0);
    expect(activeCalls.has(roomB)).toBe(false);
    expect(x.connected).toBe(true);
  }, 30_000);
});
