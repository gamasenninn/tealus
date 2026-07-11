import { useState, useEffect } from 'react';
import { getSocket } from '../services/socket';
import { api } from '../services/api';

interface UserPresencePayload {
  user_id: string;
}

// server 実応答は { online: string[] } (server/src/routes/users.mts:54)。
// api.ts の OnlineUsersResponse は { user_ids } と定義されており実応答とずれているため
// local に補正して読む (api.ts 側の修正は services バッチへ報告済み)。
type OnlineUsersActualResponse = { online?: string[] };

export interface UseOnlineStatusResult {
  onlineUsers: Set<string>;
}

/**
 * Manages online/offline user tracking.
 */
export function useOnlineStatus(): UseOnlineStatusResult {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getOnlineUsers().then(data => setOnlineUsers(new Set((data as unknown as OnlineUsersActualResponse).online))).catch(() => {});

    const socket = getSocket();
    if (socket) {
      const handleOnline = (data: UserPresencePayload) => {
        setOnlineUsers(prev => new Set([...prev, data.user_id]));
      };
      const handleOffline = (data: UserPresencePayload) => {
        setOnlineUsers(prev => { const next = new Set(prev); next.delete(data.user_id); return next; });
      };
      socket.on('user:online', handleOnline);
      socket.on('user:offline', handleOffline);

      return () => {
        socket.off('user:online', handleOnline);
        socket.off('user:offline', handleOffline);
      };
    }
  }, []);

  return { onlineUsers };
}
