import { useState, useEffect } from 'react';
import { getSocket } from '../services/socket';
import { api } from '../services/api';

/**
 * Manages online/offline user tracking.
 */
export function useOnlineStatus() {
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  useEffect(() => {
    api.getOnlineUsers().then(data => setOnlineUsers(new Set(data.online))).catch(() => {});

    const socket = getSocket();
    if (socket) {
      const handleOnline = (data) => {
        setOnlineUsers(prev => new Set([...prev, data.user_id]));
      };
      const handleOffline = (data) => {
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
