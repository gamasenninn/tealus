import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import express from 'express';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';

// app.js already calls setupSocketHandlers(io)
import { app, server as appServer, io } from '../../src/app.mts';

interface AuthResponse {
  token: string;
  user: { id: string };
}

describe('Socket.IO Chat', () => {
  let user1: AuthResponse, user2: AuthResponse, user3: AuthResponse, roomId: string;
  let client1: ClientSocket | null, client2: ClientSocket | null, client3: ClientSocket | null;
  let port: number;

  beforeAll(async () => {
    await setupTestDb();
    // Start server on random port
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => {
        port = (appServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (client1) client1.close();
    if (client2) client2.close();
    if (client3) client3.close();
    appServer.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();

    // Create users
    const res1 = await request(app)
      .post('/api/auth/register')
      .send({ login_id: 'EMP001', display_name: '田中太郎', password: 'pass123' });
    user1 = res1.body;

    const res2 = await request(app)
      .post('/api/auth/register')
      .send({ login_id: 'EMP002', display_name: '鈴木花子', password: 'pass123' });
    user2 = res2.body;

    const res3 = await request(app)
      .post('/api/auth/register')
      .send({ login_id: 'EMP003', display_name: '佐藤次郎', password: 'pass123' });
    user3 = res3.body;

    // Create room
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テスト', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  afterEach(() => {
    if (client1) { client1.close(); client1 = null; }
    if (client2) { client2.close(); client2 = null; }
    if (client3) { client3.close(); client3 = null; }
  });

  function connectClient(token: string): Promise<ClientSocket> {
    return new Promise<ClientSocket>((resolve) => {
      const client = Client(`http://localhost:${port}`, {
        auth: { token },
      });
      client.on('connect', () => resolve(client));
    });
  }

  it('should authenticate socket connection with JWT', async () => {
    client1 = await connectClient(user1.token);
    expect(client1.connected).toBe(true);
  });

  it('should reject socket connection without token', (done) => {
    const client = Client(`http://localhost:${port}`, {
      auth: {},
    });
    client.on('connect_error', (err) => {
      expect(err.message).toBeDefined();
      client.close();
      done();
    });
  });

  it('should broadcast message to room members via socket', (done) => {
    (async () => {
      client1 = await connectClient(user1.token);
      client2 = await connectClient(user2.token);

      // Join room
      client1.emit('room:join', roomId);
      client2.emit('room:join', roomId);

      // Wait a bit for join to complete
      await new Promise(r => setTimeout(r, 100));

      // Listen for new message on client2
      client2.on('message:new', (data) => {
        expect(data.content).toBe('リアルタイムテスト');
        expect(data.sender_id).toBe(user1.user.id);
        done();
      });

      // Send message from client1
      client1.emit('message:send', {
        room_id: roomId,
        content: 'リアルタイムテスト',
      });
    })();
  });

  it('should not broadcast message to non-members', (done) => {
    (async () => {
      client1 = await connectClient(user1.token);
      client3 = await connectClient(user3.token);

      client1.emit('room:join', roomId);
      // client3 is not a member but tries to join
      client3.emit('room:join', roomId);

      await new Promise(r => setTimeout(r, 100));

      let receivedByNonMember = false;
      client3.on('message:new', () => {
        receivedByNonMember = true;
      });

      client1.emit('message:send', {
        room_id: roomId,
        content: '秘密メッセージ',
      });

      // Wait and check non-member didn't receive it
      setTimeout(() => {
        expect(receivedByNonMember).toBe(false);
        done();
      }, 500);
    })();
  });
});
