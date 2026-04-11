import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useRoomStore } from '../stores/roomStore';
import { useMessageStore } from '../stores/messageStore';
import { getSocket } from '../services/socket';
import { api } from '../services/api';

/**
 * Manages all Socket.IO event subscriptions for a chat room.
 * Also handles room initialization and cleanup.
 * Returns typingUsers state.
 */
export function useSocketSync(roomId, targetMsgId = null) {
  const { user } = useAuthStore();
  const { selectRoom, clearCurrentRoom } = useRoomStore();
  const { addMessage, fetchMessages, clearMessages, updateMessageContent } = useMessageStore();
  const [typingUsers, setTypingUsers] = useState({});

  useEffect(() => {
    selectRoom(roomId);
    fetchMessages(roomId, targetMsgId || null);

    // Re-fetch messages when app returns from background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchMessages(roomId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const socket = getSocket();
    if (socket) {
      socket.emit('room:join', roomId);

      // Re-join room on reconnect (after background recovery etc.)
      socket.on('connect', () => {
        socket.emit('room:join', roomId);
      });

      socket.on('message:new', (msg) => {
        addMessage(msg);
        if (msg.sender_id !== user.id) {
          api.markRead(roomId, [msg.id]).catch(() => {});
          socket.emit('message:read', { room_id: roomId, message_ids: [msg.id] });
          if (localStorage.getItem('notificationSound') !== 'off') {
            new Audio('/notification.wav').play().catch(() => {});
          }
        }
      });

      socket.on('message:read', (data) => {
        if (data.read_counts) {
          Object.entries(data.read_counts).forEach(([id, count]) => {
            useMessageStore.getState().updateReadCount(id, count);
          });
        }
      });

      socket.on('voice:status', (data) => {
        useMessageStore.getState().updateTranscription(data.message_id, { status: data.status });
      });

      socket.on('voice:transcription', (data) => {
        useMessageStore.getState().updateTranscription(data.message_id, {
          status: data.status,
          raw_text: data.raw_text,
          formatted_text: data.formatted_text,
        });
      });

      socket.on('message:updated', (data) => {
        updateMessageContent(data.message_id, data.content, data.is_edited);
      });

      socket.on('message:deleted', (data) => {
        useMessageStore.getState().markDeleted(data.message_id);
      });

      socket.on('message:reaction', (data) => {
        useMessageStore.getState().updateReactions(data.message_id, data.reactions);
      });

      socket.on('link:preview', (data) => {
        useMessageStore.getState().updateLinkPreview(data.message_id, data.preview);
      });

      socket.on('typing:start', (data) => {
        if (data.user_id === user.id) return;
        setTypingUsers(prev => ({ ...prev, [data.user_id]: data.display_name }));
      });

      socket.on('typing:stop', (data) => {
        if (data.user_id === user.id) return;
        setTypingUsers(prev => {
          const next = { ...prev };
          delete next[data.user_id];
          return next;
        });
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearCurrentRoom();
      clearMessages();
      if (socket) {
        socket.emit('room:leave', roomId);
        socket.off('message:new');
        socket.off('message:read');
        socket.off('voice:status');
        socket.off('voice:transcription');
        socket.off('message:updated');
        socket.off('message:deleted');
        socket.off('typing:start');
        socket.off('typing:stop');
        socket.off('message:reaction');
        socket.off('link:preview');
        socket.off('connect');
      }
    };
  }, [roomId]);

  return { typingUsers };
}
