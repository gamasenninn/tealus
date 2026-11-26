/**
 * socket のテストの立ち上げ (改善ループ 135)。27 本が同じ数行を写していたので、ここに 1 つ置く。
 * ★ app (src/app.mts) はここで import しない。読み込む順をテストのファイルの側に残す (docs/05 §2 の import の巻き上げ)
 * ★ 中身は写しと同じ: websocket だけでつなぐ・つながったら部屋に入って 200ms 待つ・つながらなければ reject
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';

/** 空いている番号で待ち受けて、その番号を返す */
export function listenOnFreePort(server: Server): Promise<number> {
  return new Promise<number>((resolve) => {
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

/** つなぐ人たち。closeAll は afterEach / afterAll で */
export function socketClients(getPort: () => number) {
  const clients: ClientSocket[] = [];
  const connect = (token: string, join: string[] = []) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${getPort()}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { clients.push(s); for (const r of join) s.emit('room:join', r); setTimeout(() => resolve(s), 200); });
    s.on('connect_error', reject);
  });
  const closeAll = () => { while (clients.length) clients.pop()!.close(); };
  return { connect, closeAll };
}

/** 配られるのを待つ */
export const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
