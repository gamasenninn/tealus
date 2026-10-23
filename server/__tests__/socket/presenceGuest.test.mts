/**
 * 在席 (user:online / user:offline) をゲストに流さない (改善ループ 13 回目、2026-10-23)
 *
 * ★ REST の GET /api/users/online はゲストに 403 なのに、socket は全接続に broadcast していた。
 *   ID だけでも、同じ部屋の人の ID は分かるので「今いるか」が見えていた
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { server as appServer } from '../../src/app.mts';

describe('在席はゲストに流さない', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  const connect = (token: string) => new Promise<ClientSocket>((resolve, reject) => {
    const c = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    c.on('connect', () => { clients.push(c); setTimeout(() => resolve(c), 150); });
    c.on('connect_error', reject);
  });
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => { appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); }); });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('ゲストには届かず、ふつうの利用者には届く', async () => {
    const guest = await createTestUser({ login_id: 'GST501', display_name: 'ゲスト' });
    await getTestPool().query("UPDATE users SET role = 'guest' WHERE id = $1", [guest.user.id]);
    const watcher = await createTestUser({ login_id: 'EMP502', display_name: '社員' });
    const arriving = await createTestUser({ login_id: 'EMP503', display_name: '来た人' });

    const g = await connect(guest.token);
    const w = await connect(watcher.token);
    const seenByGuest: string[] = [];
    const seenByWatcher: string[] = [];
    g.on('user:online', (d: { user_id: string }) => seenByGuest.push(d.user_id));
    w.on('user:online', (d: { user_id: string }) => seenByWatcher.push(d.user_id));

    const a = await connect(arriving.token);
    await settle();
    expect(seenByWatcher).toContain(arriving.user.id);
    expect(seenByGuest).toEqual([]);

    const offGuest: string[] = [];
    g.on('user:offline', (d: { user_id: string }) => offGuest.push(d.user_id));
    a.close();
    await settle();
    expect(offGuest).toEqual([]);
  });
});
