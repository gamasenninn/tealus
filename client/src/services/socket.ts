import { io, Socket } from 'socket.io-client';
import { useCapabilityStore } from '../stores/capabilityStore';
import { useRoomStore } from '../stores/roomStore';

let socket: Socket | null = null;

/**
 * #505 部屋に「誰が何人入っているか」を数える (一覧 RoomList と部屋の画面 useSocketSync が同じ socket を使う)。
 * ★ socket.io の部屋への出入りは socket 単位で数えない。部屋の画面が離れるときに room:leave を直接送ると、
 *   一覧ごとその部屋から抜け、読み込み直すまで新着 (音・未読・最後の投稿) が届かなかった (#237 から)。
 *   → 出入りは joinRoom / leaveRoom を通し、最後の 1 つが抜けたときだけ room:leave を送る。
 * ★ つなぎ直したときの入り直し (connect) は数えずに直接 room:join を送る (数は接続をまたいで持ち越す)。
 */
const roomRefs = new Map<string, number>();

export function joinRoom(roomId: string): void {
  roomRefs.set(roomId, (roomRefs.get(roomId) ?? 0) + 1);
  socket?.emit('room:join', roomId);   // ★ 毎回送る (入っていなかったときにも確実に入る。サーバー側は何度入っても同じ)
}

export function leaveRoom(roomId: string): void {
  const n = roomRefs.get(roomId) ?? 0;
  if (n <= 0) return;
  if (n > 1) { roomRefs.set(roomId, n - 1); return; }
  roomRefs.delete(roomId);
  socket?.emit('room:leave', roomId);
}

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io('/', {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
  });

  // server の capabilityWatcher が状態変化時に emit する。
  // rtc-server の up/down に応じて UI が動的に追従する。
  socket.on('capability:changed', (data: { realtime_voice_available?: boolean } | null) => {
    if (data && typeof data.realtime_voice_available === 'boolean') {
      useCapabilityStore.getState().setRealtimeVoice(data.realtime_voice_available);
    }
  });

  // #486 自分が部屋に入った (作った・招かれた・1 対 1 を始められた)。読み込み直すまで出なかった。
  // ★ ここで受ける: 一覧の部品 (RoomList) は部屋が 0 件だと受信を登録せず、トークを開いている間は外れている
  const s = socket;
  s.on('room:added', (data: { room_id?: unknown } | null) => {
    if (!data || typeof data.room_id !== 'string') return;
    s.emit('room:join', data.room_id);
    useRoomStore.getState().fetchRooms();
  });

  // ★ #533 自分が部屋から外れた (自分で退会・外された)。以前は本人に何も届かず、読み込み直すまで部屋が残った。
  //   一覧を取り直し、開いている部屋の画面へ知らせる (useRoomRemovedRedirect が受けてトーク一覧へ戻る)
  s.on('room:removed', (data: { room_id?: unknown } | null) => {
    if (!data || typeof data.room_id !== 'string') return;
    useRoomStore.getState().fetchRooms();
    window.dispatchEvent(new CustomEvent('tealus:room-removed', { detail: { room_id: data.room_id } }));
  });

  // #489 部屋の設定・メンバーが変わった。一覧を取り直し、開いている部屋なら情報とメンバーも取り直す
  // (読み込み直すまで「編集」が出ない・見出しの人数が古いままだった)
  s.on('room:updated', (data: { room_id?: unknown } | null) => {
    if (!data || typeof data.room_id !== 'string') return;
    const store = useRoomStore.getState();
    store.fetchRooms();
    return store.refreshRoom(data.room_id);
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
  roomRefs.clear();   // #505 新しい接続では入り直しから数える
}
