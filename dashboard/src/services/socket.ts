import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** 本体の認証で断られたときの文言 (server/src/socket/index.mts と同じ)。これらは鍵の問題なのでつなぎ直さない */
const SOCKET_AUTH_ERRORS = new Set(['認証トークンがありません', 'ユーザーが見つかりません', 'トークンが無効です']);
const SOCKET_RETRY_MS = 5000;
const SOCKET_RETRY_MAX_MS = 60_000;

export function connectSocket(token: string): Socket {
  if (socket) return socket;
  socket = io('/', {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  // ★ 本体のミドルウェアに断られた socket (DB の一時的な失敗など) は、socket.io が自動で再接続しない (active が false)。
  //   少し待って自分でつなぎ直す。断られ続けたら間を倍にしていく (2026-10-30。画面 client/src/services/socket.ts と同じ)
  const s0 = socket;
  let retryMs = SOCKET_RETRY_MS;
  s0.on('connect', () => { retryMs = SOCKET_RETRY_MS; });
  s0.on('connect_error', (err) => {
    if (SOCKET_AUTH_ERRORS.has(err.message) || s0.active) return;
    setTimeout(() => { if (socket === s0 && !s0.connected) s0.connect(); }, retryMs);
    retryMs = Math.min(retryMs * 2, SOCKET_RETRY_MAX_MS);
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
