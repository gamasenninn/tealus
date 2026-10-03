import { io, Socket } from 'socket.io-client';
import { useCapabilityStore } from '../stores/capabilityStore';
import { useRoomStore } from '../stores/roomStore';

let socket: Socket | null = null;

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
