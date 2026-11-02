import { useState, useEffect } from 'react';
import { getSocket } from '../services/socket';
import { api } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { canSearchUsers } from '../utils/permissions';

interface UserPresencePayload {
  user_id: string;
}


export interface UseOnlineStatusResult {
  onlineUsers: Set<string>;
}

/**
 * Manages online/offline user tracking.
 */
export function useOnlineStatus(): UseOnlineStatusResult {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = () => {
      // ★ #575 ゲストはオンラインを引けない (サーバーが 403)。呼ばない
      if (!canSearchUsers(useAuthStore.getState().user)) return;
      api.getOnlineUsers().then(data => setOnlineUsers(new Set(data.online))).catch(() => {});
    };
    load();

    const socket = getSocket();
    if (socket) {
      // ★ つなぎ直したら取り直す (改善ループ 36)。切れている間の offline を取りこぼすと、帰った人が緑のまま残っていた
      socket.on('connect', load);
      const handleOnline = (data: UserPresencePayload) => {
        setOnlineUsers(prev => new Set([...prev, data.user_id]));
      };
      const handleOffline = (data: UserPresencePayload) => {
        setOnlineUsers(prev => { const next = new Set(prev); next.delete(data.user_id); return next; });
      };
      socket.on('user:online', handleOnline);
      socket.on('user:offline', handleOffline);

      return () => {
        socket.off('connect', load);
        socket.off('user:online', handleOnline);
        socket.off('user:offline', handleOffline);
      };
    }
  }, []);

  return { onlineUsers };
}
