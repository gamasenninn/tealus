import { io, Socket } from 'socket.io-client';
import { useCapabilityStore } from '../stores/capabilityStore';

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
